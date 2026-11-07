import Foundation
import Testing
import ItomaCore

private func id<Kind>(_ value: Int) -> EntityID<Kind> {
    EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", value))!)
}

private func time(_ seconds: Double) throws -> Instant { try Instant(secondsSince1970: seconds) }

private func rule(_ value: Int = 1) throws -> Rule {
    Rule(
        id: id(value), version: try RuleVersion(1), enabled: true, selectionRef: id(value),
        schedule: try WeeklySchedule(weekdays: [.friday], startMinute: 1260, endMinute: 120, endDayOffset: .nextDay),
        unlockMode: .reason
    )
}

private func policy(revision: Int64 = 7) throws -> PolicySnapshot {
    try PolicySnapshot(revision: PolicyRevision(revision), rules: [rule(), rule(2)], priorityOrder: [id(2), id(1)])
}

private func policyData(changing transform: (inout [String: Any]) -> Void) throws -> Data {
    let data = try JSONEncoder().encode(policy())
    var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    transform(&object)
    return try JSONSerialization.data(withJSONObject: object)
}

private func occurrence(version: Int64 = 1, day: Int = 6, zone: String = "Asia/Tokyo") throws -> OccurrenceKey {
    try OccurrenceKey(
        ruleID: id(1), ruleVersion: RuleVersion(version), startDay: LocalDate(year: 2026, month: 11, day: day),
        timeZone: TimeZoneID(zone), resolvedStart: time(1000)
    )
}

@Test func opaqueIDsRejectApplicationNamesAndNormalizeUUIDCase() throws {
    let decoder = JSONDecoder()
    let upper = Data("\"00000000-0000-0000-0000-00000000AABB\"".utf8)
    let lower = Data("\"00000000-0000-0000-0000-00000000aabb\"".utf8)
    #expect(try decoder.decode(TargetRef.self, from: upper) == decoder.decode(TargetRef.self, from: lower))
    #expect(throws: DecodingError.self) {
        try decoder.decode(TargetRef.self, from: Data("\"com.example.application\"".utf8))
    }
}

@Test func countersRejectNegativeDecodedDataAndNeverWrap() throws {
    #expect(throws: ModelError.negativeCounter) {
        try JSONDecoder().decode(PolicyRevision.self, from: Data("-1".utf8))
    }
    #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(PolicyRevision.self, from: Data("9223372036854775808".utf8))
    }
    #expect(throws: ModelError.counterOverflow) { try SnapshotSequence(Int64.max).next() }
    #expect(try PolicyRevision(0).next().rawValue == 1)
}

@Test(arguments: [Double.infinity, -Double.infinity, Double.nan])
func nonFiniteInstantsAreRejected(value: Double) {
    #expect(throws: ModelError.nonFiniteInstant) { try Instant(secondsSince1970: value) }
}

@Test func absoluteTimeRoundTripPreservesEpochAndFraction() throws {
    let value = try time(1_000.25)
    let data = try JSONEncoder().encode(value)
    #expect(String(decoding: data, as: UTF8.self) == "1000.25")
    #expect(try JSONDecoder().decode(Instant.self, from: data) == value)
    #expect(value.date.timeIntervalSince1970 == 1_000.25)
}

@Test(arguments: ["Unknown/Time_Zone", "Not an application identifier"])
func invalidTimeZonesDoNotFallBackToTheSystemZone(value: String) {
    #expect(throws: ModelError.invalidTimeZone) { try TimeZoneID(value) }
}

@Test(arguments: [(1900, 2, 29), (2026, 2, 29), (2026, 4, 31), (2026, 0, 1), (0, 1, 1)])
func impossibleLocalDatesAreRejected(value: (Int, Int, Int)) {
    #expect(throws: ModelError.invalidLocalDate) {
        try LocalDate(year: value.0, month: value.1, day: value.2)
    }
}

@Test func leapDaysAndExplicitTimeZonesRemainRepresentable() throws {
    _ = try LocalDate(year: 2000, month: 2, day: 29)
    let context = try EvaluationContext(
        now: time(1_000), timeZone: TimeZoneID("Asia/Tokyo"),
        authorization: AuthorizationObservation(status: .approved, observedAt: time(900)),
        activation: .awaitingReauthorizationConfirmation
    )
    // Approved authorization must remain independent of the person's activation decision.
    #expect(context.authorization.status == .approved)
    #expect(context.activation == .awaitingReauthorizationConfirmation)
}

