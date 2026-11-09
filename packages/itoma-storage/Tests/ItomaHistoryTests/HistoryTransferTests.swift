import CSQLite
import Foundation
import ItomaCore
@testable import ItomaHistory
import ItomaStorage
import Testing

private func id<Kind>(_ n: Int) -> EntityID<Kind> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private func time(_ seconds: Double = 100) throws -> Instant { try Instant(secondsSince1970: seconds) }
private func budget(_ maximum: Int64 = 1_000_000) throws -> HistoryCapacityPolicy { try HistoryCapacityPolicy(warningBytes: maximum / 2, maximumBytes: maximum) }
private func outbox(_ maximum: Int = 100) throws -> HistoryOutboxCapacity { try HistoryOutboxCapacity(maximumPendingEvents: maximum) }
private func policy(_ revision: Int64 = 0) throws -> PolicySnapshot { try PolicySnapshot(revision: PolicyRevision(revision), rules: [], priorityOrder: []) }

private struct Fixture {
    let directory: URL
    let control: ControlRepository
    let history: HistoryRepository
    var controlURL: URL { directory.appendingPathComponent("control.sqlite") }
    var historyURL: URL { directory.appendingPathComponent("history.sqlite") }
    init(reasonRule: Bool = false) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let rule = try Rule(id: id(1), version: RuleVersion(0), enabled: true, selectionRef: id(1),
                            schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 540, endMinute: 1020, endDayOffset: .sameDay), unlockMode: .reason)
        let initial = reasonRule ? try PolicySnapshot(revision: PolicyRevision(0), rules: [rule], priorityOrder: [id(1)]) : try policy()
        control = try ControlRepository.create(at: directory.appendingPathComponent("control.sqlite"), initialPolicy: initial,
                                              selections: reasonRule ? [StoredSelection(selection: Selection(ref: id(1), targets: [id(1)]), opaquePayload: Data([1]))] : [],
                                              activation: reasonRule ? .enabled : .paused)
        history = try HistoryRepository.create(at: directory.appendingPathComponent("history.sqlite"), capacity: budget())
    }
    func remove() { try? history.close(); try? control.close(); try? FileManager.default.removeItem(at: directory) }
}

private func command(_ n: Int = 1, status: CommandStatus = .pending) throws -> Command {
    try Command(id: id(n), kind: .commitPolicy, status: status, expectedPolicyRevision: PolicyRevision(0),
                candidatePolicyRevision: PolicyRevision(1), attempt: AttemptNumber(0))
}

private func accept(_ control: ControlRepository, n: Int = 1) throws {
    let sequence = try control.readSnapshot().snapshotSequence
    try control.write {
        _ = try $0.acceptCandidate(command: command(n), candidate: PolicyCandidate(commandID: id(n), expectedRevision: PolicyRevision(0), proposedPolicy: policy(1)), expectedSequence: sequence)
    }
}

@discardableResult private func enqueue(_ control: ControlRepository, event: Int = 1, cmd: Int = 1, maximum: Int = 100) throws -> HistoryEnqueueResult {
    try control.write { try $0.enqueueCommandHistory(eventID: id(event), commandID: id(cmd), at: time(Double(event)), capacity: outbox(maximum)) }
}

private func sql(_ url: URL, _ body: (OpaquePointer) throws -> Void) throws {
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(handle); defer { sqlite3_close(db) }
    try body(db)
}
private func execute(_ db: OpaquePointer, _ text: String) { #expect(sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK) }

@Test func privateCommitThenAckCrashReplayImportsOneImmutableEvent() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control)
    #expect(try enqueue(f.control) == .enqueued(HistorySequence(1)))
    #expect(try enqueue(f.control) == .alreadyPending(HistorySequence(1)))
    let batch = try f.control.historyBatch()
    #expect(try f.history.commitHistoryBatch(batch).imported == 1)
    #expect(try f.control.historyBatch().entries.count == 1) // simulate kill before ack
    try f.history.close(); try f.control.close()
    let history = try HistoryRepository.open(at: f.historyURL, capacity: budget())
    let control = try ControlRepository.open(at: f.controlURL)
    #expect(try control.transferHistory(to: history).alreadyPresent == 1)
    #expect(try history.history().count == 1)
    #expect(try control.historyBatch().entries.isEmpty)
    #expect(try enqueue(control) == .alreadyAcknowledged(HistorySequence(1)))
    #expect(try control.historyBoundary().highWatermark.rawValue == 1)
    try enqueue(control, event: 2)
    #expect(try control.historyBatch().entries[0].sequence.rawValue == 2)
    try control.close(); try history.close()
}

