import ItomaCore
import ItomaStorage

extension CommandService {
    struct CandidatePreparation {
        let candidate: PolicyCandidate
        let attempt: AttemptNumber
        let confirmation: PolicyEditAssessment
        let registrations: [DeadlineRegistration]
        let oldProtection: [DeadlineRegistration]
    }
    struct CandidateCommit {
        let result: CommandRunResult
        let cleanup: [DeadlineRegistration]
        let requiresConfirmation: Bool
        init(result: CommandRunResult, cleanup: [DeadlineRegistration], requiresConfirmation: Bool = false) {
            self.result = result; self.cleanup = cleanup; self.requiresConfirmation = requiresConfirmation
        }
    }

    /// Refresh native authorization facts, then preview the immutable stored candidate. Drafts and
    /// the active policy are not changed. Denied/unknown observations can invalidate old grants.
    public func previewCandidate(commandID: CommandID) throws -> PolicyEditAssessment {
        let captured = try refreshCurrentFacts()
        return try repository.write { tx in
            guard let candidate = try tx.candidate(commandID: commandID) else { throw CommandServiceError.invalidCommand }
            let snapshot = try tx.snapshot(), context = rebinding(captured, activation: snapshot.activation)
            guard candidate.expectedRevision == snapshot.policy.revision else { throw CommandServiceError.superseded }
            return try GrantEditEvaluator.preview(candidate: candidate, activePolicy: snapshot.policy,
                selections: snapshot.selections.map(\.selection), context: context, snapshotSequence: snapshot.snapshotSequence,
                grants: tx.unfinishedGrants().filter { !$0.hasEnded }.map(\.grant))
        }
    }

    public func executeAcceptedCandidate(commandID: CommandID, confirmation: PolicyEditAssessment? = nil) async throws -> CommandRunResult {
        guard let command = try repository.command(commandID), command.kind == .commitPolicy else { throw CommandServiceError.invalidCommand }
        if inFlight.contains(commandID) { return result(commandID, .inProgress) }
        switch command.status {
        case .succeeded, .cancelled, .expired, .superseded: return result(commandID, .committed)
        case .failed, .uncertain: return result(commandID, .requiresExplicitRetry)
        case .applying, .scheduling: return result(commandID, .requiresRecovery)
        case .pending: break
        }
        inFlight.insert(commandID)
        defer { inFlight.remove(commandID) }
        let frame: CandidatePreparation
        do {
            let captured = try refreshCurrentFacts()
            frame = try prepareCandidate(command: command, confirmation: confirmation, context: captured)
        } catch CommandServiceError.superseded {
            return settleCandidateFailure(commandID, attempt: command.attempt, status: .superseded, failure: .interrupted)
        }
        for preparing in frame.registrations {
            guard let current = try repository.command(commandID), current.status == .scheduling,
                  current.attempt == frame.attempt else { return result(commandID, .requiresRecovery, .interrupted) }
            let registered = await scheduler.register(preparing)
            switch registered {
            case let .accepted(receipt):
                guard receipt.registrationID == preparing.id, receipt.generation == preparing.generation,
                      receipt.scheduledFor == preparing.scheduledFor else {
                    return settleCandidateFailure(commandID, attempt: command.attempt, status: .uncertain, failure: .registrationFailure)
                }
                do {
                    guard try storeScheduleReceipt(receipt, prepared: preparing) else {
                        return settleCandidateFailure(commandID, attempt: command.attempt, status: .uncertain, failure: .interrupted)
                    }
                    _ = try refreshCurrentFacts()
                } catch { return settleCandidateFailure(commandID, attempt: command.attempt, status: .uncertain, failure: .storageFailure) }
            case let .rejected(failure):
                do { try storeScheduleFailure(preparing, uncertain: false) }
                catch { return settleCandidateFailure(commandID, attempt: command.attempt, status: .uncertain, failure: .storageFailure) }
                return settleCandidateFailure(commandID, attempt: command.attempt, status: .failed, failure: failure)
            case let .unknown(failure):
                do { try storeScheduleFailure(preparing, uncertain: true) }
                catch { return settleCandidateFailure(commandID, attempt: command.attempt, status: .uncertain, failure: .storageFailure) }
                return settleCandidateFailure(commandID, attempt: command.attempt, status: .uncertain, failure: failure)
            }
        }
        var marker: EvaluationID?
        let commit: CandidateCommit
        do {
            // Negative authorization facts commit even when a subsequent confirmation is stale.
            let captured = try refreshCurrentFacts()
            switch try beginCandidateApplication(frame, context: captured) {
            case let .resolved(stopped): return stopped
            case let .ready(value):
                marker = value
                commit = try finalizeCandidate(frame, applicationID: value)
            }
        } catch CommandServiceError.confirmationChanged {
            let saved = settleCandidateFailure(commandID, attempt: command.attempt, status: .failed, failure: .interrupted, applicationID: marker)
            if saved.disposition == .uncertain { return saved }
            throw CommandServiceError.confirmationChanged
        } catch CommandServiceError.superseded {
            return settleCandidateFailure(commandID, attempt: command.attempt, status: .superseded, failure: .interrupted, applicationID: marker)
        } catch {
            // Preserve the durable Applying marker and both old/new protection after any possible
            // OS side effect. Recovery evaluates the current active policy, not this old frame.
            return result(commandID, .uncertain, .storageFailure)
        }
        if commit.requiresConfirmation { throw CommandServiceError.confirmationChanged }
        guard commit.result.failure == nil else { return commit.result }
        return await cleanupCandidateProtection(frame, commit: commit)
    }