@Test(arguments: [(-1, 120, 1), (0, 1440, 0), (120, 120, 0), (1260, 120, 0), (0, 60, 1)])
func invalidWeeklyIntervalsAreRejected(value: (Int, Int, Int)) throws {
    let offset = try #require(EndDayOffset(rawValue: value.2))
    #expect(throws: (any Error).self) {
        try WeeklySchedule(weekdays: [.friday], startMinute: value.0, endMinute: value.1, endDayOffset: offset)
    }
}

@Test func emptyDaysAndCorruptNestedSchedulesCannotEnterAPolicy() throws {
    #expect(throws: ModelError.emptyWeekdays) {
        try WeeklySchedule(weekdays: [], startMinute: 0, endMinute: 1, endDayOffset: .sameDay)
    }
    let data = try policyData { object in
        var rules = object["rules"] as! [[String: Any]]
        var schedule = rules[0]["schedule"] as! [String: Any]
        schedule["startMinute"] = -1
        rules[0]["schedule"] = schedule
        object["rules"] = rules
    }
    #expect(throws: ModelError.invalidMinute) { try JSONDecoder().decode(PolicySnapshot.self, from: data) }
}

@Test func explicitFullDayAndOvernightSchedulesDecodeWithoutNormalization() throws {
    for schedule in [
        try WeeklySchedule(weekdays: [.friday], startMinute: 1260, endMinute: 120, endDayOffset: .nextDay),
        try WeeklySchedule(weekdays: [.monday], startMinute: 0, endMinute: 0, endDayOffset: .nextDay),
    ] {
        #expect(try JSONDecoder().decode(WeeklySchedule.self, from: JSONEncoder().encode(schedule)) == schedule)
    }
}

@Test(arguments: [0, 31, -1])
func invalidUnlockDurationsAreRejectedWhenDecoding(value: Int) {
    #expect(throws: ModelError.invalidUnlockDuration) {
        try JSONDecoder().decode(UnlockDuration.self, from: Data(String(value).utf8))
    }
}

@Test func unsupportedSchemaIsRejectedInsteadOfResettingSettings() throws {
    let data = try policyData { $0["schemaVersion"] = 2 }
    #expect(throws: ModelError.unsupportedSchemaVersion) {
        try JSONDecoder().decode(PolicySnapshot.self, from: data)
    }
}

@Test(arguments: ["duplicate", "missing", "unknown", "duplicateRule"])
func brokenPriorityDataIsRejectedRatherThanInventingAWinner(value: String) throws {
    let data = try policyData { object in
        let order = object["priorityOrder"] as! [String]
        switch value {
        case "duplicate": object["priorityOrder"] = [order[0], order[0]]
        case "missing": object["priorityOrder"] = [order[0]]
        case "unknown": object["priorityOrder"] = [order[0], "00000000-0000-0000-0000-000000000099"]
        default:
            let rules = object["rules"] as! [[String: Any]]
            object["rules"] = [rules[0], rules[0]]
        }
    }
    let expected: ModelError = value == "duplicateRule" ? .duplicateRuleID : .invalidPriorityOrder
    #expect(throws: expected) { try JSONDecoder().decode(PolicySnapshot.self, from: data) }
}

@Test func policyRoundTripPreservesThePersonsPriorityAndDefaultDuration() throws {
    let original = try policy()
    let restored = try JSONDecoder().decode(PolicySnapshot.self, from: JSONEncoder().encode(original))
    #expect(restored == original)
    #expect(restored.priorityOrder == [id(2), id(1)])
    #expect(restored.defaultUnlockDuration.minutes == 5)
}

@Test(arguments: [Int64(7), 9])
func policyCandidatesCannotReuseOrSkipTheReservedRevision(revision: Int64) throws {
    let proposed = try policy(revision: revision)
    #expect(throws: ModelError.invalidCandidateRevision) {
        try PolicyCandidate(commandID: id(1), expectedRevision: PolicyRevision(7), proposedPolicy: proposed)
    }
}

@Test func policyCandidateIsSeparateFromTheActiveSnapshot() throws {
    let active = try policy()
    let candidate = try PolicyCandidate(commandID: id(1), expectedRevision: active.revision, proposedPolicy: policy(revision: 8))
    #expect(active.revision.rawValue == 7)
    #expect(candidate.proposedPolicy.revision.rawValue == 8)
    #expect(throws: ModelError.counterOverflow) {
        try PolicyCandidate(commandID: id(2), expectedRevision: PolicyRevision(Int64.max), proposedPolicy: active)
    }
}

