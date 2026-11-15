import Foundation
import Testing
import ItomaCore
@testable import ItomaStorage
@testable import ItomaHistory

@Test func nativeDurationSurvivesTransferReopenRetryAndIndependentHistoryDeletion() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let controlURL = root.appendingPathComponent("control.sqlite"), historyURL = root.appendingPathComponent("history.sqlite")
    let capacity = try HistoryCapacityPolicy(warningBytes: 500_000, maximumBytes: 1_000_000)
    let ref = SelectionRef(UUID()), target = TargetRef(UUID()), ruleID = RuleID(UUID())
    let rule = try Rule(id: ruleID, version: RuleVersion(0), enabled: true, selectionRef: ref,
        schedule: WeeklySchedule(weekdays: [.sunday], startMinute: 0, endMinute: 1380, endDayOffset: .sameDay), unlockMode: .reason)
    let control = try ControlRepository.create(at: controlURL,
        initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [rule], priorityOrder: [ruleID]),
        selections: [StoredSelection(selection: Selection(ref: ref, targets: [target]), opaquePayload: Data("native-fixture-token".utf8))], activation: .enabled)
    defer { try? control.close() }
    let history = try HistoryRepository.create(at: historyURL, capacity: capacity)
    try control.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 100))
    try control.installDurationCapture()
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone.current
    let base = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 15))).timeIntervalSince1970
    func at(_ offset: Double) throws -> Instant { try Instant(secondsSince1970: base + offset) }
    func apply(_ seconds: Double, _ status: ApplicationStatus, restricted: Bool) throws {
        control.durationClock = { (try at(seconds), 10_000 + seconds) }
        try control.write { tx in
            let snapshot = try tx.snapshot(), id = EvaluationID(UUID())
            let evaluation = try Evaluation(id: id, policyRevision: snapshot.policy.revision,
                snapshotSequence: snapshot.snapshotSequence, evaluatedAt: at(seconds), timeZone: TimeZoneID(TimeZone.current.identifier),
                nextBoundary: at(86_400), desiredTargets: restricted ? [target] : [])
            let observation = try ApplicationObservation(evaluationID: id, status: status,
                evidence: status == .applied ? .ownStoreReadback : nil, observedAt: at(seconds),
                validUntil: status == .applied ? at(86_400) : nil, error: nil)
            _ = try tx.recordApplication(StoredApplication(evaluation: evaluation, observation: observation), expectedSequence: snapshot.snapshotSequence)
        }
    }
    try apply(0, .applied, restricted: true)
    try apply(1_800, .applying, restricted: false)
    try apply(1_800, .applied, restricted: false)
    try apply(2_100, .applying, restricted: true)
    try apply(2_100, .applied, restricted: true)
    try apply(7_200, .applying, restricted: false)
    try apply(7_200, .applied, restricted: false)
    let batch = try #require(try control.reflectionBatch())
    try history.commitReflectionBatch(batch) // Interrupt before shared ACK.
    try history.close()
    let reopened = try HistoryRepository.open(at: historyURL, capacity: capacity)
    defer { try? reopened.close() }
    try control.transferReflection(to: reopened)
    let week = try reopened.readReflection(period: .week, day: "2026-11-15", timeZone: "UTC", now: at(7_201))
    #expect(week.proofScope == "nativeRecordedIntervals")
    #expect(week.metricVersion == "native-restricted-excluding-unlocks-v2")
    #expect(week.total.knownSeconds == 6_900)
    let month = try reopened.readReflection(period: .month, day: "2026-11-15", timeZone: "UTC", expectedToken: week.token, now: at(7_202))
    #expect(month.total == week.total && month.selected.knownSeconds == week.selected.knownSeconds)
    let json = String(data: try JSONEncoder().encode(month), encoding: .utf8)!
    #expect(!json.contains("native-fixture-token") && !json.contains("durationObservation"))
    try reopened.deleteReasons()
    try reopened.deleteHistory(from: control)
    #expect(try reopened.readReflection(period: .week, day: "2026-11-15", timeZone: "UTC", now: at(7_201)).total.knownSeconds == 6_900)
    try reopened.deleteAllRecords(from: control)
    try reopened.commitReflectionBatch(batch)
    let deleted = try reopened.readReflection(period: .week, day: "2026-11-15", timeZone: "UTC", now: at(7_201))
    #expect(deleted.total.knownSeconds == nil && deleted.total.coverage == .deleted)
    #expect(throws: HistoryError.conflict) {
        try reopened.readReflection(period: .week, day: "2026-11-15", timeZone: "UTC", expectedToken: week.token, now: at(7_202))
    }
}

@Test func anUnknownDurationAuxiliaryVersionIsNotRewrittenAndCannotPreventStop() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let control = try ControlRepository.create(at: root.appendingPathComponent("control.sqlite"),
        initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [], priorityOrder: []), activation: .enabled)
    defer { try? control.close() }
    try control.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 100))
    try control.database.execute("CREATE TABLE reflection_duration_capture(version INTEGER PRIMARY KEY)")
    try control.database.execute("INSERT INTO reflection_duration_capture VALUES(2)")
    #expect(throws: StorageError.corrupt) { try control.installDurationCapture() }
    #expect(try control.database.rows("SELECT version FROM reflection_duration_capture").count == 1)
    let before = try control.readSnapshot()
    _ = try control.setActivation(.paused, expectedSequence: before.snapshotSequence)
    #expect(try control.readSnapshot().activation == .paused)
    #expect(try control.reflectionBatch()?.boundary.incomplete == true)
}