    /// Preserve an external outcome even when reconciliation already changed Preparing during
    /// the await. A definite rejection is final cleanup evidence, not a new grant permission.
    func storeScheduleFailure(_ prepared: DeadlineRegistration, uncertain: Bool) throws {
        try repository.write { tx in
            guard let current = try tx.registration(prepared.id) else { throw CommandServiceError.invalidState }
            if current.status == .obsolete { return }
            let status: DeadlineStatus = current.firedAt != nil ? .fired : uncertain || current.receipt != nil ? .unknown : .failed
            _ = try tx.recordRegistration(registration(current, status: status), expected: current)
        }
    }

    public func retryCandidate(commandID: CommandID, confirmation: PolicyEditAssessment? = nil) async throws -> CommandRunResult {
        guard !inFlight.contains(commandID) else { return result(commandID, .inProgress) }
        guard let command = try repository.command(commandID), command.kind == .commitPolicy,
              [.failed, .uncertain].contains(command.status) else { throw CommandServiceError.invalidState }
        // A failed store operation may already have committed the desired policy. Do not activate
        // the base+1 candidate again; the shared reconciler reapplies current state in that case.
        let activated = try repository.write { try $0.activatedCandidateRevision(commandID: commandID) }
        if activated != nil { return result(commandID, .requiresRecovery) }
        try repository.write { tx in
            guard try tx.command(commandID) == command else { throw CommandServiceError.invalidState }
            _ = try tx.recordCommand(changing(command, status: .pending, attempt: command.attempt.next()), expected: command)
        }
        return try await executeAcceptedCandidate(commandID: commandID, confirmation: confirmation)
    }

    func checkedCandidate(
        _ candidate: PolicyCandidate, confirmation: PolicyEditAssessment?, context captured: EvaluationContext, transaction tx: ControlTransaction
    ) throws -> PolicyEditAssessment {
        let snapshot = try tx.snapshot(), context = rebinding(captured, activation: snapshot.activation)
        guard snapshot.policy.revision == candidate.expectedRevision else { throw CommandServiceError.superseded }
        let grants = try tx.unfinishedGrants().filter { !$0.hasEnded }.map(\.grant)
        if let confirmation {
            do {
                return try GrantEditEvaluator.checkConfirmation(confirmation, candidate: candidate, activePolicy: snapshot.policy,
                    selections: snapshot.selections.map(\.selection), context: context, snapshotSequence: snapshot.snapshotSequence, grants: grants)
            } catch { throw CommandServiceError.confirmationChanged }
        }
        let preview = try GrantEditEvaluator.preview(candidate: candidate, activePolicy: snapshot.policy,
            selections: snapshot.selections.map(\.selection), context: context, snapshotSequence: snapshot.snapshotSequence, grants: grants)
        guard !preview.requiresConfirmation else { throw CommandServiceError.confirmationRequired }
        return preview
    }

