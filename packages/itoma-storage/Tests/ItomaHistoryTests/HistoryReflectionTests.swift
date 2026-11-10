import CSQLite
import Foundation
import ItomaCore
@testable import ItomaHistory
@testable import ItomaStorage
import Testing

private struct ReflectionFixture {
    let directory: URL
    let control: ControlRepository
    let history: HistoryRepository
    var controlURL: URL { directory.appendingPathComponent("control.sqlite") }
    var historyURL: URL { directory.appendingPathComponent("history.sqlite") }
    init(maximum: Int64 = 1_000_000, withRule: Bool = false) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let selection = SelectionRef(UUID()), target = TargetRef(UUID()), ruleID = RuleID(UUID())
        let rule = try Rule(id: ruleID, version: RuleVersion(0), enabled: true, selectionRef: selection,
            schedule: WeeklySchedule(weekdays: [.monday, .sunday], startMinute: 540, endMinute: 1020, endDayOffset: .sameDay), unlockMode: .reason)
        control = try ControlRepository.create(at: directory.appendingPathComponent("control.sqlite"),
            initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: withRule ? [rule] : [], priorityOrder: withRule ? [ruleID] : []),
            selections: withRule ? [StoredSelection(selection: Selection(ref: selection, targets: [target]),
                opaquePayload: Data("fixture-native-token".utf8))] : [], activation: .enabled)
        history = try HistoryRepository.create(at: directory.appendingPathComponent("history.sqlite"),
            capacity: HistoryCapacityPolicy(warningBytes: maximum / 2, maximumBytes: maximum))
    }
    func install(_ maximum: Int = 100) throws {
        try control.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: maximum))
    }
    func remove() { try? control.close(); try? history.close(); try? FileManager.default.removeItem(at: directory) }
    func read(_ token: String? = nil, period: ReflectionPrototypePeriod = .week, zone: String = "UTC") throws -> ReflectionReadSnapshot {
        try history.readReflection(period: period, day: "2026-11-10", timeZone: zone, expectedToken: token)
    }
}
private func reflectionSQL(_ url: URL, _ sql: String) throws {
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(handle); defer { sqlite3_close(db) }
    #expect(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK)
}
private func pause(_ control: ControlRepository) throws {
    let current = try control.readSnapshot()
    _ = try control.setActivation(.paused, expectedSequence: current.snapshotSequence)
}
private func reflectionReason(_ history: HistoryRepository) throws -> CommandID {
    let command = CommandID(UUID())
    _ = try history.prepareReason(reasonRef: ReasonRef(UUID()), commandID: command, body: "架空の確認理由",
        at: Instant(secondsSince1970: 100))
    return command
}

@Test func reflectionAuxInstallsAfterExistingExtensionConnectionAndKeepsMainSchemaSix() throws {
    let f = try ReflectionFixture(); defer { f.remove() }
    let extensionConnection = try ControlRepository.open(at: f.controlURL); defer { try? extensionConnection.close() }
    #expect(try extensionConnection.reflectionBatch() == nil)
    try f.install()
    try pause(extensionConnection)
    let batch = try #require(try extensionConnection.reflectionBatch())
    #expect(batch.facts.count == 2)
    #expect(batch.facts.last?.activation == .paused)
    #expect(!batch.boundary.incomplete)
    try f.control.transferReflection(to: f.history)
    #expect(try f.read().observationCount == 2)
    // No migration of the main schema or destructive rewrite.
    let reopened = try ControlRepository.open(at: f.controlURL); try reopened.close()
}

@Test func reflectionCaptureRollsBackWithIntentAndDoesNotCaptureAckOrIdenticalState() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    enum Abort: Error { case requested }
    #expect(throws: Abort.requested) {
        try f.control.write { tx in
            let snapshot = try tx.snapshot()
            let evaluationID = EvaluationID(UUID())
            _ = try tx.recordApplication(StoredApplication(evaluation: Evaluation(id: evaluationID,
                policyRevision: snapshot.policy.revision, snapshotSequence: snapshot.snapshotSequence,
                evaluatedAt: Instant(secondsSince1970: 100), timeZone: TimeZoneID("UTC"),
                nextBoundary: Instant(secondsSince1970: 200), desiredTargets: []),
                observation: ApplicationObservation(evaluationID: evaluationID, status: .unknown, evidence: nil,
                    observedAt: Instant(secondsSince1970: 100), validUntil: nil, error: nil)), expectedSequence: snapshot.snapshotSequence)
            throw Abort.requested
        }
    }
    #expect(try f.control.reflectionBatch()?.facts.count == 1)
    try f.control.transferReflection(to: f.history)
    let boundary = try #require(try f.control.reflectionBatch()).boundary
    try f.control.transferReflection(to: f.history)
    let snapshot = try f.control.readSnapshot()
    _ = try f.control.setActivation(snapshot.activation, expectedSequence: snapshot.snapshotSequence)
    #expect(try f.control.reflectionBatch()?.boundary == boundary)
    #expect(try f.control.reflectionBatch()?.facts.isEmpty == true)
}

