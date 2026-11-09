import ItomaCore
import ItomaStorage

/// Owns one connection on a native actor, independent of UI/JS. The main app privately saves the
/// confirmed reason/choice before shared acceptance. Extensions never import ItomaHistory.
@ItomaControlActor public final class CommandService {
    enum ApplicationStart { case ready(EvaluationID), resolved(CommandRunResult) }
    let repository: ControlRepository
    let scheduler: any DeadlineScheduler
    let restriction: any RestrictionAdapter
    let contexts: any EvaluationContextProvider
    let identifiers: any ControlIdentifiers
    let historyCapacity: HistoryOutboxCapacity
    var inFlight: Set<CommandID> = []

    public init(
        repository: ControlRepository, scheduler: any DeadlineScheduler, restriction: any RestrictionAdapter,
        contexts: any EvaluationContextProvider, historyCapacity: HistoryOutboxCapacity,
        identifiers: (any ControlIdentifiers)? = nil
    ) {
        self.repository = repository; self.scheduler = scheduler; self.restriction = restriction
        self.contexts = contexts; self.historyCapacity = historyCapacity
        self.identifiers = identifiers ?? RandomControlIdentifiers()
    }

    public func snapshot() throws -> ControlSnapshot { try repository.readSnapshot() }

    /// Executes already durable Pending intent only. A reentrant duplicate never registers twice.
    /// Interrupted Scheduling/Applying requires reconciliation, not silent side-effect replay.
    public func executeAcceptedGrant(commandID: CommandID) async throws -> CommandRunResult {
        guard let command = try repository.command(commandID), command.kind == .requestTemporaryGrant else { throw CommandServiceError.invalidCommand }
        if inFlight.contains(commandID) { return result(commandID, .inProgress) }
        switch command.status {
        case .succeeded, .cancelled, .superseded, .expired: return result(commandID, .committed)
        case .failed, .uncertain: return result(commandID, .requiresExplicitRetry)
        case .scheduling, .applying: return result(commandID, .requiresRecovery)
        case .pending: break
        }
        inFlight.insert(commandID)
        defer { inFlight.remove(commandID) }
        let prepared: DeadlineRegistration
        do {
            guard let registration = try prepareGrant(command) else { return result(commandID, .committed) }
            prepared = registration
        } catch { return result(commandID, .uncertain, .storageFailure) }

        // The intent and Preparing have committed. No database writer survives this await.
        let scheduled = await scheduler.register(prepared)
        switch scheduled {
        case let .accepted(receipt):
            guard receipt.registrationID == prepared.id, receipt.generation == prepared.generation,
                  receipt.scheduledFor == prepared.scheduledFor else {
                return settleRegistrationFailure(prepared, attempt: command.attempt, uncertain: true, failure: .registrationFailure)
            }
            do {
                guard try storeScheduleReceipt(receipt, prepared: prepared) else { return result(commandID, .requiresRecovery, .interrupted) }
            } catch { return result(commandID, .uncertain, .storageFailure) }
        case let .rejected(failure): return settleRegistrationFailure(prepared, attempt: command.attempt, uncertain: false, failure: failure)
        case let .unknown(failure): return settleRegistrationFailure(prepared, attempt: command.attempt, uncertain: true, failure: failure)
        }
        do {
            switch try beginApplication(commandID: commandID, registrationID: prepared.id, attempt: command.attempt) {
            case let .resolved(stopped): return stopped
            case let .ready(marker): return try finalizeGrant(commandID: commandID, registrationID: prepared.id, applicationID: marker, attempt: command.attempt)
            }
        }
        catch {
            // A synchronous own-store write may already have happened. Leave the protective
            // registration intact and do not claim a successful/rolled-back OS operation.
            return result(commandID, .uncertain, .storageFailure)
        }
    }