@Test func sharedReadWriterIsClosedBeforeCallingThePrivateSink() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control); try enqueue(f.control)
    struct ProbingSink: ControlHistorySink {
        let url: URL
        let history: HistoryRepository
        func commitHistoryBatch(_ batch: HistoryOutboxBatch) throws -> HistoryImportResult {
            try sql(url) { db in execute(db, "BEGIN IMMEDIATE"); execute(db, "ROLLBACK") }
            return try history.commitHistoryBatch(batch)
        }
    }
    #expect(try f.control.transferHistory(to: ProbingSink(url: f.controlURL, history: f.history)).imported == 1)
    #expect(try f.control.historyBatch().entries.isEmpty)
}

@Test func capacityOrPrivateInsertFailureDoesNotAckOrPartiallyImport() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control); try enqueue(f.control, event: 1); try enqueue(f.control, event: 2)
    let batch = try f.control.historyBatch()
    let oneSize = try JSONEncoder().encode(PrivateHistoryRecord.control(batch.entries[0].event)).count
    try f.history.close()
    let small = try HistoryRepository.open(at: f.historyURL, capacity: budget(Int64(oneSize + 10)))
    #expect(throws: HistoryError.capacityExceeded) { try f.control.transferHistory(to: small) }
    #expect(try small.history().isEmpty)
    #expect(try small.capacity().logicalPayloadBytes == 0)
    #expect(try f.control.historyBatch().entries.count == 2)
    #expect(try f.control.historyBoundary().historyIncomplete)
    try small.close()
    let normal = try HistoryRepository.open(at: f.historyURL, capacity: budget())
    try sql(f.historyURL) { execute($0, "CREATE TRIGGER inject_import BEFORE INSERT ON history_events BEGIN SELECT RAISE(ABORT,'fixture'); END") }
    #expect(throws: HistoryError.conflict) { try f.control.transferHistory(to: normal) }
    #expect(try normal.history().isEmpty)
    #expect(try f.control.historyBatch().entries.count == 2)
    try sql(f.historyURL) { execute($0, "DROP TRIGGER inject_import") }
    #expect(try f.control.transferHistory(to: normal).imported == 2)
    #expect(try normal.historyIncomplete())
    try normal.close()
}

@Test func failedAckAfterPrivateCommitIsRetriedWithoutAnotherHistoryRow() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control); try enqueue(f.control)
    try sql(f.controlURL) { execute($0, "CREATE TRIGGER inject_ack BEFORE DELETE ON history_outbox BEGIN SELECT RAISE(ABORT,'fixture'); END") }
    #expect(throws: StorageError.conflict) { try f.control.transferHistory(to: f.history) }
    #expect(try f.history.history().count == 1)
    #expect(try f.control.historyBatch().entries.count == 1)
    try sql(f.controlURL) { execute($0, "DROP TRIGGER inject_ack") }
    #expect(try f.control.transferHistory(to: f.history).alreadyPresent == 1)
    #expect(try f.history.history().count == 1)
    #expect(try f.control.historyBatch().entries.isEmpty)
}

