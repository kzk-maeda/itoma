import Foundation
import Testing
import ItomaCore
@testable import ItomaStorage
@testable import ItomaHistory

private final class TenMinuteDurationFixture {
    let directory: URL
    let control: ControlRepository
    let history: HistoryRepository
    let target = TargetRef(UUID())
    let base: Double

    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone.current
        base = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 15, hour: 10))).timeIntervalSince1970
        let ref = SelectionRef(UUID()), ruleID = RuleID(UUID())
        let rule = try Rule(id: ruleID, version: RuleVersion(0), enabled: true, selectionRef: ref,
            schedule: WeeklySchedule(weekdays: [.sunday], startMinute: 600, endMinute: 610, endDayOffset: .sameDay), unlockMode: .reason)
        control = try ControlRepository.create(at: directory.appendingPathComponent("control.sqlite"),
            initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [rule], priorityOrder: [ruleID]),
            selections: [StoredSelection(selection: Selection(ref: ref, targets: [target]), opaquePayload: Data("fixture-only".utf8))], activation: .enabled)
        history = try HistoryRepository.create(at: directory.appendingPathComponent("history.sqlite"),
            capacity: HistoryCapacityPolicy(warningBytes: 500_000, maximumBytes: 1_000_000))
        try move(0)
        try control.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 100))
        try control.installDurationCapture()
    }
    func at(_ offset: Double) throws -> Instant { try Instant(secondsSince1970: base + offset) }
    func move(_ offset: Double) throws {
        let now = try at(offset)
        control.durationClock = { (now, 10_000 + offset) }
    }
    func apply(_ offset: Double, status: ApplicationStatus, restricted: Bool, failure: OperationFailure? = nil) throws {
        try move(offset)
        try control.write { tx in
            let snapshot = try tx.snapshot(), id = EvaluationID(UUID())
            let evaluation = try Evaluation(id: id, policyRevision: snapshot.policy.revision,
                snapshotSequence: snapshot.snapshotSequence, evaluatedAt: at(offset), timeZone: TimeZoneID(TimeZone.current.identifier),
                nextBoundary: at(restricted ? 600 : 86_400), desiredTargets: restricted ? [target] : [])
            let observation = try ApplicationObservation(evaluationID: id, status: status,
                evidence: status == .applied ? .ownStoreReadback : nil, observedAt: at(offset),
                validUntil: status == .applied ? at(restricted ? 600 : 86_400) : nil, error: failure)
            _ = try tx.recordApplication(StoredApplication(evaluation: evaluation, observation: observation), expectedSequence: snapshot.snapshotSequence)
        }
    }
    func checkpoint(_ offset: Double, confirmed: Bool) throws {
        try move(offset); try control.recordReflectionBaseline(durationConfirmed: confirmed)
    }
    func view(_ offset: Double) throws -> ReflectionReadSnapshot {
        try control.transferReflection(to: history)
        return try history.readReflection(period: .week, day: "2026-11-15", timeZone: TimeZone.current.identifier, now: at(offset))
    }
    func remove() { try? control.close(); try? history.close(); try? FileManager.default.removeItem(at: directory) }
}

@Test(arguments: [600.0, 605.0, 900.0])
func firstConfirmedReadAfterTenMinuteRuleEndRetainsTheCompletedInterval(_ readAt: Double) throws {
    let f = try TenMinuteDurationFixture(); defer { f.remove() }
    try f.apply(0, status: .applied, restricted: true)
    try f.checkpoint(20, confirmed: true)
    // The host may read reflection before a delayed monitor callback updates the store.
    // The own store still matches the last applied targets; the policy window has ended.
    try f.checkpoint(readAt, confirmed: true)
    try f.apply(readAt, status: .applying, restricted: false)
    try f.apply(readAt, status: .applied, restricted: false)
    let view = try f.view(readAt + 1)
    #expect(view.total.knownSeconds == 600)
    #expect(view.selected.knownSeconds == 600)
    #expect(view.buckets.compactMap(\.knownSeconds).reduce(0, +) == 600)
    if readAt > 600 { #expect(view.total.coverage == .partial) } // Delayed reconciliation is not counted.
}

@Test func aFailedStoreCheckpointAfterRuleEndDoesNotTurnTheUnknownSpanIntoSuccess() throws {
    let f = try TenMinuteDurationFixture(); defer { f.remove() }
    try f.apply(0, status: .applied, restricted: true)
    try f.checkpoint(20, confirmed: true)
    try f.checkpoint(605, confirmed: false)
    try f.apply(605, status: .applying, restricted: false)
    try f.apply(605, status: .applied, restricted: false)
    let view = try f.view(606)
    #expect(view.total.knownSeconds == 20)
    #expect(view.total.coverage == .partial)
}

@Test func aFailedEarlierCheckpointIsNotBridgedByALaterCompletedRuleBoundary() throws {
    let f = try TenMinuteDurationFixture(); defer { f.remove() }
    try f.apply(0, status: .applied, restricted: true)
    try f.checkpoint(20, confirmed: true)
    try f.checkpoint(400, confirmed: false)
    try f.checkpoint(605, confirmed: true)
    try f.apply(605, status: .applying, restricted: false)
    try f.apply(605, status: .applied, restricted: false)
    #expect(try f.view(606).total.knownSeconds == 20)
}

@Test func aClockDiscontinuityAtCompletedRuleBoundaryStillLeavesAGap() throws {
    let f = try TenMinuteDurationFixture(); defer { f.remove() }
    try f.apply(0, status: .applied, restricted: true)
    try f.checkpoint(20, confirmed: true)
    let now = try f.at(605)
    f.control.durationClock = { (now, 10_025) } // Wall time advanced much further than monotonic time.
    try f.control.recordReflectionBaseline(durationConfirmed: true)
    try f.apply(605, status: .applying, restricted: false)
    try f.apply(605, status: .applied, restricted: false)
    #expect(try f.view(606).total.knownSeconds == 20)
}

@Test func beginningObservationAfterTheRuleEndedNeverBackfillsItsScheduledTenMinutes() throws {
    let f = try TenMinuteDurationFixture(); defer { f.remove() }
    // The first applied empty store is observed only after the window has ended.
    try f.apply(605, status: .applied, restricted: false)
    try f.checkpoint(610, confirmed: true)
    #expect(try f.view(611).total.knownSeconds == 0)
}

@Test func anAuthorizationUnknownCallbackAfterRuleEndRetainsOnlyPreviouslyConfirmedTime() throws {
    let f = try TenMinuteDurationFixture(); defer { f.remove() }
    try f.apply(0, status: .applied, restricted: true)
    try f.checkpoint(54, confirmed: true)
    // Sanitized shape of the device trace: the Extension cannot authorize its next plan.
    try f.apply(603, status: .uncertain, restricted: false, failure: .authorizationRequired)
    try f.apply(780, status: .applying, restricted: false)
    try f.apply(780, status: .applied, restricted: false)
    let view = try f.view(781)
    #expect(view.total.knownSeconds == 54)
    #expect(view.total.coverage == .partial)
}
