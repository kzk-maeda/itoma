import Foundation
import Testing
import ItomaCore
@testable import ItomaStorage
@testable import ItomaHistory

private func id<Kind>(_ n: Int) -> EntityID<Kind> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private struct Logs {
    let base: Instant
    var source = UUID()
    var zone = "UTC"
    var policy: PolicySnapshot
    var selections: [ReflectionSelectionFact]
    init(date: String = "2026-11-16T12:00:00Z", start: Int = 720, end: Int = 960,
         offset: EndDayOffset = .sameDay, days: Set<Weekday> = Set(Weekday.allCases), zone: String = "UTC") throws {
        base = try Instant(#require(ISO8601DateFormatter().date(from: date)))
        self.zone = zone
        let rule = try Rule(id: id(1), version: RuleVersion(0), enabled: true, selectionRef: id(1),
            schedule: WeeklySchedule(weekdays: days, startMinute: start, endMinute: end, endDayOffset: offset), unlockMode: .reason)
        policy = try PolicySnapshot(revision: PolicyRevision(0), rules: [rule], priorityOrder: [id(1)])
        selections = [ReflectionSelectionFact(ref: id(1), targets: [id(1), id(2)])]
    }
    func at(_ seconds: Double) throws -> Instant { try Instant(secondsSince1970: base.secondsSince1970 + seconds) }
    func fact(_ sequence: Int64, _ seconds: Double, activation: Activation = .enabled,
              grants: [ReflectionGrantFact] = [], policy: PolicySnapshot? = nil) throws -> ReflectionControlFact {
        try ReflectionControlFact(version: 1, eventID: UUID(), sourceID: source, sequence: sequence,
            committedAt: at(seconds), timeZone: zone, snapshotSequence: SnapshotSequence(sequence),
            policy: policy ?? self.policy, activation: activation, selections: selections, grants: grants, application: nil)
    }
    func grant(_ number: Int = 1, target: Int = 1, from: Double = 3600, until: Double = 3900,
               status: GrantStatus = .active, ended: Bool = false) throws -> ReflectionGrantFact {
        try ReflectionGrantFact(id: id(number), target: id(target), ruleID: id(1), ruleVersion: 0,
            occurrenceStart: base, timeZone: zone, acceptedAt: at(from), expiresAt: at(until), status: status, ended: ended)
    }
    func view(_ builder: RuleLogTimelineBuilder, until: Double = 14400, period: ReflectionPrototypePeriod = .week,
              day: String = "2026-11-16") throws -> ReflectionPrototypeSnapshot {
        let input = try #require(try builder.dataset(sourceID: source, revision: 1, asOf: at(until), timeZone: zone))
        return try ReflectionPrototypeCalculator.snapshot(input, period: period, day: day)
    }
}

@Test func fourScheduledHoursMinusOneFiveMinuteUnlockAreThreeHoursFiftyFiveMinutes() throws {
    let f = try Logs(); var builder = RuleLogTimelineBuilder()
    try builder.append(f.fact(1, 0)) // Legacy policy log, no duration/readback sample.
    try builder.append(f.fact(2, 3600, grants: [f.grant(status: .pending)]))
    try builder.append(f.fact(3, 3600, grants: [f.grant()]))
    try builder.append(f.fact(4, 3900, grants: [f.grant(status: .expired, ended: true)]))
    let view = try f.view(builder)
    #expect(view.proofScope == .ruleScheduleLogs)
    #expect(view.total.knownSeconds == 14100)
    #expect(view.selected.knownSeconds == 14100)
    #expect(view.buckets.compactMap(\.knownSeconds).reduce(0, +) == 14100)
    let month = try f.view(builder, period: .month)
    #expect(month.total == view.total && month.selected.knownSeconds == 14100)
}

@Test func ruleAndApplicationOverlapDoesNotMultiplyTimeAndUnlockUnionIsDeductedOnce() throws {
    var f = try Logs()
    let second = try Rule(id: id(2), version: RuleVersion(0), enabled: true, selectionRef: id(2),
        schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 780, endMinute: 900, endDayOffset: .sameDay), unlockMode: .reason)
    f.policy = try PolicySnapshot(revision: PolicyRevision(0), rules: f.policy.rules + [second], priorityOrder: [id(1), id(2)])
    f.selections.append(ReflectionSelectionFact(ref: id(2), targets: [id(1), id(3)]))
    var builder = RuleLogTimelineBuilder()
    try builder.append(f.fact(1, 0))
    try builder.append(f.fact(2, 3600, grants: [f.grant()]))
    try builder.append(f.fact(3, 3720, grants: [f.grant(), f.grant(2, target: 2, from: 3720, until: 4020)]))
    try builder.append(f.fact(4, 3900, grants: [f.grant(status: .expired, ended: true), f.grant(2, target: 2, from: 3720, until: 4020)]))
    #expect(try f.view(builder).total.knownSeconds == 13980) // Seven-minute union; B's continued restriction adds no time.
}