@Test func fullOutboxLeavesAGapAndDoesNotBlockSafetyMetadataOrActivationStop() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control)
    try enqueue(f.control, maximum: 1)
    _ = try f.control.setActivation(.enabled, expectedSequence: f.control.readSnapshot().snapshotSequence)
    let before = try f.control.readSnapshot()
    try f.control.write { tx in
        _ = try tx.recordCommand(command(status: .failed), expected: command())
        #expect(try tx.enqueueCommandHistory(eventID: id(2), commandID: id(1), at: time(2), capacity: outbox(1)) == .gap)
        _ = try tx.setActivation(.paused, expectedSequence: tx.snapshot().snapshotSequence)
    }
    #expect(try f.control.command(id(1))?.status == .failed)
    #expect(try f.control.readSnapshot().activation == .paused)
    #expect(try f.control.readSnapshot().snapshotSequence > before.snapshotSequence)
    #expect(try f.control.historyBoundary().historyIncomplete)
    #expect(try f.control.historyBatch().entries.count == 1)
    #expect(throws: StorageError.invalidHistoryCapacity) { try HistoryOutboxCapacity(maximumPendingEvents: 0) }
}

@Test func changedPendingEventIdCannotCommitAnotherCommandStatus() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control); try enqueue(f.control)
    #expect(throws: StorageError.rollbackRequired) {
        try f.control.write { tx in
            _ = try tx.recordCommand(command(status: .applying), expected: command())
            do { _ = try tx.enqueueCommandHistory(eventID: id(1), commandID: id(1), at: time(1), capacity: outbox()) }
            catch StorageError.conflict { }
        }
    }
    #expect(try f.control.command(id(1))?.status == .pending)
    #expect(try f.control.historyBatch().entries.count == 1)
}

@Test func optionalOutboxInsertFailureRollsBackOnlyHistoryAndPreservesStopMetadata() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control)
    _ = try f.control.setActivation(.enabled, expectedSequence: f.control.readSnapshot().snapshotSequence)
    try sql(f.controlURL) { execute($0, "CREATE TRIGGER inject_outbox BEFORE INSERT ON history_outbox BEGIN SELECT RAISE(ABORT,'fixture'); END") }
    try f.control.write { tx in
        _ = try tx.recordCommand(command(status: .failed), expected: command())
        _ = try tx.setActivation(.paused, expectedSequence: tx.snapshot().snapshotSequence)
        let result = try tx.enqueueCommandHistory(eventID: id(1), commandID: id(1), at: time(1), capacity: outbox())
        #expect(result == .gap)
    }
    #expect(try f.control.command(id(1))?.status == .failed)
    #expect(try f.control.readSnapshot().activation == .paused)
    #expect(try f.control.historyBatch().entries.isEmpty)
    #expect(try f.control.historyBoundary().historyIncomplete)
    #expect(try f.control.historyBoundary().highWatermark.rawValue == 0)
    try sql(f.controlURL) { execute($0, "DROP TRIGGER inject_outbox") }
    #expect(try enqueue(f.control) == .enqueued(HistorySequence(1))) // no orphan ID from failed append
}

@Test func outboxFailureThatAutoRollsBackTheWholeWriterCannotBecomeSuccess() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control)
    let before = try f.control.readSnapshot()
    try sql(f.controlURL) { execute($0, "CREATE TRIGGER inject_rollback BEFORE INSERT ON history_outbox BEGIN SELECT RAISE(ROLLBACK,'fixture'); END") }
    #expect(throws: StorageError.rollbackRequired) {
        try f.control.write { tx in
            _ = try tx.recordCommand(command(status: .failed), expected: command())
            _ = try tx.enqueueCommandHistory(eventID: id(1), commandID: id(1), at: time(1), capacity: outbox())
        }
    }
    #expect(try f.control.readSnapshot() == before)
    #expect(try f.control.command(id(1))?.status == .pending)
    #expect(try f.control.historyBatch().entries.isEmpty)
    #expect(try !f.control.historyBoundary().historyIncomplete)
}