@Test func reflectionPrivateCommitBeforeAckIsIdempotentAfterReopen() throws {
    let f = try ReflectionFixture(withRule: true); defer { f.remove() }; try f.install()
    let batch = try #require(try f.control.reflectionBatch())
    let raw = String(data: try JSONEncoder().encode(batch.facts), encoding: .utf8)!
    #expect(!raw.contains("fixture-native-token") && !raw.contains("opaquePayload") && !raw.contains("reasonRef"))
    try f.history.commitReflectionBatch(batch) // Simulated interruption before shared ack.
    let before = try f.read()
    try f.history.close()
    let reopened = try HistoryRepository.open(at: f.historyURL, capacity: HistoryCapacityPolicy(warningBytes: 500_000, maximumBytes: 1_000_000))
    defer { try? reopened.close() }
    try f.control.transferReflection(to: reopened)
    let after = try reopened.readReflection(period: .month, day: "2026-11-10", timeZone: "UTC", expectedToken: before.token)
    #expect(after.observationCount == 1 && after.token == before.token)
    #expect(try f.control.reflectionBatch()?.facts.isEmpty == true)
}

@Test func reflectionPendingCapacityIsCombinedAndLossDoesNotPreventStop() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install(1)
    try pause(f.control)
    #expect(try f.control.readSnapshot().activation == .paused)
    let batch = try #require(try f.control.reflectionBatch())
    #expect(batch.facts.count == 1 && batch.boundary.highWatermark == 2 && batch.boundary.incomplete)
    #expect(try f.control.pendingHistoryAndReflectionCount() == 1)
    try f.control.transferReflection(to: f.history)
    let value = try f.read()
    #expect(value.incomplete && value.total.knownSeconds == nil)
}

@Test func reflectionOldWriterGapAndPartialAuxDoNotDisableControl() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    try reflectionSQL(f.controlURL, "UPDATE control_state SET snapshot_sequence=snapshot_sequence+1")
    #expect(try f.control.reflectionBatch()?.boundary.incomplete == true) // Read detects lag before next writer.
    try pause(f.control)
    #expect(try f.control.reflectionBatch()?.boundary.incomplete == true)
    try reflectionSQL(f.controlURL, "DROP TABLE reflection_outbox")
    let before = try f.control.readSnapshot()
    _ = try f.control.setActivation(.enabled, expectedSequence: before.snapshotSequence)
    #expect(try f.control.readSnapshot().activation == .enabled)
    try pause(f.control)
    #expect(try f.control.readSnapshot().activation == .paused)
}

@Test func reflectionPrivateCapacityFailureLeavesBatchPendingAndReasonDeleteReleasesBudget() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    let fact = try #require(try f.control.reflectionBatch()?.facts.first)
    let bytes = Int64(try JSONEncoder().encode(fact).count)
    try f.history.close()
    let bounded = try HistoryRepository.open(at: f.historyURL,
        capacity: HistoryCapacityPolicy(warningBytes: bytes / 2, maximumBytes: bytes))
    defer { try? bounded.close() }
    let command = try reflectionReason(bounded)
    #expect(throws: HistoryError.capacityExceeded) { try f.control.transferReflection(to: bounded) }
    #expect(try f.control.reflectionBatch()?.facts.count == 1)
    #expect(try bounded.readReflection(period: .week, day: "2026-11-10", timeZone: "UTC").observationCount == 0)
    #expect(try bounded.reason(for: command)?.body != nil)
    try bounded.deleteReasons()
    try f.control.transferReflection(to: bounded)
    #expect(try bounded.reason(for: command)?.body == nil)
    #expect(try f.control.reflectionBatch()?.facts.isEmpty == true)
}

@Test func reflectionFullDeleteBeforeFirstImportKeepsCutoffAndFreshBaselineRemainsUnknown() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    let old = try #require(try f.control.reflectionBatch())
    try f.history.deleteAllRecords(from: f.control)
    let deleted = try f.read()
    #expect(deleted.total.coverage == .deleted && deleted.observationCount == 0)
    try f.history.commitReflectionBatch(old)
    #expect(try f.read().total.coverage == .deleted)
    try f.control.transferReflection(to: f.history)
    #expect(try f.read().observationCount == 0)
    try f.control.recordReflectionBaseline()
    try f.control.transferReflection(to: f.history)
    let baseline = try f.read()
    #expect(baseline.observationCount == 1 && baseline.total.knownSeconds == nil)
    #expect(try f.control.readSnapshot().activation == .enabled)
    #expect(throws: HistoryError.conflict) { try f.read(deleted.token) }
}

