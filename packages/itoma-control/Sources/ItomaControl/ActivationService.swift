import ItomaCore
import ItomaStorage

extension CommandService {
    /// Explicit user operations. Acceptance persists intent before any own-store side effect.
    public func stop(commandID: CommandID) async throws -> CommandRunResult {
        try acceptActivationRequest(commandID: commandID, kind: .stop)
        return try await executeAcceptedActivation(commandID: commandID)
    }

    public func resume(commandID: CommandID) async throws -> CommandRunResult {
        try acceptActivationRequest(commandID: commandID, kind: .resumeAfterAuthorization)
        return try await executeAcceptedActivation(commandID: commandID)
    }

    func acceptActivationRequest(commandID: CommandID, kind: CommandKind) throws {
        try repository.requireOutsideTransaction()
        if let existing = try repository.command(commandID) {
            guard existing.kind == kind else { throw CommandServiceError.invalidCommand }
            return // Never replay an old intent, even if policy/Activation has since changed.
        }
        try observedTransaction { tx, capture in
            let before = try tx.snapshot()
            let context = try recordCurrentFacts(context: capture(before.activation), updateObservation: false, transaction: tx)
            if kind == .resumeAfterAuthorization && context.authorization.status != .approved {
                throw CommandServiceError.authorizationRequired
            }
            let current = try tx.snapshot()
            let command = try Command(id: commandID, kind: kind, status: .pending,
                expectedPolicyRevision: current.policy.revision, attempt: AttemptNumber(0))
            _ = try tx.acceptActivationCommand(command: command, context: context, expectedSequence: current.snapshotSequence)
            try history(commandID, at: context.now, transaction: tx)
        }
    }

    public func executeAcceptedActivation(commandID: CommandID) async throws -> CommandRunResult {
        guard let command = try repository.command(commandID), [.stop, .resumeAfterAuthorization].contains(command.kind) else {
            throw CommandServiceError.invalidCommand
        }
        if inFlight.contains(commandID) { return result(commandID, .inProgress) }
        switch command.status {
        case .succeeded, .cancelled, .superseded, .expired: return result(commandID, .committed)
        case .failed, .uncertain: return result(commandID, .requiresExplicitRetry)
        case .scheduling, .applying: return result(commandID, .requiresRecovery)
        case .pending: break
        }
        inFlight.insert(commandID); defer { inFlight.remove(commandID) }
        do {
            let reconciled: ReconciliationResult
            switch try beginReconciliation(recoverInterruptedCommands: false, action: command) {
            case let .blocked(value): reconciled = value
            case let .ready(frame): reconciled = await cleanupReconciliation(try finalizeReconciliation(frame))
            }
            let disposition: CommandRunDisposition
            switch reconciled.disposition {
            case .committed: disposition = .committed
            case .requiresRecovery: disposition = .requiresRecovery
            case .uncertain: disposition = .uncertain
            }
            return result(commandID, disposition, reconciled.failure)
        } catch { return result(commandID, .uncertain, .storageFailure) }
    }

    /// Fresh explicit confirmation is required again. A newer user action supersedes this retry;
    /// retrying a stop/resume never revives or extends any old temporary grant.
    public func retryActivation(commandID: CommandID) async throws -> CommandRunResult {
        if inFlight.contains(commandID) { return result(commandID, .inProgress) }
        guard let command = try repository.command(commandID), [.stop, .resumeAfterAuthorization].contains(command.kind),
              [.failed, .uncertain].contains(command.status) else { throw CommandServiceError.invalidState }
        let resolved: CommandRunResult? = try observedTransaction { tx, capture in
            guard try tx.command(commandID) == command else { throw CommandServiceError.invalidState }
            let snapshot = try tx.snapshot()
            let context = try recordCurrentFacts(context: capture(snapshot.activation), updateObservation: false, transaction: tx)
            let current = try tx.snapshot()
            guard current.activationCommandID == commandID else {
                _ = try tx.recordCommand(changing(command, status: .superseded), expected: command)
                try history(commandID, at: context.now, transaction: tx)
                return result(commandID, .committed, .interrupted)
            }
            if command.kind == .resumeAfterAuthorization && context.authorization.status != .approved {
                return result(commandID, .requiresExplicitRetry, .authorizationRequired)
            }
            _ = try tx.setActivation(activation(for: command), expectedSequence: current.snapshotSequence)
            _ = try tx.recordCommand(changing(command, status: .pending, attempt: command.attempt.next()), expected: command)
            try history(commandID, at: context.now, transaction: tx)
            return nil
        }
        if let resolved { return resolved }
        return try await executeAcceptedActivation(commandID: commandID)
    }

    func activation(for command: Command) -> Activation { command.kind == .stop ? .paused : .enabled }

    func prepareActivationForApplication(_ command: Command, context: EvaluationContext,
                                         transaction tx: ControlTransaction) throws -> Command? {
        guard try tx.command(command.id) == command, command.status == .pending else { throw CommandServiceError.invalidState }
        let current = try tx.snapshot()
        guard current.activationCommandID == command.id, current.activation == activation(for: command) else {
            _ = try tx.recordCommand(changing(command, status: .superseded), expected: command)
            try history(command.id, at: context.now, transaction: tx)
            return nil
        }
        let applying = try changing(command, status: .applying)
        _ = try tx.recordCommand(applying, expected: command)
        return applying
    }
}