@Test func caughtFailureToPersistTheHistoryGapStillRejectsTheOuterCommit() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control)
    let before = try f.control.readSnapshot()
    try sql(f.controlURL) { db in
        execute(db, "CREATE TRIGGER inject_outbox BEFORE INSERT ON history_outbox BEGIN SELECT RAISE(ABORT,'fixture'); END")
        execute(db, "CREATE TRIGGER inject_gap BEFORE UPDATE OF history_incomplete ON history_state BEGIN SELECT RAISE(ABORT,'fixture'); END")
    }
    #expect(throws: StorageError.rollbackRequired) {
        try f.control.write { tx in
            _ = try tx.setActivation(.enabled, expectedSequence: before.snapshotSequence)
            do { _ = try tx.enqueueCommandHistory(eventID: id(1), commandID: id(1), at: time(1), capacity: outbox()) }
            catch StorageError.conflict { }
        }
    }
    #expect(try f.control.readSnapshot() == before)
    #expect(try f.control.historyBatch().entries.isEmpty)
}

@Test func deletionCutoffSkipsOldPendingPayloadAndKeepsNewEventsAndNewSources() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control); try enqueue(f.control, event: 1); try enqueue(f.control, event: 2)
    _ = try f.history.prepareReason(reasonRef: id(100), commandID: id(100), body: "fixture", at: time())
    let old = try f.control.historyBatch()
    try f.history.deleteHistory(from: f.control)
    #expect(try f.history.reason(for: id(100))?.isDeleted == true)
    #expect(try f.control.transferHistory(to: f.history).skippedByDeletion == 2)
    #expect(try f.history.history().isEmpty)
    try enqueue(f.control, event: 3)
    #expect(try f.control.transferHistory(to: f.history).imported == 1)
    #expect(try f.history.commitHistoryBatch(old).alreadyPresent == 2)
    #expect(try f.history.history().count == 1)
    let other = try ControlRepository.create(at: f.directory.appendingPathComponent("replacement.sqlite"), initialPolicy: policy(), activation: .paused)
    try accept(other); try enqueue(other, event: 4)
    #expect(try other.historyBoundary().sourceID != old.boundary.sourceID)
    #expect(try other.transferHistory(to: f.history).imported == 1)
    #expect(try f.history.history().count == 2)
    try other.close()
}

@Test func anImportAfterTheCapturedDeletionBoundaryIsNotErased() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control); try enqueue(f.control, event: 1)
    _ = try f.control.transferHistory(to: f.history)
    let boundary = try f.control.historyBoundary()
    try enqueue(f.control, event: 2)
    _ = try f.control.transferHistory(to: f.history)
    try f.history.deleteHistory(through: boundary)
    let records = try f.history.history()
    #expect(records.count == 1 && records[0].record.id == id(2))
    try f.history.close()
    let reopened = try HistoryRepository.open(at: f.historyURL, capacity: budget())
    #expect(try reopened.history().count == 1)
    try reopened.close()
}

@Test func cancellationAndDummySelectionNeverStoreAnUnconfirmedBodyOrPayment() throws {
    let f = try Fixture(); defer { f.remove() }
    let choice = try DummyChoice(minorUnits: 47, currencyCode: "JPY") // storage fixture, no product default
    #expect(throws: HistoryError.invalidDummySelection) {
        try f.history.prepareDummySelection(commandID: id(10), choice: choice, selectionConfirmed: false, at: time())
    }
    #expect(try f.history.dummySelection(for: id(10)) == nil)
    let prepared = try f.history.prepareDummySelection(commandID: id(10), choice: choice, selectionConfirmed: true, at: time())
    #expect(try f.history.prepareDummySelection(commandID: id(10), choice: choice, selectionConfirmed: true, at: time(999)) == prepared)
    #expect(throws: HistoryError.conflict) { try f.history.prepareReason(reasonRef: id(10), commandID: id(10), body: "fixture", at: time()) }
    try f.history.recordCancellation(eventID: id(20), at: time())
    #expect(try f.history.history()[0].record == .cancelled(id: id(20), at: time()))
    let first = try f.history.history(limit: 1)
    #expect(try f.history.history(limit: 1, after: first[0].cursor).isEmpty)
    try f.history.deleteHistory(from: f.control)
    #expect(try f.history.capacity().logicalPayloadBytes == 0)
    #expect(throws: HistoryError.deleted) { try f.history.prepareDummySelection(commandID: id(10), choice: choice, selectionConfirmed: true, at: time()) }
    try f.history.recordCancellation(eventID: id(20), at: time(999))
    #expect(try f.history.history().isEmpty)
    #expect(throws: HistoryError.invalidDummySelection) { try DummyChoice(minorUnits: -1, currencyCode: "JPY") }
    #expect(throws: HistoryError.invalidDummySelection) { try DummyChoice(minorUnits: 1, currencyCode: "jpy") }
}