@Test func earlyEndUsesItsLogTimeWhileFailedOrPendingRequestsNeverDeductTime() throws {
    let f = try Logs(); var early = RuleLogTimelineBuilder(), failed = RuleLogTimelineBuilder()
    try early.append(f.fact(1, 0)); try failed.append(f.fact(1, 0))
    try early.append(f.fact(2, 3600, grants: [f.grant()]))
    try early.append(f.fact(3, 3720, grants: [f.grant(status: .invalidated, ended: true)]))
    try failed.append(f.fact(2, 3600, grants: [f.grant(status: .pending)]))
    try failed.append(f.fact(3, 3610, grants: [f.grant(status: .failed)]))
    #expect(try f.view(early).total.knownSeconds == 14280)
    #expect(try f.view(failed).total.knownSeconds == 14400)
}

@Test func missingEndCallbackDoesNotExtendTheLoggedUnlockPastItsFixedExpiry() throws {
    let f = try Logs(); var builder = RuleLogTimelineBuilder()
    try builder.append(f.fact(1, 0))
    try builder.append(f.fact(2, 3600, grants: [f.grant()]))
    #expect(try f.view(builder).total.knownSeconds == 14100)
    #expect(try f.view(builder, until: 3800).total.knownSeconds == 3600)
    #expect(try f.view(builder, until: 16000).total.knownSeconds == 14100) // Rule end is the cap.
}

@Test func pauseAndReauthorizationWaitAreExcludedUntilLoggedResume() throws {
    let f = try Logs(); var builder = RuleLogTimelineBuilder()
    try builder.append(f.fact(1, 0))
    try builder.append(f.fact(2, 3600, activation: .paused))
    try builder.append(f.fact(3, 5400, activation: .awaitingReauthorizationConfirmation))
    try builder.append(f.fact(4, 7200))
    #expect(try f.view(builder).total.knownSeconds == 10800)
}

@Test func laterRuleExtensionDoesNotRewriteTheEarlierPolicyOrFillAnEarlierInactiveHour() throws {
    let f = try Logs(end: 840); var builder = RuleLogTimelineBuilder()
    let old = f.policy.rules[0]
    let extended = try Rule(id: old.id, version: old.version.next(), enabled: true, selectionRef: old.selectionRef,
        schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 720, endMinute: 960, endDayOffset: .sameDay), unlockMode: .reason)
    let policy = try PolicySnapshot(revision: PolicyRevision(1), rules: [extended], priorityOrder: [old.id])
    try builder.append(f.fact(1, 0))
    try builder.append(f.fact(2, 10800, policy: policy))
    #expect(try f.view(builder).total.knownSeconds == 10800) // 12–14 + 15–16, never 14–15.
}

@Test func overnightRuleUsesStartWeekdayAndSplitsAtCalendarMidnight() throws {
    let f = try Logs(date: "2026-11-15T22:00:00Z", start: 1380, end: 60, offset: .nextDay, days: [.sunday])
    var builder = RuleLogTimelineBuilder(); try builder.append(f.fact(1, 0))
    let sunday = try f.view(builder, day: "2026-11-15")
    let monday = try f.view(builder, day: "2026-11-16")
    #expect(sunday.total.knownSeconds == 7200 && monday.total.knownSeconds == 7200)
    #expect(sunday.selected.knownSeconds == 3600 && monday.selected.knownSeconds == 3600)
}

@Test(arguments: [("2026-11-01T04:00:00Z", 18000.0), ("2026-03-08T05:00:00Z", 10800.0)])
func ruleLogTimeUsesRealDSTBoundaries(example: (String, Double)) throws {
    let f = try Logs(date: example.0, start: 0, end: 240, days: [.sunday], zone: "America/New_York")
    var builder = RuleLogTimelineBuilder(); try builder.append(f.fact(1, 0))
    let input = try #require(try builder.dataset(sourceID: f.source, revision: 1, asOf: f.at(6 * 3600), timeZone: f.zone))
    #expect(ReflectionPrototypeCalculator.union(input.restricted).reduce(0) { $0 + $1.until.secondsSince1970 - $1.from.secondsSince1970 } == example.1)
}