    func prepareCandidate(command: Command, confirmation: PolicyEditAssessment?, context: EvaluationContext) throws -> CandidatePreparation {
        try repository.write { tx in
            guard try tx.command(command.id) == command, let candidate = try tx.candidate(commandID: command.id) else { throw CommandServiceError.invalidCommand }
            let preview = try checkedCandidate(candidate, confirmation: confirmation, context: context, transaction: tx)
            var registrations: [DeadlineRegistration] = [], oldProtection: [DeadlineRegistration] = []
            _ = try tx.recordCommand(changing(command, status: .scheduling), expected: command)
            for impact in preview.impacts where impact.kind != .unchanged {
                guard let grant = try tx.grant(impact.grantID)?.grant else { throw CommandServiceError.invalidState }
                oldProtection += try tx.registrations(grantID: grant.id).filter {
                    $0.status == .registered && $0.firedAt == nil && $0.scheduledFor == grant.effectiveExpiresAt
                }
                if impact.kind == .shorten {
                    guard let expiry = impact.proposedExpiresAt else { throw CommandServiceError.invalidState }
                    let prepared = try DeadlineRegistration(id: identifiers.registrationID(), grantID: grant.id, commandID: command.id,
                        generation: tx.latestRegistration(grantID: grant.id).map { try $0.generation.next() } ?? RegistrationGeneration(0),
                        policyRevision: candidate.expectedRevision, candidatePolicyRevision: candidate.proposedPolicy.revision,
                        scheduledFor: expiry, status: .preparing)
                    _ = try tx.recordRegistration(prepared)
                    registrations.append(prepared)
                }
            }
            return CandidatePreparation(candidate: candidate, attempt: command.attempt, confirmation: confirmation ?? preview, registrations: registrations, oldProtection: oldProtection)
        }
    }

    func changes(for preview: PolicyEditAssessment, frame: CandidatePreparation, transaction tx: ControlTransaction) throws -> [RegisteredGrantChange] {
        try preview.impacts.filter { $0.kind != .unchanged }.map { impact in
            guard let expected = try tx.grant(impact.grantID)?.grant else { throw CommandServiceError.invalidState }
            let updated: TemporaryGrant
            let registrationID: RegistrationID?
            switch impact.kind {
            case .shorten:
                guard let expiry = impact.proposedExpiresAt,
                      let registration = frame.registrations.first(where: { $0.grantID == impact.grantID && $0.scheduledFor == expiry }) else { throw CommandServiceError.confirmationChanged }
                updated = try expected.shortened(to: expiry); registrationID = registration.id
            case .invalidate: updated = try expected.recording(status: .invalidated); registrationID = nil
            case .expire: updated = try expected.recording(status: .expired); registrationID = nil
            case .uncertain: updated = try expected.recording(status: .uncertain); registrationID = nil
            case .unchanged: throw CommandServiceError.invalidState
            }
            return RegisteredGrantChange(expected: expected, updated: updated, registrationID: registrationID)
        }
    }

    func beginCandidateApplication(_ frame: CandidatePreparation, context captured: EvaluationContext) throws -> ApplicationStart {
        try repository.write { tx in
            guard let command = try tx.command(frame.candidate.commandID), command.status == .scheduling, command.attempt == frame.attempt else {
                return .resolved(result(frame.candidate.commandID, .requiresRecovery))
            }
            let preview = try checkedCandidate(frame.candidate, confirmation: frame.confirmation, context: captured, transaction: tx)
            let snapshot = try tx.snapshot(), context = rebinding(captured, activation: snapshot.activation)
            let applying = try changing(command, status: .applying)
            _ = try tx.recordCommand(applying, expected: command)
            if context.authorization.status != .approved {
                // Explicitly saved settings without an exemption are valid even without OS access.
                _ = try tx.activateCandidate(commandID: command.id, expectedSequence: tx.snapshot().snapshotSequence,
                    context: context, confirmation: frame.confirmation, grantChanges: changes(for: preview, frame: frame, transaction: tx))
                _ = try tx.recordCommand(changing(applying, status: .succeeded), expected: applying)
                try recordUnverifiedCurrent(context: context, failure: .authorizationRequired, transaction: tx)
                try history(command.id, at: context.now, transaction: tx)
                return .resolved(result(command.id, .committed, .authorizationRequired))
            }
            // This marker records the current/base context, not the still-unactivated candidate.
            // Its Applying state has no evidence/validUntil; only the final result uses the new plan.
            let plan = try evaluation(snapshot: tx.snapshot(), context: context, grants: tx.unfinishedGrants().map(\.grant))
            let observation = try ApplicationObservation(evaluationID: plan.id, status: .applying, evidence: nil,
                observedAt: context.now, validUntil: nil, error: nil)
            _ = try tx.recordApplication(StoredApplication(evaluation: plan, observation: observation), expectedSequence: tx.snapshot().snapshotSequence)
            return .ready(plan.id)
        }
    }