@Test func explicitControlAndPrivateMigrationsKeepTheirExistingRecords() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control)
    let before = try f.control.readSnapshot()
    _ = try f.history.prepareReason(reasonRef: id(100), commandID: id(100), body: "fixture", at: time())
    try f.control.close(); try f.history.close()
    try sql(f.controlURL) { execute($0, "DROP TABLE activation_state; DROP TABLE application_state; DROP TABLE history_outbox; DROP TABLE history_event_ids; DROP TABLE history_state; PRAGMA user_version=3") }
    try sql(f.historyURL) { execute($0, "DROP TABLE history_events; DROP TABLE history_sources; DROP TABLE dummy_selections; DROP TABLE history_read_index; DROP TABLE history_read_state; PRAGMA user_version=1") }
    #expect(throws: StorageError.unsupportedSchema(3)) { try ControlRepository.open(at: f.controlURL) }
    #expect(throws: HistoryError.unsupportedSchema(1)) { try HistoryRepository.open(at: f.historyURL, capacity: budget()) }
    let control = try ControlRepository.migrate(at: f.controlURL)
    let history = try HistoryRepository.migrate(at: f.historyURL, capacity: budget())
    #expect(try control.readSnapshot() == before)
    #expect(try control.command(id(1)) == command())
    #expect(try history.reason(for: id(100))?.body == "fixture")
    try enqueue(control)
    #expect(try control.transferHistory(to: history).imported == 1)
    try control.close(); try history.close()
}

@Test func corruptedOutboxDoesNotBecomeAnAcknowledgedEmptySuccess() throws {
    let f = try Fixture(); defer { f.remove() }
    try accept(f.control); try enqueue(f.control)
    try sql(f.controlURL) { execute($0, "UPDATE history_outbox SET record=x'7b'") }
    #expect(throws: StorageError.corrupt) { try f.control.transferHistory(to: f.history) }
    #expect(try f.history.history().isEmpty)
    try sql(f.controlURL) { execute($0, "DELETE FROM history_event_ids") }
    #expect(throws: StorageError.corrupt) { try f.control.historyBoundary() }
    #expect(throws: StorageError.corrupt) { try f.control.readSnapshot() }
}

@Test func privatePrepareCompletesBeforeSharedIntentAndFailureNeverLooksAccepted() throws {
    let f = try Fixture(); defer { f.remove() }
    // Private Prepared survives an independent shared writer; no shared acceptance can occur.
    _ = try f.history.prepareReason(reasonRef: id(50), commandID: id(50), body: "fixture", at: time())
    #expect(try f.history.reconcileReason(for: id(50), in: f.control) == .preparedOnly)
    #expect(try f.history.reconcileReason(for: id(51), in: f.control) == .missing)
    try f.history.deleteReasons()
    #expect(try f.history.reconcileReason(for: id(50), in: f.control) == .deleted)
    #expect(try f.control.command(id(50)) == nil)
}

