import ItomaCore
import ItomaStorage

extension CommandService {
    /// Explicit early return for exactly one accepted grant. Its logical end is durable before
    /// attempting reblock; a duplicate/stale command identity cannot end a later grant.
    public func endTemporaryGrant(commandID: CommandID) async throws -> ReconciliationResult {
        try observedTransaction { tx, capture in
            let snapshot = try tx.snapshot()
            let context = try recordCurrentFacts(context: capture(snapshot.activation), updateObservation: false, transaction: tx)
            guard let stored = try tx.grantForCommand(commandID) else { throw CommandServiceError.invalidCommand }
            if !stored.hasEnded {
                _ = try tx.recordGrant(stored.grant.recording(status: .invalidated), expected: stored.grant)
                _ = try tx.enqueueGrantHistory(eventID: identifiers.eventID(), grantID: stored.grant.id,
                    at: context.now, capacity: historyCapacity)
                try markObservationUncertain(at: context.now, failure: .interrupted, transaction: tx)
            }
        }
        return await reconcile()
    }

    /// DeviceActivity callbacks are synchronous. Complete durable fire consumption and the own-
    /// store reconciliation before returning to the OS. No Task/await or cancellation is hidden
    /// here. Obsolete monitor cleanup remains durable for the app's later asynchronous pass.
    public func reconcileSynchronously(registrationID: RegistrationID? = nil,
                                      generation: RegistrationGeneration? = nil) -> ReconciliationResult {
        do {
            if let registrationID, let generation {
                try recordDeadlineCallback(registrationID: registrationID, generation: generation)
            } else if registrationID != nil || generation != nil {
                return ReconciliationResult(disposition: .uncertain, failure: .interrupted)
            }
            switch try beginReconciliation(recoverInterruptedCommands: false) {
            case let .blocked(result): return result
            case let .ready(frame): return try finalizeReconciliation(frame).result
            }
        } catch { return ReconciliationResult(disposition: .uncertain, failure: .storageFailure) }
    }

    struct ReconciliationFrame {
        let marker: EvaluationID
        let revision: PolicyRevision
        let activation: Activation
        let action: Command?
        let startedAt: Instant
        init(marker: EvaluationID, revision: PolicyRevision, activation: Activation, startedAt: Instant, action: Command? = nil) {
            self.marker = marker; self.revision = revision; self.activation = activation; self.startedAt = startedAt; self.action = action
        }
    }
    enum ReconciliationStart { case ready(ReconciliationFrame), blocked(ReconciliationResult) }
    struct ReconciliationCommit {
        let result: ReconciliationResult
        let applicationID: EvaluationID?
        let activation: Activation?
        let cleanup: [DeadlineRegistration]
    }

    /// A callback carries identity only. Even an unknown/old event can request a current-state
    /// evaluation, but cannot expire a different generation, activate a candidate, or create a grant.
    public func handleDeadlineCallback(registrationID: RegistrationID, generation: RegistrationGeneration) async -> ReconciliationResult {
        do {
            try recordDeadlineCallback(registrationID: registrationID, generation: generation)
        } catch { return ReconciliationResult(disposition: .uncertain, failure: .storageFailure) }
        return await reconcile()
    }

    /// Commit the consumed protection and its logical grant consequences together, before any OS
    /// write. Observation metadata is best effort separately, so its failure cannot undo the fire.
    func recordDeadlineCallback(registrationID: RegistrationID, generation: RegistrationGeneration) throws {
        try repository.requireOutsideTransaction()
        let changedAt: Instant? = try observedTransaction { tx, capture in
            let snapshot = try tx.snapshot()
            let context = try recordCurrentFacts(context: capture(snapshot.activation), updateObservation: false, transaction: tx)
            if let current = try tx.registration(registrationID), current.generation == generation, current.firedAt == nil {
                let fired = try DeadlineRegistration(id: current.id, grantID: current.grantID, commandID: current.commandID,
                    generation: current.generation, policyRevision: current.policyRevision,
                    candidatePolicyRevision: current.candidatePolicyRevision, scheduledFor: current.scheduledFor,
                    status: current.status == .obsolete ? .obsolete : .fired, receipt: current.receipt, firedAt: context.now)
                _ = try tx.recordRegistration(fired, expected: current)
                _ = try recordCurrentFacts(context: context, updateObservation: false, transaction: tx)
            }
            return try tx.snapshot().snapshotSequence != snapshot.snapshotSequence ? context.now : nil
        }
        if let changedAt {
            try? repository.write { try markObservationUncertain(at: changedAt, failure: .interrupted, transaction: $0) }
        }
    }