    func finalizeCandidate(_ frame: CandidatePreparation, applicationID: EvaluationID) throws -> CandidateCommit {
        try observedTransaction { tx, capture in
            guard let command = try tx.command(frame.candidate.commandID), command.status == .applying,
                  command.attempt == frame.attempt else {
                return CandidateCommit(result: result(frame.candidate.commandID, .requiresRecovery, .interrupted), cleanup: [])
            }
            let snapshot = try tx.snapshot()
            guard snapshot.application?.evaluation.id == applicationID, snapshot.application?.observation.status == .applying else {
                return CandidateCommit(result: result(command.id, .requiresRecovery, .interrupted), cleanup: [])
            }
            let observed = capture(snapshot.activation)
            let context = try recordCurrentFacts(context: observed, transaction: tx)
            if context.authorization.status != .approved {
                try recordDenied(context: context, transaction: tx)
                _ = try protectedGrants(context: context, transaction: tx)
                _ = try tx.recordCommand(changing(command, status: .failed), expected: command)
                try markObservationUncertain(at: context.now, failure: .authorizationRequired, transaction: tx)
                return CandidateCommit(result: result(command.id, .committed, .authorizationRequired), cleanup: [])
            }
            let preview: PolicyEditAssessment
            do { preview = try checkedCandidate(frame.candidate, confirmation: frame.confirmation, context: context, transaction: tx) }
            catch CommandServiceError.confirmationChanged {
                _ = try tx.recordCommand(changing(command, status: .failed), expected: command)
                try markObservationUncertain(at: context.now, failure: .interrupted, transaction: tx)
                try history(command.id, at: context.now, transaction: tx)
                return CandidateCommit(result: result(command.id, .committed, .interrupted), cleanup: [], requiresConfirmation: true)
            } catch CommandServiceError.superseded {
                _ = try tx.recordCommand(changing(command, status: .superseded), expected: command)
                try markObservationUncertain(at: context.now, failure: .interrupted, transaction: tx)
                return CandidateCommit(result: result(command.id, .committed, .interrupted), cleanup: [])
            }
            _ = try tx.activateCandidate(commandID: command.id, expectedSequence: tx.snapshot().snapshotSequence,
                context: context, confirmation: frame.confirmation, grantChanges: changes(for: preview, frame: frame, transaction: tx))
            let grants = try protectedGrants(context: context, transaction: tx)
            let plan = try evaluation(snapshot: tx.snapshot(), context: context, grants: grants)
            let applied = restriction.apply(plan, purpose: .policyCandidate)
            let after = capture(snapshot.activation)
            let changed = after.now < context.now || after.now >= (plan.nextBoundary ?? context.now)
                || after.timeZone != context.timeZone || after.authorization.status != .approved || after.activation != context.activation
            if changed {
                try recordDenied(context: after, transaction: tx)
                let freshGrants = try protectedGrants(context: after, transaction: tx)
                if after.authorization.status == .approved && after.activation == context.activation {
                    let recovery = try evaluation(snapshot: tx.snapshot(), context: after, grants: freshGrants)
                    let recovered = restriction.apply(recovery, purpose: .reconciliation), finalContext = capture(snapshot.activation)
                    try recordDenied(context: finalContext, transaction: tx)
                    if finalContext.authorization.status != .approved { _ = try protectedGrants(context: finalContext, transaction: tx) }
                    let valid = finalContext.authorization.status == .approved && finalContext.activation == after.activation
                        && finalContext.timeZone == after.timeZone && finalContext.now >= after.now
                        && finalContext.now < (recovery.nextBoundary ?? after.now)
                    try observe(recovery, result: valid ? recovered : .uncertain(.interrupted), context: finalContext, transaction: tx)
                } else { try observe(plan, result: .uncertain(.authorizationRequired), context: after, transaction: tx) }
                _ = try tx.recordCommand(changing(command, status: .uncertain), expected: command)
                try history(command.id, at: after.now, transaction: tx)
                return CandidateCommit(result: result(command.id, .committed, .interrupted), cleanup: [])
            }
            let status: CommandStatus, failure: OperationFailure?
            switch applied {
            case .accepted: status = .succeeded; failure = nil
            case let .failed(error): status = .failed; failure = error
            case let .uncertain(error): status = .uncertain; failure = error
            }
            _ = try tx.recordCommand(changing(command, status: status), expected: command)
            try observe(plan, result: applied, context: after, transaction: tx)
            try history(command.id, at: after.now, transaction: tx)
            return CandidateCommit(result: result(command.id, .committed, failure), cleanup: failure == nil ? frame.oldProtection : [])
        }
    }