private func reasonInput(_ f: Fixture) throws -> (Command, GrantRequest, EvaluationContext) {
    let now = try time(12 * 3_600)
    let context = try EvaluationContext(now: now, timeZone: TimeZoneID("UTC"),
                                        authorization: AuthorizationObservation(status: .approved, observedAt: now), activation: .enabled)
    let snapshot = try f.control.readSnapshot()
    let evaluation = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection), context: context, grants: [])
    let command = try Command(id: id(1), kind: .requestTemporaryGrant, status: .pending, expectedPolicyRevision: PolicyRevision(0), attempt: AttemptNumber(0), reasonRef: id(101))
    let request = try GrantRequest(grantID: id(1), commandID: id(1), targetRef: id(1), expectedPolicyRevision: PolicyRevision(0),
                                   expectedOccurrence: #require(evaluation.rules.targets[id(1)]?.winner?.key), condition: UnlockCondition.reason("fixture"))
    return (command, request, context)
}

@Test func reasonAcceptanceCommitsPrivateBeforeSharedBusyThenRetriesAsPendingOnly() throws {
    let f = try Fixture(reasonRule: true); defer { f.remove() }
    let (command, request, context) = try reasonInput(f)
    let body = "synthetic-only-private-fixture"
    try sql(f.controlURL) { db in
        execute(db, "BEGIN IMMEDIATE")
        #expect(throws: StorageError.busy) {
            try f.history.acceptReasonGrant(in: f.control, command: command, request: request, body: body,
                                             context: context, expectedSequence: SnapshotSequence(0))
        }
        let stored = try f.history.reason(for: command.id)
        #expect(stored?.body == body)
        execute(db, "ROLLBACK")
    }
    #expect(try f.control.command(command.id) == nil)
    #expect(try f.history.reconcileReason(for: command.id, in: f.control) == .preparedOnly)
    let accepted = try f.history.acceptReasonGrant(in: f.control, command: command, request: request, body: body,
                                                   context: context, expectedSequence: SnapshotSequence(0))
    #expect(accepted.command.status == .pending && accepted.grant.status == .pending)
    #expect(try f.history.reconcileReason(for: command.id, in: f.control) == .sharedAccepted(.pending))
    try f.control.write {
        _ = try $0.enqueueGrantHistory(eventID: id(1), grantID: accepted.grant.id, at: context.now, capacity: outbox())
    }
    let event = try #require(f.control.historyBatch().entries.first?.event)
    #expect(event.kind == .grant && event.command.reasonRef == id(101))
    #expect(try JSONEncoder().encode(event).range(of: Data(body.utf8)) == nil)
    #expect(try f.control.transferHistory(to: f.history).imported == 1)
}

@Test func reasonPrivateCapacityFailureNeverCreatesASharedGrantOrCommand() throws {
    let f = try Fixture(reasonRule: true); defer { f.remove() }
    let (command, request, context) = try reasonInput(f)
    try f.history.close()
    let small = try HistoryRepository.open(at: f.historyURL, capacity: budget(3))
    #expect(throws: HistoryError.capacityExceeded) {
        try small.acceptReasonGrant(in: f.control, command: command, request: request, body: "fixture",
                                     context: context, expectedSequence: SnapshotSequence(0))
    }
    #expect(try f.control.command(command.id) == nil)
    #expect(try f.control.grant(request.grantID) == nil)
    #expect(try small.reason(for: command.id) == nil)
    #expect(try f.control.readSnapshot().snapshotSequence.rawValue == 0)
    try small.close()
}

@Test func reasonAcceptanceInsideSharedWriterIsRejectedBeforeAnyPrivatePrepare() throws {
    let f = try Fixture(reasonRule: true); defer { f.remove() }
    let (command, request, context) = try reasonInput(f)
    #expect(throws: StorageError.nestedTransaction) {
        try f.control.write { _ in
            try f.history.acceptReasonGrant(in: f.control, command: command, request: request, body: "fixture",
                                             context: context, expectedSequence: SnapshotSequence(0))
        }
    }
    #expect(try f.history.reason(for: command.id) == nil)
    #expect(try f.control.command(command.id) == nil)
    #expect(try f.control.readSnapshot().snapshotSequence.rawValue == 0)
}