@Test func grantsDoNotAdvancePolicyRevisionsAndPolicyCommandsRequireACandidate() throws {
    #expect(throws: ModelError.invalidCommandRevision) {
        try Command(id: id(1), kind: .commitPolicy, status: .pending, expectedPolicyRevision: PolicyRevision(7), attempt: AttemptNumber(0))
    }
    #expect(throws: ModelError.invalidCommandRevision) {
        try Command(id: id(1), kind: .requestTemporaryGrant, status: .pending, expectedPolicyRevision: PolicyRevision(7), candidatePolicyRevision: PolicyRevision(8), attempt: AttemptNumber(0))
    }
    _ = try Command(id: id(1), kind: .commitPolicy, status: .pending, expectedPolicyRevision: PolicyRevision(7), candidatePolicyRevision: PolicyRevision(8), attempt: AttemptNumber(0))
}

@Test(arguments: [Double(1000), 999, 1301])
func grantWindowsRejectNonpositiveOrExtendedExpiry(effective: Double) throws {
    let key = try occurrence()
    #expect(throws: ModelError.invalidGrantWindow) {
        try TemporaryGrant(id: id(1), commandID: id(1), targetRef: id(1), occurrence: key, acceptedAt: time(1000), initialExpiresAt: time(1300), effectiveExpiresAt: time(effective), status: .pending)
    }
}

@Test func shortenedGrantKeepsItsInitialCapAndCompleteOccurrenceBinding() throws {
    let grant = try TemporaryGrant(id: id(1), commandID: id(1), targetRef: id(1), occurrence: occurrence(), acceptedAt: time(1000), initialExpiresAt: time(1300), effectiveExpiresAt: time(1180), status: .expired)
    #expect(grant.initialExpiresAt > grant.effectiveExpiresAt)
    #expect(try Set([occurrence(), occurrence(version: 2), occurrence(day: 7), occurrence(zone: "UTC")]).count == 4)
}

private func registration(
    status: DeadlineStatus, receipt: DeadlineReceipt? = nil, firedAt: Instant? = nil
) throws -> DeadlineRegistration {
    try DeadlineRegistration(
        id: id(1), grantID: id(1), commandID: id(1), generation: RegistrationGeneration(1),
        policyRevision: PolicyRevision(7), candidatePolicyRevision: PolicyRevision(8), scheduledFor: time(1180),
        status: status, receipt: receipt, firedAt: firedAt
    )
}

@Test func aDatabaseDeadlineAloneIsNotARegistrationReceipt() throws {
    _ = try registration(status: .preparing)
    #expect(throws: ModelError.missingDeadlineReceipt) { try registration(status: .registered) }
    #expect(throws: ModelError.missingFiredAt) { try registration(status: .fired) }
    // A callback can arrive before receipt persistence; retain that fact, without inventing acceptance.
    _ = try registration(status: .fired, firedAt: time(1181))
}

@Test(arguments: ["id", "generation", "deadline"])
func receiptsFromOtherRegistrationsOrDeadlinesAreRejected(value: String) throws {
    let receipt = try DeadlineReceipt(
        registrationID: id(value == "id" ? 2 : 1),
        generation: RegistrationGeneration(value == "generation" ? 2 : 1),
        scheduledFor: time(value == "deadline" ? 1300 : 1180), acceptedAt: time(1100)
    )
    #expect(throws: ModelError.mismatchedDeadlineReceipt) {
        try registration(status: .registered, receipt: receipt)
    }
}

@Test func matchingReceiptAndObsoleteCallbackRemainDistinctFacts() throws {
    let receipt = try DeadlineReceipt(registrationID: id(1), generation: RegistrationGeneration(1), scheduledFor: time(1180), acceptedAt: time(1100))
    _ = try registration(status: .registered, receipt: receipt)
    _ = try registration(status: .obsolete, receipt: receipt, firedAt: time(1181))
    #expect(throws: ModelError.inconsistentDeadlineState) {
        try registration(status: .registered, receipt: receipt, firedAt: time(1181))
    }
}

@Test func applicationSuccessRequiresOwnSettingsEvidence() throws {
    #expect(throws: ModelError.missingEvaluationID) {
        try ApplicationObservation(evaluationID: nil, status: .applied, evidence: .ownStoreReadback, observedAt: time(1100), validUntil: time(1180), error: nil)
    }
    #expect(throws: ModelError.missingObservationEvidence) {
        try ApplicationObservation(evaluationID: id(1), status: .applied, evidence: nil, observedAt: time(1100), validUntil: time(1180), error: nil)
    }
    // Historical evidence may already be stale. The UI must evaluate freshness separately.
    _ = try ApplicationObservation(evaluationID: id(1), status: .applied, evidence: .ownStoreReadback, observedAt: time(1200), validUntil: time(1180), error: nil)
}