@Test func sequenceGapExcludesOnlyTheUnknownSpanAndCalculationBeginsAtTheFirstRetainedLog() throws {
    let f = try Logs(); var builder = RuleLogTimelineBuilder()
    try builder.append(f.fact(1, 0)); try builder.append(f.fact(2, 3600)); try builder.append(f.fact(4, 7200))
    let view = try f.view(builder)
    #expect(view.total.knownSeconds == 10800 && view.total.coverage == .partial)
    var retained = RuleLogTimelineBuilder(); try retained.append(f.fact(9, 7200))
    #expect(try f.view(retained).total.knownSeconds == 7200)
}

@Test func clockRollbackLeavesAnExplicitGapAndNeverDuplicatesElapsedTime() throws {
    let f = try Logs(); var builder = RuleLogTimelineBuilder()
    try builder.append(f.fact(1, 0)); try builder.append(f.fact(2, 3600)); try builder.append(f.fact(3, 1800))
    let view = try f.view(builder)
    #expect(view.total.knownSeconds == 12600 && view.total.coverage == .partial)
}

@Test func aTimeZoneChangeUsesThePreviousZoneOnlyUntilTheChangeWasLogged() throws {
    var f = try Logs(); var builder = RuleLogTimelineBuilder()
    try builder.append(f.fact(1, 0))
    f.zone = "Asia/Tokyo"
    try builder.append(f.fact(2, 3600)) // 22:00 local; the 12–16 rule is inactive.
    #expect(try f.view(builder).total.knownSeconds == 3600)
}

@Test func aHigherPriorityOccurrenceCapsAnOldGrantWithoutRevivingItAfterTheWinnerEnds() throws {
    var f = try Logs()
    let high = try Rule(id: id(2), version: RuleVersion(0), enabled: true, selectionRef: id(1),
        schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 782, endMinute: 783, endDayOffset: .sameDay), unlockMode: .unavailable)
    f.policy = try PolicySnapshot(revision: PolicyRevision(0), rules: f.policy.rules + [high], priorityOrder: [id(2), id(1)])
    var builder = RuleLogTimelineBuilder(); try builder.append(f.fact(1, 0))
    try builder.append(f.fact(2, 3600, grants: [f.grant()]))
    #expect(try f.view(builder).total.knownSeconds == 14280)
}

@Test func ruleLogRepositoryRecalculatesLegacyFactsPinsTotalsAcrossPeriodsAndDoesNotLeakPrivateInputs() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("history.sqlite")
    let capacity = try HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000)
    let history = try HistoryRepository.create(at: url, capacity: capacity)
    let f = try Logs()
    let facts = try [f.fact(1, 0), f.fact(2, 3600, grants: [f.grant()]), f.fact(3, 3900, grants: [f.grant(status: .expired, ended: true)])]
    let boundary = ReflectionBoundary(sourceID: f.source, highWatermark: 3, acknowledgedThrough: 0, incomplete: false)
    try history.commitReflectionBatch(ReflectionFactBatch(boundary: boundary, facts: facts))
    try history.close()
    let reopened = try HistoryRepository.open(at: url, capacity: capacity); defer { try? reopened.close() }
    let week = try reopened.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(14400))
    #expect(week.metricVersion == "rule-schedule-excluding-unlocks-v1" && week.proofScope == "ruleScheduleLogs")
    #expect(week.total.knownSeconds == 14100)
    let month = try reopened.readReflection(period: .month, day: "2026-11-16", timeZone: "UTC", expectedToken: week.token, now: f.at(15000))
    #expect(month.total == week.total && month.selected.knownSeconds == 14100)
    let json = String(data: try JSONEncoder().encode(month), encoding: .utf8)!
    #expect(!json.contains("policy") && !json.contains("target") && !json.contains("grants"))
    let tokenData = try #require(Data(base64Encoded: String(week.token.dropFirst("reflection-v1:".count))))
    var legacy = try #require(try JSONSerialization.jsonObject(with: tokenData) as? [String: Any])
    legacy["metricVersion"] = "native-restricted-excluding-unlocks-v2"
    let token = "reflection-v1:" + (try JSONSerialization.data(withJSONObject: legacy)).base64EncodedString()
    #expect(throws: HistoryError.conflict) {
        try reopened.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", expectedToken: token, now: f.at(15000))
    }
}