@Test func reflectionHistoryDeleteKeepsLedgerAndJointTokenInvalidatesOnNewFactOrReasonDelete() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    try f.control.transferReflection(to: f.history)
    let before = try f.read()
    let month = try f.read(before.token, period: .month)
    #expect(month.token == before.token && month.total == before.total && month.buckets.count <= 6)
    try f.history.deleteHistory(from: f.control)
    #expect(try f.read().observationCount == 1)
    #expect(throws: HistoryError.conflict) { try f.read(before.token) }
    let new = try f.read()
    #expect(throws: HistoryError.conflict) { try f.read(new.token, zone: "Asia/Tokyo") }
    try pause(f.control); try f.control.transferReflection(to: f.history)
    #expect(throws: HistoryError.conflict) { try f.read(new.token) }
    let latest = try f.read()
    #expect(latest.total.knownSeconds == nil && latest.buckets.allSatisfy { $0.knownSeconds == nil })
    let json = String(data: try JSONEncoder().encode(latest), encoding: .utf8)!
    #expect(!json.contains("syntheticFixture") && !json.contains("prototype-v1"))
}

@Test func reflectionFullDeleteFailureRollsBackReasonsAndCutoffTogether() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    let command = try reflectionReason(f.history)
    try f.control.transferReflection(to: f.history)
    let before = try f.read()
    try reflectionSQL(f.historyURL, "CREATE TRIGGER reflection_abort BEFORE UPDATE ON reflection_facts BEGIN SELECT RAISE(ABORT,'fixture'); END")
    #expect(throws: (any Error).self) { try f.history.deleteAllRecords(from: f.control) }
    #expect(try f.history.reason(for: command)?.body != nil)
    #expect(try f.read(before.token).observationCount == 1)
}

@Test func reflectionSchemaThreeMigrationPreservesReasonAndStartsWithoutInventedPast() throws {
    let f = try ReflectionFixture(); defer { f.remove() }
    let command = try reflectionReason(f.history); try f.history.close()
    try reflectionSQL(f.historyURL, "DROP TABLE reflection_facts; DROP TABLE reflection_sources; DROP TABLE reflection_state; PRAGMA user_version=3")
    #expect(throws: HistoryError.unsupportedSchema(3)) { try HistoryRepository.open(at: f.historyURL, capacity: HistoryCapacityPolicy(warningBytes: 1_000, maximumBytes: 10_000)) }
    let migrated = try HistoryRepository.migrate(at: f.historyURL, capacity: HistoryCapacityPolicy(warningBytes: 1_000, maximumBytes: 10_000))
    defer { try? migrated.close() }
    #expect(try migrated.reason(for: command)?.body == "架空の確認理由")
    let view = try migrated.readReflection(period: .week, day: "2026-11-10", timeZone: "UTC")
    #expect(view.observationCount == 0 && view.total.coverage == .notRecorded && view.total.knownSeconds == nil)
}

@Test func reflectionBaselineRetainsEndedGrantAwaitingReblockAfterFullDeletion() throws {
    let f = try ReflectionFixture(withRule: true); defer { f.remove() }; try f.install()
    let before = try f.control.readSnapshot()
    let rule = try #require(before.policy.rules.first)
    let target = try #require(before.selections.first?.selection.targets.first)
    let at = try Instant(secondsSince1970: ISO8601DateFormatter().date(from: "2026-11-09T10:00:00Z")!.timeIntervalSince1970)
    let occurrence = try OccurrenceKey(ruleID: rule.id, ruleVersion: rule.version, startDay: LocalDate(year: 2026, month: 11, day: 9),
        timeZone: TimeZoneID("UTC"), resolvedStart: Instant(secondsSince1970: at.secondsSince1970 - 3_600))
    let commandID = CommandID(UUID())
    let command = try Command(id: commandID, kind: .requestTemporaryGrant, status: .pending,
        expectedPolicyRevision: before.policy.revision, attempt: AttemptNumber(0), reasonRef: ReasonRef(UUID()))
    let request = GrantRequest(grantID: GrantID(UUID()), commandID: commandID, targetRef: target,
        expectedPolicyRevision: before.policy.revision, expectedOccurrence: occurrence,
        condition: try .reason("fixture-secret-reason"), duration: try UnlockDuration(minutes: 5))
    let context = EvaluationContext(now: at, timeZone: try TimeZoneID("UTC"),
        authorization: AuthorizationObservation(status: .approved, observedAt: at), activation: .enabled)
    let accepted = try f.control.write { try $0.acceptGrant(command: command, request: request, context: context, expectedSequence: before.snapshotSequence) }
    _ = try f.control.write { try $0.recordGrant(accepted.grant.recording(status: .invalidated), expected: accepted.grant) }
    try f.history.deleteAllRecords(from: f.control)
    try f.control.recordReflectionBaseline()
    let baseline = try #require(try f.control.reflectionBatch()?.facts.last)
    let ended = try #require(baseline.grants.first)
    #expect(ended.id == accepted.grant.id && ended.ended && ended.status == .invalidated)
    #expect(ended.expiresAt == accepted.grant.effectiveExpiresAt)
    #expect(!(String(data: try JSONEncoder().encode(baseline), encoding: .utf8)!).contains("fixture-secret-reason"))
    try f.control.transferReflection(to: f.history)
    #expect(try f.read().total.knownSeconds == nil)
}