    /// Automatic evaluation never registers or retries a request. Set recovery only at a native
    /// lifecycle recovery boundary, not on every callback while another process may be registering.
    public func reconcile(recoverInterruptedCommands: Bool = false) async -> ReconciliationResult {
        do {
            switch try beginReconciliation(recoverInterruptedCommands: recoverInterruptedCommands) {
            case let .blocked(result): return result
            case let .ready(frame):
                let commit = try finalizeReconciliation(frame)
                return await cleanupReconciliation(commit)
            }
        } catch {
            // Own-store I/O may already have happened. Durable Applying and protective schedules
            // remain available; a database rollback is never described as an OS rollback.
            return ReconciliationResult(disposition: .uncertain, failure: .storageFailure)
        }
    }

    func beginReconciliation(recoverInterruptedCommands: Bool, action: Command? = nil) throws -> ReconciliationStart {
        try repository.requireOutsideTransaction()
        return try observedTransaction { tx, capture in
            let snapshot = try tx.snapshot()
            let context = try recordCurrentFacts(context: capture(snapshot.activation), updateObservation: false, transaction: tx)
            try settleEndedCommands(at: context.now, transaction: tx)
            if recoverInterruptedCommands {
                for command in try tx.commandsRequiringRecovery() where !inFlight.contains(command.id) {
                    _ = try tx.recordCommand(changing(command, status: .uncertain), expected: command)
                    if command.kind == .requestTemporaryGrant,
                       let stored = try tx.grantForCommand(command.id), !stored.hasEnded,
                       [.scheduling, .applying].contains(stored.grant.status) {
                        _ = try tx.recordGrant(stored.grant.recording(status: .uncertain), expected: stored.grant)
                        _ = try tx.enqueueGrantHistory(eventID: identifiers.eventID(), grantID: stored.grant.id,
                            at: context.now, capacity: historyCapacity)
                    }
                    try history(command.id, at: context.now, transaction: tx)
                }
            }
            var applyingAction: Command?
            if let action {
                guard let owned = try prepareActivationForApplication(action, context: context, transaction: tx) else {
                    return .blocked(ReconciliationResult(disposition: .requiresRecovery, failure: .interrupted))
                }
                applyingAction = owned
            }
            let current = try tx.snapshot(), plan = try reconciliationPlan(context: context, transaction: tx)
            guard canApply(context) else {
                try observe(plan, result: .uncertain(.authorizationRequired), context: context, transaction: tx)
                if let applyingAction {
                    _ = try tx.recordCommand(changing(applyingAction, status: .uncertain), expected: applyingAction)
                    try history(applyingAction.id, at: context.now, transaction: tx)
                }
                return .blocked(ReconciliationResult(disposition: .uncertain, failure: .authorizationRequired))
            }
            let applying = try ApplicationObservation(evaluationID: plan.id, status: .applying, evidence: nil,
                observedAt: context.now, validUntil: nil, error: nil)
            _ = try tx.recordApplication(StoredApplication(evaluation: plan, observation: applying), expectedSequence: tx.snapshot().snapshotSequence)
            return .ready(ReconciliationFrame(marker: plan.id, revision: current.policy.revision, activation: current.activation, startedAt: context.now, action: applyingAction))
        }
    }

    func finalizeReconciliation(_ frame: ReconciliationFrame) throws -> ReconciliationCommit {
        try observedTransaction { tx, capture in
            let commit = try applyReconciliation(frame, transaction: tx, capture: capture)
            if let action = frame.action, try tx.command(action.id) == action {
                let current = try tx.snapshot()
                let status: CommandStatus = current.activationCommandID != action.id || current.activation != frame.activation ? .superseded
                    : commit.result.disposition == .committed && commit.result.failure == nil ? .succeeded : .uncertain
                _ = try tx.recordCommand(changing(action, status: status), expected: action)
                try history(action.id, at: current.application?.observation.observedAt ?? frame.startedAt, transaction: tx)
            }
            return commit
        }
    }

