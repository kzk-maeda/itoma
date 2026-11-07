/// These are ITOMA observations, not declarations of Apple's native API enums.
public enum AuthorizationStatus: String, Codable, Sendable { case unknown, denied, approved }

public struct AuthorizationObservation: Equatable, Sendable {
    public let status: AuthorizationStatus
    public let observedAt: Instant

    public init(status: AuthorizationStatus, observedAt: Instant) {
        self.status = status
        self.observedAt = observedAt
    }
}

public enum Activation: String, Codable, Sendable {
    case enabled, awaitingReauthorizationConfirmation, paused
}

/// All context is supplied by the caller. No current clock, locale, or time zone is read here.
public struct EvaluationContext: Equatable, Sendable {
    public let now: Instant
    public let timeZone: TimeZoneID
    public let authorization: AuthorizationObservation
    public let activation: Activation

    public init(
        now: Instant, timeZone: TimeZoneID,
        authorization: AuthorizationObservation, activation: Activation
    ) {
        self.now = now
        self.timeZone = timeZone
        self.authorization = authorization
        self.activation = activation
    }
}

public struct Evaluation: Equatable, Sendable {
    public let id: EvaluationID
    public let policyRevision: PolicyRevision
    public let snapshotSequence: SnapshotSequence
    public let evaluatedAt: Instant
    public let timeZone: TimeZoneID
    public let nextBoundary: Instant?
    public let desiredTargets: Set<TargetRef>

    public init(
        id: EvaluationID, policyRevision: PolicyRevision, snapshotSequence: SnapshotSequence,
        evaluatedAt: Instant, timeZone: TimeZoneID, nextBoundary: Instant?, desiredTargets: Set<TargetRef>
    ) {
        self.id = id
        self.policyRevision = policyRevision
        self.snapshotSequence = snapshotSequence
        self.evaluatedAt = evaluatedAt
        self.timeZone = timeZone
        self.nextBoundary = nextBoundary
        self.desiredTargets = desiredTargets
    }
}

public enum ApplicationStatus: String, Codable, Sendable {
    case unknown, applying, applied, failed, uncertain
}

/// Evidence is limited to ITOMA's own settings. Neither case proves system-wide blocking.
public enum ApplicationEvidence: String, Codable, Sendable { case writeAttempt, ownStoreReadback }

/// Adapter errors are mapped to these safe categories; raw OS errors stay out of shared models.
public enum OperationFailure: String, Codable, Sendable {
    case authorizationRequired, unavailable, busy, storageFailure, registrationFailure
    case osOperationFailure, interrupted, unknown
}

public struct ApplicationObservation: Equatable, Sendable {
    public let evaluationID: EvaluationID?
    public let status: ApplicationStatus
    public let evidence: ApplicationEvidence?
    public let observedAt: Instant
    public let validUntil: Instant?
    public let error: OperationFailure?

    public init(
        evaluationID: EvaluationID?, status: ApplicationStatus, evidence: ApplicationEvidence?,
        observedAt: Instant, validUntil: Instant?, error: OperationFailure?
    ) throws {
        if status == .applied && evaluationID == nil { throw ModelError.missingEvaluationID }
        if status == .applied && evidence == nil { throw ModelError.missingObservationEvidence }
        self.evaluationID = evaluationID
        self.status = status
        self.evidence = evidence
        self.observedAt = observedAt
        self.validUntil = validUntil
        self.error = error
    }
}
