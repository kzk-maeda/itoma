import Foundation
import ItomaCore
import ItomaStorage

/// Process-local isolation only. SQLite coordinates with other processes; no JS runtime is needed.
@globalActor public actor ItomaControlActor {
    public static let shared = ItomaControlActor()
}

public enum DeadlineScheduleResult: Equatable, Sendable {
    case accepted(DeadlineReceipt)
    case rejected(OperationFailure)
    case unknown(OperationFailure)
}

public enum DeadlineCancellationResult: Equatable, Sendable {
    case accepted
    case unknown(OperationFailure)
}

@ItomaControlActor public protocol DeadlineScheduler: AnyObject {
    func register(_ registration: DeadlineRegistration) async -> DeadlineScheduleResult
    func cancel(_ registration: DeadlineRegistration) async -> DeadlineCancellationResult
}

public enum RestrictionApplicationResult: Equatable, Sendable {
    case accepted(ApplicationEvidence)
    case failed(OperationFailure)
    case uncertain(OperationFailure)
}
public enum RestrictionPurpose: Equatable, Sendable { case temporaryGrant, policyCandidate, reconciliation }

/// Only short synchronous own-store operations belong here. No prompt, network, or await.
/// Native feasibility and evidence/readback limits must be measured separately on iOS.
@ItomaControlActor public protocol RestrictionAdapter: AnyObject {
    func apply(_ evaluation: Evaluation) -> RestrictionApplicationResult
    func apply(_ evaluation: Evaluation, purpose: RestrictionPurpose) -> RestrictionApplicationResult
}
extension RestrictionAdapter {
    public func apply(_ evaluation: Evaluation, purpose: RestrictionPurpose) -> RestrictionApplicationResult { apply(evaluation) }
}

/// One clock precision for calendar schedules, context and API acceptance observations.
public enum NativeScheduleClock {
    public static func instant(_ date: Date) throws -> Instant {
        try Instant(secondsSince1970: date.timeIntervalSince1970.rounded(.down))
    }
}

@ItomaControlActor public protocol EvaluationContextProvider: AnyObject {
    func context(activation: Activation) -> EvaluationContext
}

@ItomaControlActor public protocol ControlIdentifiers: AnyObject {
    func registrationID() -> RegistrationID
    func evaluationID() -> EvaluationID
    func eventID() -> EventID
}

@ItomaControlActor public final class RandomControlIdentifiers: ControlIdentifiers {
    public init() {}
    public func registrationID() -> RegistrationID { RegistrationID(UUID()) }
    public func evaluationID() -> EvaluationID { EvaluationID(UUID()) }
    public func eventID() -> EventID { EventID(UUID()) }
}

public enum CommandRunDisposition: Sendable { case committed, inProgress, requiresRecovery, requiresExplicitRetry, uncertain }

/// Committed refers to repository results, not system-wide OS behavior. Read the command/observation.
public struct CommandRunResult: Sendable {
    public let commandID: CommandID
    public let disposition: CommandRunDisposition
    public let failure: OperationFailure?
}

public enum CommandServiceError: Error, Equatable, Sendable {
    case invalidCommand, invalidState, confirmationRequired, confirmationChanged, superseded, authorizationRequired
}

public enum ReconciliationDisposition: Sendable { case committed, requiresRecovery, uncertain }

/// A bounded observation of ITOMA's own store, never a system-wide blocking guarantee.
public struct ReconciliationResult: Sendable {
    public let disposition: ReconciliationDisposition
    public let failure: OperationFailure?
}
