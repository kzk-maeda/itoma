public enum CommandKind: String, Codable, Sendable {
    case commitPolicy, requestTemporaryGrant, retryCommand, resumeAfterAuthorization, stop
}

public enum CommandStatus: String, Codable, Sendable {
    case pending, scheduling, applying, succeeded, failed, uncertain, superseded, expired, cancelled
}

/// Operation metadata, not an executable command or an OS result.
public struct Command: Equatable, Sendable {
    public let id: CommandID
    public let kind: CommandKind
    public let status: CommandStatus
    public let expectedPolicyRevision: PolicyRevision
    public let candidatePolicyRevision: PolicyRevision?
    public let attempt: AttemptNumber
    public let reasonRef: ReasonRef?

    public init(
        id: CommandID, kind: CommandKind, status: CommandStatus,
        expectedPolicyRevision: PolicyRevision, candidatePolicyRevision: PolicyRevision? = nil,
        attempt: AttemptNumber, reasonRef: ReasonRef? = nil
    ) throws {
        if kind == .commitPolicy {
            guard candidatePolicyRevision == (try expectedPolicyRevision.next()) else {
                throw ModelError.invalidCommandRevision
            }
        } else if candidatePolicyRevision != nil {
            throw ModelError.invalidCommandRevision
        }
        self.id = id
        self.kind = kind
        self.status = status
        self.expectedPolicyRevision = expectedPolicyRevision
        self.candidatePolicyRevision = candidatePolicyRevision
        self.attempt = attempt
        self.reasonRef = reasonRef
    }
}

public struct OccurrenceKey: Hashable, Sendable {
    public let ruleID: RuleID
    public let ruleVersion: RuleVersion
    public let startDay: LocalDate
    public let timeZone: TimeZoneID
    public let resolvedStart: Instant

    public init(
        ruleID: RuleID, ruleVersion: RuleVersion, startDay: LocalDate,
        timeZone: TimeZoneID, resolvedStart: Instant
    ) {
        self.ruleID = ruleID
        self.ruleVersion = ruleVersion
        self.startDay = startDay
        self.timeZone = timeZone
        self.resolvedStart = resolvedStart
    }
}

public enum GrantStatus: String, Codable, Sendable {
    case pending, scheduling, applying, active, expired, invalidated
    case reblockPending, reconciled, uncertain, failed
}

public struct TemporaryGrant: Equatable, Sendable {
    public let id: GrantID
    public let commandID: CommandID
    public let targetRef: TargetRef
    public let occurrence: OccurrenceKey
    public let acceptedAt: Instant
    public let initialExpiresAt: Instant
    public let effectiveExpiresAt: Instant
    public let status: GrantStatus

    // The rule binding has one source of truth, inside the occurrence key.
    public var ruleID: RuleID { occurrence.ruleID }
    public var ruleVersion: RuleVersion { occurrence.ruleVersion }

    public init(
        id: GrantID, commandID: CommandID, targetRef: TargetRef, occurrence: OccurrenceKey,
        acceptedAt: Instant, initialExpiresAt: Instant, effectiveExpiresAt: Instant, status: GrantStatus
    ) throws {
        guard acceptedAt < effectiveExpiresAt, effectiveExpiresAt <= initialExpiresAt else {
            throw ModelError.invalidGrantWindow
        }
        self.id = id
        self.commandID = commandID
        self.targetRef = targetRef
        self.occurrence = occurrence
        self.acceptedAt = acceptedAt
        self.initialExpiresAt = initialExpiresAt
        self.effectiveExpiresAt = effectiveExpiresAt
        self.status = status
    }
}

public enum DeadlineStatus: String, Codable, Sendable {
    case preparing, registered, fired, unknown, failed, obsolete
}

/// An adapter's record of API acceptance, not an OS-issued token or a delivery guarantee.
public struct DeadlineReceipt: Equatable, Sendable {
    public let registrationID: RegistrationID
    public let generation: RegistrationGeneration
    public let scheduledFor: Instant
    public let acceptedAt: Instant

    public init(
        registrationID: RegistrationID, generation: RegistrationGeneration,
        scheduledFor: Instant, acceptedAt: Instant
    ) {
        self.registrationID = registrationID
        self.generation = generation
        self.scheduledFor = scheduledFor
        self.acceptedAt = acceptedAt
    }
}

public struct DeadlineRegistration: Equatable, Sendable {
    public let id: RegistrationID
    public let grantID: GrantID
    public let commandID: CommandID
    public let generation: RegistrationGeneration
    public let policyRevision: PolicyRevision
    public let candidatePolicyRevision: PolicyRevision?
    public let scheduledFor: Instant
    public let status: DeadlineStatus
    public let receipt: DeadlineReceipt?
    public let firedAt: Instant?

    public init(
        id: RegistrationID, grantID: GrantID, commandID: CommandID,
        generation: RegistrationGeneration, policyRevision: PolicyRevision,
        candidatePolicyRevision: PolicyRevision? = nil, scheduledFor: Instant,
        status: DeadlineStatus, receipt: DeadlineReceipt? = nil, firedAt: Instant? = nil
    ) throws {
        if let candidatePolicyRevision {
            guard candidatePolicyRevision == (try policyRevision.next()) else {
                throw ModelError.invalidCandidateRevision
            }
        }
        if status == .registered && receipt == nil { throw ModelError.missingDeadlineReceipt }
        if status == .registered && firedAt != nil { throw ModelError.inconsistentDeadlineState }
        if let receipt {
            guard receipt.registrationID == id, receipt.generation == generation,
                  receipt.scheduledFor == scheduledFor else {
                throw ModelError.mismatchedDeadlineReceipt
            }
        }
        if status == .fired && firedAt == nil { throw ModelError.missingFiredAt }
        self.id = id
        self.grantID = grantID
        self.commandID = commandID
        self.generation = generation
        self.policyRevision = policyRevision
        self.candidatePolicyRevision = candidatePolicyRevision
        self.scheduledFor = scheduledFor
        self.status = status
        self.receipt = receipt
        self.firedAt = firedAt
    }
}
