import Foundation
import ItomaCore

public struct GrantAcceptance: Equatable, Sendable {
    public let command: Command
    public let grant: TemporaryGrant
    public let alreadyAccepted: Bool
    public let snapshot: ControlSnapshot
}

/// Sticky logical end survives an uncertain/failed reblock observation.
public struct StoredGrant: Equatable, Sendable {
    public let grant: TemporaryGrant
    public let hasEnded: Bool
}

/// Values supplied after edit confirmation; every field is rechecked inside the final writer TX.
public struct RegisteredGrantChange: Equatable, Sendable {
    public let expected: TemporaryGrant
    public let updated: TemporaryGrant
    public let registrationID: RegistrationID?
    public init(expected: TemporaryGrant, updated: TemporaryGrant, registrationID: RegistrationID? = nil) {
        self.expected = expected; self.updated = updated; self.registrationID = registrationID
    }
}

struct GrantRequestIntent: Equatable, Codable {
    let target: TargetRef
    let occurrence: OccurrenceDTO
    let mode: UnlockMode
    let duration: UnlockDuration?
    init(_ request: GrantRequest) {
        target = request.targetRef; occurrence = OccurrenceDTO(request.expectedOccurrence)
        mode = request.condition.mode; duration = request.duration
    }
}

struct OccurrenceDTO: Equatable, Codable {
    let ruleID: RuleID
    let version: RuleVersion
    let year: Int
    let month: Int
    let day: Int
    let timeZone: String
    let start: Instant
    init(_ key: OccurrenceKey) {
        ruleID = key.ruleID; version = key.ruleVersion; year = key.startDay.year
        month = key.startDay.month; day = key.startDay.day; timeZone = key.timeZone.identifier; start = key.resolvedStart
    }
    func model() throws -> OccurrenceKey {
        try OccurrenceKey(ruleID: ruleID, ruleVersion: version, startDay: LocalDate(year: year, month: month, day: day),
                          timeZone: TimeZoneID(timeZone), resolvedStart: start)
    }
}

struct GrantDTO: Codable {
    var schemaVersion = 1
    let id: GrantID
    let commandID: CommandID
    let target: TargetRef
    let occurrence: OccurrenceDTO
    let acceptedAt: Instant
    let initialExpiresAt: Instant
    let effectiveExpiresAt: Instant
    let status: GrantStatus
    init(_ grant: TemporaryGrant) {
        id = grant.id; commandID = grant.commandID; target = grant.targetRef; occurrence = OccurrenceDTO(grant.occurrence)
        acceptedAt = grant.acceptedAt; initialExpiresAt = grant.initialExpiresAt
        effectiveExpiresAt = grant.effectiveExpiresAt; status = grant.status
    }
    func model() throws -> TemporaryGrant {
        guard schemaVersion == 1, initialExpiresAt.secondsSince1970 - acceptedAt.secondsSince1970 <= 1800 else {
            throw StorageError.corrupt
        }
        return try TemporaryGrant(id: id, commandID: commandID, targetRef: target, occurrence: occurrence.model(),
                                  acceptedAt: acceptedAt, initialExpiresAt: initialExpiresAt,
                                  effectiveExpiresAt: effectiveExpiresAt, status: status)
    }
}

struct ReceiptDTO: Codable {
    let id: RegistrationID
    let generation: RegistrationGeneration
    let scheduledFor: Instant
    let acceptedAt: Instant
    init(_ receipt: DeadlineReceipt) {
        id = receipt.registrationID; generation = receipt.generation; scheduledFor = receipt.scheduledFor; acceptedAt = receipt.acceptedAt
    }
    func model() -> DeadlineReceipt {
        DeadlineReceipt(registrationID: id, generation: generation, scheduledFor: scheduledFor, acceptedAt: acceptedAt)
    }
}

struct RegistrationDTO: Codable {
    var schemaVersion = 1
    let id: RegistrationID
    let grantID: GrantID
    let commandID: CommandID
    let generation: RegistrationGeneration
    let policyRevision: PolicyRevision
    let candidateRevision: PolicyRevision?
    let scheduledFor: Instant
    let status: DeadlineStatus
    let receipt: ReceiptDTO?
    let firedAt: Instant?
    init(_ registration: DeadlineRegistration) {
        id = registration.id; grantID = registration.grantID; commandID = registration.commandID
        generation = registration.generation; policyRevision = registration.policyRevision
        candidateRevision = registration.candidatePolicyRevision; scheduledFor = registration.scheduledFor
        status = registration.status; receipt = registration.receipt.map(ReceiptDTO.init); firedAt = registration.firedAt
    }
    func model() throws -> DeadlineRegistration {
        guard schemaVersion == 1 else { throw StorageError.corrupt }
        return try DeadlineRegistration(id: id, grantID: grantID, commandID: commandID, generation: generation,
                                        policyRevision: policyRevision, candidatePolicyRevision: candidateRevision,
                                        scheduledFor: scheduledFor, status: status, receipt: receipt?.model(), firedAt: firedAt)
    }
}

func replacingStatus(_ grant: TemporaryGrant, _ status: GrantStatus) throws -> TemporaryGrant {
    try TemporaryGrant(id: grant.id, commandID: grant.commandID, targetRef: grant.targetRef, occurrence: grant.occurrence,
                       acceptedAt: grant.acceptedAt, initialExpiresAt: grant.initialExpiresAt,
                       effectiveExpiresAt: grant.effectiveExpiresAt, status: status)
}