    func recordUnverifiedCurrent(context: EvaluationContext, failure: OperationFailure, transaction tx: ControlTransaction) throws {
        let snapshot = try tx.snapshot()
        let assessed = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection), context: context,
            grants: tx.unfinishedGrants().map(\.grant))
        let plan = Evaluation(id: identifiers.evaluationID(), policyRevision: snapshot.policy.revision, snapshotSequence: snapshot.snapshotSequence,
            evaluatedAt: context.now, timeZone: context.timeZone, nextBoundary: assessed.nextEvaluationAt, desiredTargets: assessed.desiredTargets)
        try observe(plan, result: .uncertain(failure), context: context, transaction: tx)
    }

    func settleCandidateFailure(
        _ commandID: CommandID, attempt: AttemptNumber, status: CommandStatus, failure: OperationFailure, applicationID: EvaluationID? = nil
    ) -> CommandRunResult {
        do {
            let captured = try refreshCurrentFacts()
            let owned = try repository.write { tx -> Bool in
                guard let command = try tx.command(commandID) else { throw CommandServiceError.invalidCommand }
                guard command.attempt == attempt else { return false }
                if [.pending, .scheduling, .applying, .failed, .uncertain].contains(command.status) {
                    _ = try tx.recordCommand(changing(command, status: status), expected: command)
                }
                let snapshot = try tx.snapshot(), context = rebinding(captured, activation: snapshot.activation)
                if let applicationID, snapshot.application?.evaluation.id == applicationID {
                    try markObservationUncertain(at: context.now, failure: failure, transaction: tx)
                }
                try history(command.id, at: context.now, transaction: tx)
                return true
            }
            return result(commandID, owned ? .committed : .requiresRecovery, owned ? failure : .interrupted)
        } catch { return result(commandID, .uncertain, .storageFailure) }
    }

    func cleanupCandidateProtection(_ frame: CandidatePreparation, commit: CandidateCommit) async -> CommandRunResult {
        var failure: OperationFailure?
        for old in commit.cleanup {
            let canceled = await scheduler.cancel(old)
            do {
                _ = try refreshCurrentFacts()
                try repository.write { tx in
                    guard let latest = try tx.registration(old.id) else { throw CommandServiceError.invalidState }
                    let status: DeadlineStatus
                    switch canceled { case .accepted: status = .obsolete; case let .unknown(error): status = .unknown; failure = error }
                    if latest.status != .obsolete {
                        _ = try tx.recordRegistration(registration(latest, status: status), expected: latest)
                    }
                }
                if try repository.readSnapshot().application?.observation.status != .applied {
                    return result(frame.candidate.commandID, .committed, .interrupted)
                }
            } catch { failure = .storageFailure }
        }
        return result(frame.candidate.commandID, .committed, failure)
    }
}