    func applyReconciliation(_ frame: ReconciliationFrame, transaction tx: ControlTransaction,
                             capture: @ItomaControlActor (Activation) -> EvaluationContext) throws -> ReconciliationCommit {
        let before = try tx.snapshot()
        if let action = frame.action, try tx.command(action.id) != action || before.activationCommandID != action.id {
            return reconciliationCommit(.requiresRecovery, failure: .interrupted)
        }
        guard before.application?.evaluation.id == frame.marker, before.application?.observation.status == .applying else {
            return reconciliationCommit(.requiresRecovery, failure: .interrupted)
        }
        let context = try recordCurrentFacts(context: capture(before.activation), updateObservation: false, transaction: tx)
        let current = try tx.snapshot()
        guard current.policy.revision == frame.revision, current.activation == frame.activation else {
            try markObservationUncertain(at: context.now, failure: .interrupted, transaction: tx)
            return reconciliationCommit(.requiresRecovery, failure: .interrupted)
        }
        let plan = try reconciliationPlan(context: context, transaction: tx)
        guard canApply(context) else {
            try observe(plan, result: .uncertain(.authorizationRequired), context: context, transaction: tx)
            return reconciliationCommit(.uncertain, failure: .authorizationRequired)
        }
        let applied = restriction.apply(plan, purpose: .reconciliation)
        let after = try recordCurrentFacts(context: capture(current.activation), updateObservation: false, transaction: tx)
        if validResult(plan, started: context, after: after) {
            return try commitReconciliation(plan, result: applied, context: after, transaction: tx)
        }
        guard canApply(after), after.activation == context.activation else {
            try observe(plan, result: .uncertain(.authorizationRequired), context: after, transaction: tx)
            return reconciliationCommit(.uncertain, failure: .authorizationRequired)
        }
        // One immediate baseline attempt if a deadline/zone/clock boundary crossed during the
        // short write. No recursive retry; a second context change stays Uncertain.
        let baseline = try reconciliationPlan(context: after, transaction: tx)
        let recovery = restriction.apply(baseline, purpose: .reconciliation)
        let recoveredAt = try recordCurrentFacts(context: capture(after.activation), updateObservation: false, transaction: tx)
        guard validResult(baseline, started: after, after: recoveredAt) else {
            try observe(baseline, result: .uncertain(.interrupted), context: recoveredAt, transaction: tx)
            return reconciliationCommit(.uncertain, failure: .interrupted)
        }
        return try commitReconciliation(baseline, result: recovery, context: recoveredAt, transaction: tx)
    }

    func canApply(_ context: EvaluationContext) -> Bool {
        // Paused is durable, explicit user intent to clear ITOMA's store. Unknown authorization
        // with an enabled/confirmation-waiting intent never turns Core's empty plan into a clear.
        context.activation == .paused || context.authorization.status == .approved
    }

    func validResult(_ plan: Evaluation, started: EvaluationContext, after: EvaluationContext) -> Bool {
        canApply(after) && after.activation == started.activation && after.timeZone == started.timeZone
            && after.now >= started.now && after.now < (plan.nextBoundary ?? started.now)
    }