@Test func anUncertainUnlockWithoutSuccessLeavesOnlyItsOwnBoundedWindowUnknown() throws {
    let f = try Logs(); var builder = RuleLogTimelineBuilder()
    try builder.append(f.fact(1, 0))
    try builder.append(f.fact(2, 3600, grants: [f.grant(status: .uncertain)]))
    let view = try f.view(builder)
    #expect(view.total.knownSeconds == 14100 && view.total.coverage == .partial)
    // Repeated uncertainty does not promote a never-successful operation to a confirmed unlock.
    try builder.append(f.fact(3, 3660, grants: [f.grant(status: .uncertain)]))
    #expect(try f.view(builder).total.coverage == .partial)
}

@Test func pendingLogsDoNotExtrapolateOldStateAndAnotherConnectionInvalidatesTheProjection() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("history.sqlite"), f = try Logs()
    let capacity = try HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000)
    let history = try HistoryRepository.create(at: url, capacity: capacity); defer { try? history.close() }
    try history.commitReflectionBatch(ReflectionFactBatch(
        boundary: ReflectionBoundary(sourceID: f.source, highWatermark: 2, acknowledgedThrough: 0, incomplete: false),
        facts: [f.fact(1, 0)]))
    let pending = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(7200))
    #expect(pending.total.knownSeconds == nil && pending.total.coverage == .partial)
    try history.commitReflectionBatch(ReflectionFactBatch(
        boundary: ReflectionBoundary(sourceID: f.source, highWatermark: 2, acknowledgedThrough: 1, incomplete: false),
        facts: [f.fact(2, 3600, grants: [f.grant()])]))
    let caughtUp = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(7200))
    #expect(caughtUp.total.knownSeconds == 6900)
    let writer = try HistoryRepository.open(at: url, capacity: capacity); defer { try? writer.close() }
    try writer.commitReflectionBatch(ReflectionFactBatch(
        boundary: ReflectionBoundary(sourceID: f.source, highWatermark: 3, acknowledgedThrough: 2, incomplete: false),
        facts: [f.fact(3, 7200, activation: .paused)]))
    let stopped = try history.readReflection(period: .month, day: "2026-11-16", timeZone: "UTC", now: f.at(14400))
    #expect(stopped.total.knownSeconds == 6900)
    #expect(throws: HistoryError.conflict) {
        try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", expectedToken: caughtUp.token, now: f.at(14400))
    }
}

@Test func replacingTheControlSourceClosesOldRulesAtTheNewSourceStartRegardlessOfUUIDSortOrder() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    var old = try Logs(), newer = try Logs()
    old.source = UUID(uuidString: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")!
    newer.source = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    let history = try HistoryRepository.create(at: directory.appendingPathComponent("history.sqlite"),
        capacity: HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000)); defer { try? history.close() }
    for (f, at, activation) in [(old, 0.0, Activation.enabled), (newer, 3600.0, .paused)] {
        try history.commitReflectionBatch(ReflectionFactBatch(
            boundary: ReflectionBoundary(sourceID: f.source, highWatermark: 1, acknowledgedThrough: 0, incomplete: false),
            facts: [f.fact(1, at, activation: activation)]))
    }
    let view = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: old.at(14400))
    #expect(view.total.knownSeconds == 3600)
}

@Test func cachedProjectionDoesNotIgnoreARecordedPolicyWhoseTimeWasAfterAnEarlierAsOf() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let f = try Logs(end: 840), old = try #require(f.policy.rules.first)
    let extended = try Rule(id: old.id, version: old.version.next(), enabled: true, selectionRef: old.selectionRef,
        schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 720, endMinute: 960, endDayOffset: .sameDay), unlockMode: .reason)
    let changed = try PolicySnapshot(revision: PolicyRevision(1), rules: [extended], priorityOrder: [old.id])
    let history = try HistoryRepository.create(at: directory.appendingPathComponent("history.sqlite"),
        capacity: HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000)); defer { try? history.close() }
    try history.commitReflectionBatch(ReflectionFactBatch(
        boundary: ReflectionBoundary(sourceID: f.source, highWatermark: 2, acknowledgedThrough: 0, incomplete: false),
        facts: [f.fact(1, 0), f.fact(2, 10800, policy: changed)]))
    let earlier = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(7200))
    let later = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(14400))
    #expect(earlier.total.knownSeconds == 7200 && later.total.knownSeconds == 10800)
}