    /// Explicit user retry only. Reuses the original grant and fixed deadline, with a new attempt
    /// and registration generation. No automatic retry loop or UI-lifetime cancellation is added.
    public func retryGrant(commandID: CommandID) async throws -> CommandRunResult {
        guard !inFlight.contains(commandID) else { return result(commandID, .inProgress) }
        guard let command = try repository.command(commandID), command.kind == .requestTemporaryGrant,
              [.failed, .uncertain].contains(command.status) else { throw CommandServiceError.invalidState }
        let ready = try observedTransaction { tx, capture in
            guard let live = try tx.command(commandID), live == command,
                  let stored = try tx.grantForCommand(commandID), !stored.hasEnded else { throw CommandServiceError.invalidState }
            let snapshot = try tx.snapshot(), context = capture(snapshot.activation)
            if try settleStale(command, stored: stored, snapshot: snapshot, context: context, transaction: tx) { return false }
            _ = try tx.recordCommand(changing(command, status: .pending, attempt: command.attempt.next()), expected: command)
            _ = try tx.recordGrant(stored.grant.recording(status: .pending), expected: stored.grant)
            return true
        }
        guard ready else { return result(commandID, .committed) }
        return try await executeAcceptedGrant(commandID: commandID)
    }

    func prepareGrant(_ command: Command) throws -> DeadlineRegistration? {
        try repository.requireOutsideTransaction()
        return try observedTransaction { tx, capture in
            guard try tx.command(command.id) == command, let stored = try tx.grantForCommand(command.id),
                  stored.grant.commandID == command.id else { throw CommandServiceError.invalidState }
            let snapshot = try tx.snapshot(), context = capture(snapshot.activation)
            if try settleStale(command, stored: stored, snapshot: snapshot, context: context, transaction: tx) { return nil }
            let grant = stored.grant
            let preparing = try DeadlineRegistration(id: identifiers.registrationID(), grantID: grant.id, commandID: command.id,
                generation: tx.latestRegistration(grantID: grant.id).map { try $0.generation.next() } ?? RegistrationGeneration(0),
                policyRevision: snapshot.policy.revision, scheduledFor: grant.effectiveExpiresAt, status: .preparing)
            _ = try tx.recordCommand(changing(command, status: .scheduling), expected: command)
            _ = try tx.recordGrant(grant.recording(status: .scheduling), expected: grant)
            _ = try tx.recordRegistration(preparing)
            return preparing
        }
    }