    func reconciliationPlan(context: EvaluationContext, transaction tx: ControlTransaction) throws -> Evaluation {
        let grants = try protectedGrants(context: context, transaction: tx), snapshot = try tx.snapshot()
        // Core provides the finite validity boundary even for a paused/unapproved observation.
        let evaluation = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection),
            context: context, grants: grants)
        return Evaluation(id: identifiers.evaluationID(), policyRevision: snapshot.policy.revision,
            snapshotSequence: snapshot.snapshotSequence, evaluatedAt: context.now, timeZone: context.timeZone,
            nextBoundary: evaluation.nextEvaluationAt, desiredTargets: evaluation.desiredTargets)
    }

    func settleEndedCommands(at now: Instant, transaction tx: ControlTransaction) throws {
        for stored in try tx.unreconciledGrants() where stored.hasEnded {
            guard let command = try tx.command(stored.grant.commandID),
                  [.pending, .scheduling, .applying, .failed, .uncertain].contains(command.status) else { continue }
            _ = try tx.recordCommand(changing(command, status: now >= stored.grant.effectiveExpiresAt ? .expired : .superseded), expected: command)
            try history(command.id, at: now, transaction: tx)
        }
    }

    func commitReconciliation(_ plan: Evaluation, result: RestrictionApplicationResult, context: EvaluationContext,
                              transaction tx: ControlTransaction) throws -> ReconciliationCommit {
        guard case .accepted = result else {
            let failure: OperationFailure
            switch result { case let .failed(error), let .uncertain(error): failure = error; case .accepted: failure = .unknown }
            try observe(plan, result: .uncertain(failure), context: context, transaction: tx)
            return reconciliationCommit(.uncertain, failure: failure)
        }
        // A previously confirmed grant with lost protection is retired after the current store
        // was successfully reconciled. Unconfirmed failed requests retain explicit retry and cap.
        try settleEndedCommands(at: context.now, transaction: tx)
        for stored in try tx.unreconciledGrants() {
            let ownerSucceeded = try tx.command(stored.grant.commandID)?.status == .succeeded
            guard stored.hasEnded || (ownerSucceeded && stored.grant.status != .active) else { continue }
            _ = try tx.recordGrant(stored.grant.recording(status: .reconciled), expected: stored.grant)
            _ = try tx.enqueueGrantHistory(eventID: identifiers.eventID(), grantID: stored.grant.id, at: context.now, capacity: historyCapacity)
        }
        try observe(plan, result: result, context: context, transaction: tx)
        return ReconciliationCommit(result: ReconciliationResult(disposition: .committed, failure: nil),
            applicationID: plan.id, activation: context.activation, cleanup: try tx.endedGrantRegistrations())
    }

    func reconciliationCommit(_ disposition: ReconciliationDisposition, failure: OperationFailure) -> ReconciliationCommit {
        ReconciliationCommit(result: ReconciliationResult(disposition: disposition, failure: failure), applicationID: nil, activation: nil, cleanup: [])
    }

    func cleanupReconciliation(_ commit: ReconciliationCommit) async -> ReconciliationResult {
        guard commit.applicationID != nil else { return commit.result }
        var failure: OperationFailure?
        for old in commit.cleanup {
            do {
                let context = try refreshCurrentFacts()
                guard try reconciliationIsCurrent(commit, context: context) else {
                    return ReconciliationResult(disposition: .requiresRecovery, failure: .interrupted)
                }
                // The successful current-store result is committed; no writer survives cancel.
                // A typed registration rejection is already a final negative acceptance fact.
                let cancellation: DeadlineCancellationResult = old.status == .failed ? .accepted : await scheduler.cancel(old)
                try repository.write { tx in
                    guard let latest = try tx.registration(old.id), try tx.grant(old.grantID)?.hasEnded == true else {
                        throw CommandServiceError.invalidState
                    }
                    if latest.status == .obsolete { return }
                    let status: DeadlineStatus
                    switch cancellation {
                    case .accepted:
                        // Registration may still be in an external await and finish after cancel.
                        // Without a receipt/fire fact, cancellation cannot be considered final.
                        status = old.receipt != nil || old.firedAt != nil || old.status == .failed ? .obsolete : .unknown
                        if status == .unknown { failure = .interrupted }
                    case let .unknown(error): status = .unknown; failure = error
                    }
                    _ = try tx.recordRegistration(registration(latest, status: status), expected: latest)
                }
                let after = try refreshCurrentFacts()
                if try !reconciliationIsCurrent(commit, context: after) {
                    return ReconciliationResult(disposition: .requiresRecovery, failure: .interrupted)
                }
            } catch { failure = .storageFailure }
        }
        return ReconciliationResult(disposition: .committed, failure: failure)
    }

    func reconciliationIsCurrent(_ commit: ReconciliationCommit, context: EvaluationContext) throws -> Bool {
        let snapshot = try repository.readSnapshot()
        guard let current = snapshot.application else { return false }
        let valid = current.evaluation.id == commit.applicationID && current.observation.status == .applied
            && snapshot.activation == commit.activation && context.activation == commit.activation
            && snapshot.policy.revision == current.evaluation.policyRevision
            && current.evaluation.timeZone == context.timeZone && canApply(context)
            && context.now >= current.evaluation.evaluatedAt && context.now < (current.observation.validUntil ?? context.now)
        if !valid && current.evaluation.id == commit.applicationID {
            try repository.write { tx in
                guard try tx.snapshot().application?.evaluation.id == commit.applicationID else { return }
                try markObservationUncertain(at: context.now, failure: .interrupted, transaction: tx)
            }
        }
        return valid
    }
}