@Test func reflectionDefaultCalendarDayUsesPinnedAsOfAcrossMonthBoundary() throws {
    let f = try ReflectionFixture(); defer { f.remove() }
    let first = try Instant(secondsSince1970: ISO8601DateFormatter().date(from: "2026-11-30T23:30:00Z")!.timeIntervalSince1970)
    let next = try Instant(secondsSince1970: first.secondsSince1970 + 7_200)
    let original = try f.history.readReflection(period: .month, day: "", timeZone: "UTC", now: first)
    let pinned = try f.history.readReflection(period: .month, day: "", timeZone: "UTC", expectedToken: original.token, now: next)
    #expect(pinned.token == original.token && pinned.anchor == "2026-11-01")
}

@Test func reflectionCorruptPayloadAfterOpenIsAnErrorRatherThanEmptyOrZero() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    try f.control.transferReflection(to: f.history)
    try reflectionSQL(f.historyURL, "UPDATE reflection_facts SET record=x'7b',payload_bytes=1")
    #expect(throws: HistoryError.corrupt) { try f.read() }
    try f.history.close()
    #expect(throws: HistoryError.corrupt) {
        try HistoryRepository.open(at: f.historyURL, capacity: HistoryCapacityPolicy(warningBytes: 1_000, maximumBytes: 10_000))
    }
}

@Test func reflectionImportAfterCapturedDeletionBoundarySurvivesAcrossConnections() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    let old = try #require(try f.control.reflectionBatch())
    let boundary = try f.control.recordsDeletionBoundary()
    try pause(f.control) // New control fact committed after the deletion's sampled boundary.
    let other = try HistoryRepository.open(at: f.historyURL, capacity: HistoryCapacityPolicy(warningBytes: 500_000, maximumBytes: 1_000_000))
    defer { try? other.close() }
    try f.control.transferReflection(to: other)
    #expect(try f.read().observationCount == 2)
    try f.history.deleteAllRecords(through: boundary)
    #expect(try f.read().observationCount == 1)
    try f.history.commitReflectionBatch(old)
    #expect(try f.read().observationCount == 1)
    #expect(try f.control.readSnapshot().activation == .paused)
}

@Test func reflectionFactsCopyCurrentPolicySelectionsOnlyAndNeverPickerDraftRegistry() throws {
    let f = try ReflectionFixture(withRule: true); defer { f.remove() }; try f.install()
    for _ in 0..<20 {
        let before = try f.control.readSnapshot()
        _ = try f.control.putSelection(StoredSelection(selection: Selection(ref: SelectionRef(UUID()), targets: [TargetRef(UUID())]),
            opaquePayload: Data("fixture-unused-picker-token".utf8)), expectedSequence: before.snapshotSequence)
    }
    #expect(try f.control.readSnapshot().selections.count == 21)
    let batch = try #require(try f.control.reflectionBatch())
    #expect(batch.facts.count == 21 && !batch.boundary.incomplete)
    #expect(batch.facts.allSatisfy { $0.selections.count == 1 })
}

@Test func reflectionMissingOutboxRowIsNotAnEmptyCurrentStreamAndCannotPreventStop() throws {
    let f = try ReflectionFixture(); defer { f.remove() }; try f.install()
    try reflectionSQL(f.controlURL, "DELETE FROM reflection_outbox")
    #expect(throws: StorageError.corrupt) { try f.control.reflectionBatch() }
    try pause(f.control)
    #expect(try f.control.readSnapshot().activation == .paused)
    #expect(try f.control.reflectionBatch()?.boundary.incomplete == true)
}