@Test func rebootOrOlderSleepClockSamplesCannotEraseTheRuleLogCalculation() throws {
    let f = try Logs(); var builder = RuleLogTimelineBuilder()
    var start = try f.fact(1, 0), afterSleep = try f.fact(2, 7200)
    start.durationObservation = try RestrictionTimelineSample(at: start.committedAt, uptime: 1000, timeZone: "UTC", state: .unknown, boundary: .checkpoint)
    afterSleep.durationObservation = try RestrictionTimelineSample(at: afterSleep.committedAt, uptime: 10, timeZone: "UTC", state: .unknown, boundary: .checkpoint)
    try builder.append(start); try builder.append(afterSleep)
    #expect(try f.view(builder).total.knownSeconds == 14400)
}

@Test func aNewPendingSourceWithoutItsFirstFactDoesNotExtendTheOldPolicyThroughUnknownTime() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let old = try Logs(), new = try Logs()
    let history = try HistoryRepository.create(at: directory.appendingPathComponent("history.sqlite"),
        capacity: HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000)); defer { try? history.close() }
    try history.commitReflectionBatch(ReflectionFactBatch(
        boundary: ReflectionBoundary(sourceID: old.source, highWatermark: 1, acknowledgedThrough: 0, incomplete: false),
        facts: [old.fact(1, 0)]))
    let pending = ReflectionBoundary(sourceID: new.source, highWatermark: 1, acknowledgedThrough: 0, incomplete: false)
    try history.commitReflectionBatch(ReflectionFactBatch(boundary: pending, facts: []))
    let unknown = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: old.at(7200))
    #expect(unknown.total.knownSeconds == nil)
    try history.commitReflectionBatch(ReflectionFactBatch(boundary: pending, facts: [new.fact(1, 3600, activation: .paused)]))
    let recovered = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: old.at(7200))
    #expect(recovered.total.knownSeconds == 3600)
}

@Test func aLogExactlyAtAsOfHasNoElapsedTimeAndCannotBecomeKnownZeroThroughFallback() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let f = try Logs()
    let history = try HistoryRepository.create(at: directory.appendingPathComponent("history.sqlite"),
        capacity: HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000)); defer { try? history.close() }
    try history.commitReflectionBatch(ReflectionFactBatch(
        boundary: ReflectionBoundary(sourceID: f.source, highWatermark: 1, acknowledgedThrough: 0, incomplete: false),
        facts: [f.fact(1, 0)]))
    let instant = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(0))
    #expect(instant.observationCount == 1 && instant.total.knownSeconds == nil)
    #expect(instant.buckets.allSatisfy { $0.knownSeconds == nil })
    let later = try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(60))
    #expect(later.total.knownSeconds == 60) // A valid historical policy can be reconstructed.
    // Reach the nonempty fallback range: sequence starts at 13:00, then wall time returns to
    // 12:00. At as-of 13:00 the retained first baseline has no forward reconstructable span.
    let rewound = try HistoryRepository.create(at: directory.appendingPathComponent("rewound.sqlite"),
        capacity: HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000)); defer { try? rewound.close() }
    try rewound.commitReflectionBatch(ReflectionFactBatch(
        boundary: ReflectionBoundary(sourceID: f.source, highWatermark: 2, acknowledgedThrough: 0, incomplete: false),
        facts: [f.fact(1, 3600), f.fact(2, 0)]))
    let noRange = try rewound.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(3600))
    #expect(noRange.total.knownSeconds == nil) // The former empty-interval fallback returned 0.
}

@Test(arguments: ["policy", "activation", "grants"])
func aLegacyPayloadMissingRequiredReconstructionInputsCannotReturnKnownZero(_ missing: String) throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let f = try Logs(), fact = try f.fact(1, 0)
    let history = try HistoryRepository.create(at: directory.appendingPathComponent("history.sqlite"),
        capacity: HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000)); defer { try? history.close() }
    try history.commitReflectionBatch(ReflectionFactBatch(
        boundary: ReflectionBoundary(sourceID: f.source, highWatermark: 1, acknowledgedThrough: 0, incomplete: false), facts: [fact]))
    var raw = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(fact)) as? [String: Any])
    raw.removeValue(forKey: missing)
    let broken = try JSONSerialization.data(withJSONObject: raw)
    try history.transaction(writer: true) {
        try history.database.execute("UPDATE reflection_facts SET record=?,payload_bytes=?", [.blob(broken), .integer(Int64(broken.count))])
    }
    #expect(throws: HistoryError.corrupt) {
        try history.readReflection(period: .week, day: "2026-11-16", timeZone: "UTC", now: f.at(14400))
    }
}