    func settleStale(
        _ command: Command, stored: StoredGrant, snapshot: ControlSnapshot,
        context: EvaluationContext, transaction tx: ControlTransaction
    ) throws -> Bool {
        let grant = stored.grant
        guard context.activation == snapshot.activation else { throw CommandServiceError.invalidState }
        if context.authorization.status == .denied {
            try recordDenied(context: context, transaction: tx)
            if let current = try tx.grant(grant.id), !current.hasEnded {
                _ = try tx.recordGrant(current.grant.recording(status: .invalidated), expected: current.grant)
            }
            _ = try tx.recordCommand(changing(command, status: .superseded), expected: command)
            try markObservationUncertain(at: context.now, failure: .authorizationRequired, transaction: tx)
            try history(command.id, at: context.now, transaction: tx)
            return true
        }
        let synthetic = try grant.recording(status: .active)
        let evaluation = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection), context: context, grants: [synthetic])
        let effective = evaluation.assessments.first?.disposition == .effective
        guard stored.hasEnded || snapshot.policy.revision != command.expectedPolicyRevision || !effective else { return false }
        let expired = context.now >= grant.effectiveExpiresAt
        let backwards = context.now < grant.acceptedAt && !stored.hasEnded
        if !stored.hasEnded {
            _ = try tx.recordGrant(grant.recording(status: expired ? .expired : backwards ? .uncertain : .invalidated), expected: grant)
        }
        _ = try tx.recordCommand(changing(command, status: expired ? .expired : backwards ? .uncertain : .superseded), expected: command)
        if context.authorization.status != .approved {
            _ = try protectedGrants(context: context, transaction: tx)
            try markObservationUncertain(at: context.now, failure: .authorizationRequired, transaction: tx)
        }
        try history(command.id, at: context.now, transaction: tx)
        return true
    }

    func settleRegistrationFailure(_ prepared: DeadlineRegistration, attempt: AttemptNumber, uncertain: Bool, failure: OperationFailure) -> CommandRunResult {
        do {
            let owned = try observedTransaction { tx, capture -> Bool in
                guard let current = try tx.registration(prepared.id) else { throw CommandServiceError.invalidState }
                _ = try tx.recordRegistration(registration(current, status: uncertain ? .unknown : .failed), expected: current)
                guard let command = try tx.command(prepared.commandID), let stored = try tx.grant(prepared.grantID) else { throw CommandServiceError.invalidState }
                guard command.attempt == attempt else { return false }
                if command.status == .scheduling {
                    _ = try tx.recordCommand(changing(command, status: uncertain ? .uncertain : .failed), expected: command)
                    if !stored.hasEnded {
                        _ = try tx.recordGrant(stored.grant.recording(status: uncertain ? .uncertain : .failed), expected: stored.grant)
                    }
                }
                let context = try capture(tx.snapshot().activation)
                try history(command.id, at: context.now, transaction: tx)
                return true
            }
            return result(prepared.commandID, owned ? .committed : .requiresRecovery, owned ? failure : .interrupted)
        } catch { return result(prepared.commandID, .uncertain, .storageFailure) }
    }

    /// Persist uncertainty before the external side effect, so a later rollback cannot restore an
    /// older Applied observation as if it confirmed the current store. No OS call happens here.
    func beginApplication(commandID: CommandID, registrationID: RegistrationID, attempt: AttemptNumber) throws -> ApplicationStart {
        try observedTransaction { tx, capture in
            guard let command = try tx.command(commandID), command.status == .scheduling, command.attempt == attempt,
                  let stored = try tx.grantForCommand(commandID) else { return .resolved(result(commandID, .requiresRecovery)) }
            let snapshot = try tx.snapshot(), context = capture(snapshot.activation)
            if try settleStale(command, stored: stored, snapshot: snapshot, context: context, transaction: tx) { return .resolved(result(commandID, .committed)) }
            _ = try tx.recordCommand(changing(command, status: .applying), expected: command)
            let applying = try stored.grant.recording(status: .applying)
            _ = try tx.recordGrant(applying, expected: stored.grant, registrationID: registrationID, context: context)
            let all = try protectedGrants(context: context, excluding: applying.id, transaction: tx)
            let plan = try evaluation(snapshot: tx.snapshot(), context: context, grants: all + [applying.recording(status: .active)])
            let observation = try ApplicationObservation(evaluationID: plan.id, status: .applying, evidence: nil,
                observedAt: context.now, validUntil: nil, error: nil)
            _ = try tx.recordApplication(StoredApplication(evaluation: plan, observation: observation), expectedSequence: tx.snapshot().snapshotSequence)
            return .ready(plan.id)
        }
    }

    func finalizeGrant(commandID: CommandID, registrationID: RegistrationID, applicationID: EvaluationID, attempt: AttemptNumber) throws -> CommandRunResult {
        try observedTransaction { tx, capture in
            guard let command = try tx.command(commandID), let stored = try tx.grantForCommand(commandID) else { throw CommandServiceError.invalidState }
            // A callback or another controller may have settled it during registration.
            guard command.status == .applying, command.attempt == attempt else { return result(commandID, .requiresRecovery) }
            let snapshot = try tx.snapshot()
            guard snapshot.application?.evaluation.id == applicationID, snapshot.application?.observation.status == .applying else {
                return result(commandID, .requiresRecovery, .interrupted)
            }
            let context = capture(snapshot.activation)
            if try settleStale(command, stored: stored, snapshot: snapshot, context: context, transaction: tx) {
                try markObservationUncertain(at: context.now, failure: .interrupted, transaction: tx)
                return result(commandID, .committed)
            }
            guard context.activation == snapshot.activation else { throw CommandServiceError.invalidState }
            guard let registration = try tx.registration(registrationID), registration.status == .registered,
                  registration.firedAt == nil, let receipt = registration.receipt, receipt.acceptedAt <= context.now,
                  try tx.latestRegistration(grantID: stored.grant.id)?.id == registrationID else {
                return result(commandID, .requiresRecovery, .registrationFailure)
            }
            let applying = try changing(command, status: .applying)
            _ = try tx.recordCommand(applying, expected: command)
            let applyingGrant = try stored.grant.recording(status: .applying)
            _ = try tx.recordGrant(applyingGrant, expected: stored.grant, registrationID: registrationID, context: context)
            let all = try protectedGrants(context: context, excluding: applyingGrant.id, transaction: tx)
            let active = try applyingGrant.recording(status: .active)
            let plan = try evaluation(snapshot: tx.snapshot(), context: context, grants: all + [active])
            let applied = restriction.apply(plan, purpose: .temporaryGrant)
            let after = capture(snapshot.activation)
            if after.authorization.status != .approved || after.activation != snapshot.activation {
                // Missing authorization is not a request to clear the own store. Keep the outcome
                // uncertain and leave protection installed; do not apply the Core gate's empty set.
                try recordDenied(context: after, transaction: tx)
                if let current = try tx.grant(applyingGrant.id), !current.hasEnded {
                    _ = try tx.recordGrant(current.grant.recording(status: .invalidated), expected: current.grant)
                }
                _ = try protectedGrants(context: after, transaction: tx)
                _ = try tx.recordCommand(changing(applying, status: .uncertain), expected: applying)
                let failure: OperationFailure = after.authorization.status != .approved ? .authorizationRequired : .interrupted
                try observe(plan, result: .uncertain(failure), context: after, transaction: tx)
                try history(commandID, at: after.now, transaction: tx)
                return result(commandID, .committed, failure)
            }
            // If the short native operation crossed its validity window or the clock rolled back,
            // do not persist an effective exemption. Immediately attempt the current baseline.
            if after.now < context.now || after.now >= (plan.nextBoundary ?? context.now) || after.timeZone != context.timeZone {
                _ = try tx.recordGrant(applyingGrant.recording(status: after.now >= active.effectiveExpiresAt ? .expired : .invalidated), expected: applyingGrant)
                _ = try tx.recordCommand(changing(applying, status: after.now >= active.effectiveExpiresAt ? .expired : .uncertain), expected: applying)
                let remaining = try protectedGrants(context: after, transaction: tx)
                let baseline = try evaluation(snapshot: tx.snapshot(), context: after, grants: remaining)
                let recovery = restriction.apply(baseline, purpose: .reconciliation)
                let recoveredAt = capture(snapshot.activation)
                try recordDenied(context: recoveredAt, transaction: tx)
                if recoveredAt.authorization.status != .approved { _ = try protectedGrants(context: recoveredAt, transaction: tx) }
                let validRecovery = recoveredAt.authorization.status == .approved && recoveredAt.activation == after.activation
                    && recoveredAt.timeZone == after.timeZone && recoveredAt.now >= after.now
                    && recoveredAt.now < (baseline.nextBoundary ?? after.now)
                try observe(baseline, result: validRecovery ? recovery : .uncertain(.interrupted), context: recoveredAt, transaction: tx)
                try history(commandID, at: after.now, transaction: tx)
                return result(commandID, .committed, .interrupted)
            }
            let finalStatus: GrantStatus
            let commandStatus: CommandStatus
            let failure: OperationFailure?
            switch applied {
            case .accepted: finalStatus = .active; commandStatus = .succeeded; failure = nil
            case let .failed(error): finalStatus = .failed; commandStatus = .failed; failure = error
            case let .uncertain(error): finalStatus = .uncertain; commandStatus = .uncertain; failure = error
            }
            _ = try tx.recordGrant(applyingGrant.recording(status: finalStatus), expected: applyingGrant, registrationID: registrationID, context: after)
            _ = try tx.recordCommand(changing(applying, status: commandStatus), expected: applying)
            try observe(plan, result: applied, context: after, transaction: tx)
            try history(commandID, at: after.now, transaction: tx)
            return result(commandID, .committed, failure)
        }
    }

    func evaluation(snapshot: ControlSnapshot, context: EvaluationContext, grants: [TemporaryGrant]) throws -> Evaluation {
        guard context.authorization.status == .approved, context.activation == snapshot.activation else { throw CommandServiceError.invalidState }
        let assessment = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection), context: context, grants: grants)
        return Evaluation(id: identifiers.evaluationID(), policyRevision: snapshot.policy.revision,
            snapshotSequence: snapshot.snapshotSequence, evaluatedAt: context.now, timeZone: context.timeZone,
            nextBoundary: assessment.nextEvaluationAt, desiredTargets: assessment.desiredTargets)
    }

    /// A stored Active flag alone cannot authorize an exemption. Keep the old effective receipt
    /// during preparation of an unactivated candidate, but reject missing/fired/obsolete protection.
    func protectedGrants(context: EvaluationContext, excluding: GrantID? = nil, including: Set<GrantID>? = nil, transaction tx: ControlTransaction) throws -> [TemporaryGrant] {
        let policy = try tx.snapshot().policy
        let originals = try tx.unfinishedGrants().filter { $0.grant.id != excluding && (including?.contains($0.grant.id) ?? true) }
        let checked = try originals.map { stored -> TemporaryGrant in
            let grant = stored.grant
            guard grant.status == .active else { return grant }
            let registrations = try tx.registrations(grantID: grant.id)
            var protected = false
            for registration in registrations where registration.status == .registered && registration.firedAt == nil
                && registration.scheduledFor == grant.effectiveExpiresAt && registration.policyRevision <= policy.revision {
                guard let receipt = registration.receipt, receipt.acceptedAt <= context.now,
                      try tx.command(grant.commandID)?.status == .succeeded else { continue }
                if let candidate = registration.candidatePolicyRevision {
                    // An activated desired edit survives a failed own-store write. Its committed
                    // deadline still protects the previously confirmed grant during reconciliation.
                    guard try tx.activatedCandidateRevision(commandID: registration.commandID) == candidate,
                          candidate <= policy.revision else { continue }
                } else if registration.commandID != grant.commandID { continue }
                protected = true
                break
            }
            if protected { return grant }
            return try grant.recording(status: .uncertain)
        }
        let snapshot = try tx.snapshot()
        let evaluated = try GrantEvaluator.evaluate(policy: policy, selections: snapshot.selections.map(\.selection), context: context, grants: checked)
        return try evaluated.assessments.map { assessment in
            guard let previous = originals.first(where: { $0.grant.id == assessment.grant.id })?.grant else { throw CommandServiceError.invalidState }
            let updated = assessment.disposition == .shorteningRequired ? try previous.recording(status: .uncertain) : assessment.grant
            if updated != previous {
                _ = try tx.recordGrant(updated, expected: previous)
                _ = try tx.enqueueGrantHistory(eventID: identifiers.eventID(), grantID: updated.id, at: context.now, capacity: historyCapacity)
            }
            return updated
        }
    }

    func recordDenied(context: EvaluationContext, transaction tx: ControlTransaction) throws {
        let snapshot = try tx.snapshot()
        if context.authorization.status == .denied && snapshot.activation == .enabled {
            _ = try tx.setActivation(.awaitingReauthorizationConfirmation, expectedSequence: snapshot.snapshotSequence)
        }
    }

    func markObservationUncertain(at: Instant, failure: OperationFailure, transaction tx: ControlTransaction) throws {
        guard let current = try tx.snapshot().application else { return }
        let observation = try ApplicationObservation(evaluationID: current.evaluation.id, status: .uncertain,
            evidence: nil, observedAt: at, validUntil: nil, error: failure)
        _ = try tx.recordApplication(StoredApplication(evaluation: current.evaluation, observation: observation), expectedSequence: tx.snapshot().snapshotSequence)
    }

    func observe(_ evaluation: Evaluation, result: RestrictionApplicationResult, context: EvaluationContext, transaction tx: ControlTransaction) throws {
        let status: ApplicationStatus, evidence: ApplicationEvidence?, failure: OperationFailure?
        switch result {
        case let .accepted(value): status = .applied; evidence = value; failure = nil
        case let .failed(error): status = .failed; evidence = .writeAttempt; failure = error
        case let .uncertain(error): status = .uncertain; evidence = .writeAttempt; failure = error
        }
        let observation = try ApplicationObservation(evaluationID: evaluation.id, status: status, evidence: evidence,
            observedAt: context.now, validUntil: status == .applied ? evaluation.nextBoundary : nil, error: failure)
        let stored = try StoredApplication(evaluation: evaluation, observation: observation)
        _ = try tx.recordApplication(stored, expectedSequence: tx.snapshot().snapshotSequence)
    }

    func history(_ commandID: CommandID, at: Instant, transaction tx: ControlTransaction) throws {
        _ = try tx.enqueueCommandHistory(eventID: identifiers.eventID(), commandID: commandID, at: at, capacity: historyCapacity)
    }

    func registration(_ old: DeadlineRegistration, status: DeadlineStatus, receipt: DeadlineReceipt? = nil) throws -> DeadlineRegistration {
        try DeadlineRegistration(id: old.id, grantID: old.grantID, commandID: old.commandID, generation: old.generation,
            policyRevision: old.policyRevision, candidatePolicyRevision: old.candidatePolicyRevision, scheduledFor: old.scheduledFor,
            status: status, receipt: receipt ?? old.receipt, firedAt: old.firedAt)
    }

    /// A register await can finish after a stop/reblock/cancel. Preserve that late acceptance as
    /// cleanup evidence without allowing it to authorize an exemption or erase an observed fire.
    func storeScheduleReceipt(_ receipt: DeadlineReceipt, prepared: DeadlineRegistration) throws -> Bool {
        try repository.write { tx in
            guard let current = try tx.registration(prepared.id), current.grantID == prepared.grantID,
                  current.commandID == prepared.commandID, current.generation == prepared.generation,
                  current.policyRevision == prepared.policyRevision, current.candidatePolicyRevision == prepared.candidatePolicyRevision,
                  current.scheduledFor == prepared.scheduledFor else { throw CommandServiceError.invalidState }
            if current == prepared {
                _ = try tx.recordRegistration(registration(prepared, status: .registered, receipt: receipt), expected: prepared)
                return true
            }
            let status: DeadlineStatus = current.status == .obsolete ? .obsolete : current.firedAt != nil ? .fired : .unknown
            _ = try tx.recordRegistration(registration(current, status: status, receipt: receipt), expected: current)
            return false
        }
    }

    func changing(_ command: Command, status: CommandStatus, attempt: AttemptNumber? = nil) throws -> Command {
        try Command(id: command.id, kind: command.kind, status: status, expectedPolicyRevision: command.expectedPolicyRevision,
            candidatePolicyRevision: command.candidatePolicyRevision, attempt: attempt ?? command.attempt, reasonRef: command.reasonRef)
    }

    func result(_ id: CommandID, _ disposition: CommandRunDisposition, _ failure: OperationFailure? = nil) -> CommandRunResult {
        CommandRunResult(commandID: id, disposition: disposition, failure: failure)
    }
}
