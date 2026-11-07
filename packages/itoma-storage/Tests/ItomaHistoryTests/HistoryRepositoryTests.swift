import CSQLite
import Foundation
import ItomaCore
import ItomaHistory
import ItomaStorage
import Testing

private struct Fixture {
    let directory: URL
    var url: URL { directory.appendingPathComponent("history.sqlite") }
    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    func remove() { try? FileManager.default.removeItem(at: directory) }
}

private func id<Kind>(_ n: Int) -> EntityID<Kind> {
    EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!)
}

private func capacity(_ maximum: Int64 = 1_024, warning: Int64 = 512) throws -> HistoryCapacityPolicy {
    try HistoryCapacityPolicy(warningBytes: min(warning, maximum), maximumBytes: maximum)
}

private func instant(_ n: Double = 100) throws -> Instant { try Instant(secondsSince1970: n) }

private func create(_ f: Fixture, maximum: Int64 = 1_024) throws -> HistoryRepository {
    try HistoryRepository.create(at: f.url, capacity: capacity(maximum), busyTimeoutMilliseconds: 1)
}

private func sql(_ url: URL, _ body: (OpaquePointer) throws -> Void) throws {
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let database = try #require(handle)
    defer { sqlite3_close(database) }
    try body(database)
}

private func execute(_ db: OpaquePointer, _ sql: String) {
    #expect(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK)
}

@Test func preparedOriginalUTF8RoundTripsWithoutImplyingAnySharedCommand() throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f)
    let text = "  fixture🌱e\u{301}\0after-nul\n"
    let record = try repository.prepareReason(reasonRef: id(1), commandID: id(2), body: text, at: instant())
    #expect(record.preparedAt == (try instant()) && !record.isDeleted)
    #expect(Data(try #require(record.body).utf8) == Data(text.utf8))
    try repository.close()
    let reopened = try HistoryRepository.open(at: f.url, capacity: capacity())
    #expect(try reopened.reason(for: id(2)) == record)
    #expect(try reopened.capacity().logicalPayloadBytes == Int64(text.utf8.count))
    #expect(try reopened.reasons().count == 1)
    #expect(try reopened.reason(for: id(77)) == nil)
    #expect(!FileManager.default.fileExists(atPath: f.directory.appendingPathComponent("control.sqlite").path))
    try reopened.close()
}

@Test func preparedRetryPreservesFirstTimeButRejectsDifferentIdentitiesOrUTF8() throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f)
    let first = try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "e\u{301}", at: instant())
    #expect(try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "e\u{301}", at: instant(900)) == first)
    #expect(throws: HistoryError.conflict) { try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "é", at: instant()) }
    #expect(throws: HistoryError.conflict) { try r.prepareReason(reasonRef: id(3), commandID: id(2), body: "e\u{301}", at: instant()) }
    #expect(throws: HistoryError.conflict) { try r.prepareReason(reasonRef: id(1), commandID: id(3), body: "e\u{301}", at: instant()) }
    #expect(try r.reasons().count == 1)
    try r.close()
}

@Test(arguments: ["", " \n\t", "\u{3000}"])
func blankConfirmedReasonCannotBePrepared(body: String) throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f)
    #expect(throws: HistoryError.invalidReason) { try r.prepareReason(reasonRef: id(1), commandID: id(2), body: body, at: instant()) }
    #expect(try r.reasons().isEmpty)
    #expect(try r.capacity().logicalPayloadBytes == 0)
    try r.close()
}

@Test(arguments: [(-1 as Int64, 10 as Int64), (0, 0), (11, 10)])
func invalidBudgetsAreRejected(values: (Int64, Int64)) throws {
    #expect(throws: HistoryError.invalidCapacity) { try HistoryCapacityPolicy(warningBytes: values.0, maximumBytes: values.1) }
}

@Test func utf8CapacityNeverTruncatesOldDataAndReplayDoesNotConsumeBudget() throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f, maximum: 6)
    _ = try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "あ", at: instant())
    _ = try r.prepareReason(reasonRef: id(3), commandID: id(4), body: "あ", at: instant())
    #expect(try r.capacity().limitReached)
    #expect(throws: HistoryError.capacityExceeded) { try r.prepareReason(reasonRef: id(5), commandID: id(6), body: "x", at: instant()) }
    #expect(try r.capacity().logicalPayloadBytes == 6)
    try r.close()
    let smaller = try HistoryRepository.open(at: f.url, capacity: capacity(2))
    #expect(try smaller.prepareReason(reasonRef: id(1), commandID: id(2), body: "あ", at: instant(999)).preparedAt == instant())
    #expect(throws: HistoryError.capacityExceeded) { try smaller.prepareReason(reasonRef: id(7), commandID: id(8), body: "a", at: instant()) }
    #expect(try smaller.reasons().count == 2)
    try smaller.close()
}

@Test func explicitDeletionRetainsTombstonesAcrossRestartAndNeverResurrectsBody() throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f)
    _ = try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "synthetic", at: instant())
    try r.deleteReasons()
    #expect(try r.reason(for: id(2))?.isDeleted == true)
    #expect(try r.capacity().logicalPayloadBytes == 0)
    try r.close()
    let reopened = try HistoryRepository.open(at: f.url, capacity: capacity())
    #expect(throws: HistoryError.deleted) { try reopened.prepareReason(reasonRef: id(1), commandID: id(2), body: "synthetic", at: instant(999)) }
    #expect(throws: HistoryError.conflict) { try reopened.prepareReason(reasonRef: id(3), commandID: id(2), body: "synthetic", at: instant()) }
    _ = try reopened.prepareReason(reasonRef: id(3), commandID: id(4), body: "new", at: instant())
    #expect(try reopened.reason(for: id(2))?.body == nil)
    #expect(try reopened.capacity().logicalPayloadBytes == 3)
    try reopened.close()
}

@Test func privateFailureAndCompetingWriterDoNotPrepareAnUncommittedReason() throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f)
    try sql(f.url) { db in
        execute(db, "BEGIN IMMEDIATE")
        #expect(throws: HistoryError.busy) { try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "fixture", at: instant()) }
        let records = try r.reasons()
        #expect(records.isEmpty)
        execute(db, "ROLLBACK")
        execute(db, "CREATE TRIGGER inject_failure BEFORE INSERT ON reasons BEGIN SELECT RAISE(ABORT,'synthetic'); END")
    }
    #expect(throws: HistoryError.conflict) { try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "fixture", at: instant()) }
    #expect(try r.reasons().isEmpty)
    try sql(f.url) { execute($0, "DROP TRIGGER inject_failure") }
    _ = try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "fixture", at: instant())
    try r.close()
}

@Test func failedOrUnsupportedDatabaseIsNeverSilentlyInitialized() throws {
    let f = try Fixture(); defer { f.remove() }
    #expect(throws: HistoryError.missingDatabase) { try HistoryRepository.open(at: f.url, capacity: capacity()) }
    #expect(!FileManager.default.fileExists(atPath: f.url.path))
    let bytes = Data("not a database fixture".utf8)
    try bytes.write(to: f.url)
    #expect(throws: HistoryError.alreadyExists) { try create(f) }
    #expect(throws: HistoryError.corrupt) { try HistoryRepository.open(at: f.url, capacity: capacity()) }
    #expect(try Data(contentsOf: f.url) == bytes)
    let other = try Fixture(); defer { other.remove() }
    let r = try create(other)
    try sql(other.url) { execute($0, "PRAGMA user_version=77") }
    #expect(throws: HistoryError.unsupportedSchema(77)) { try r.reasons() }
    #expect(throws: HistoryError.unsupportedSchema(77)) { try r.deleteReasons() }
    #expect(throws: HistoryError.unsupportedSchema(77)) { try HistoryRepository.open(at: other.url, capacity: capacity()) }
    try sql(other.url) { execute($0, "PRAGMA user_version=2; PRAGMA application_id=123") }
    #expect(throws: HistoryError.wrongDatabase) { try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "fixture", at: instant()) }
    try r.close()
}

@Test func sharedAndPrivateProductsRejectEachOthersDatabase() throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f)
    #expect(throws: StorageError.unsupportedSchema(2)) { try ControlRepository.open(at: f.url) }
    let controlURL = f.directory.appendingPathComponent("control.sqlite")
    let control = try ControlRepository.create(at: controlURL, initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [], priorityOrder: []), activation: .paused)
    #expect(throws: HistoryError.unsupportedSchema(6)) { try HistoryRepository.open(at: controlURL, capacity: capacity()) }
    try control.close()
    try r.close()
}

@Test func privateCorruptionAndMissingTablesAreReportedWithoutResettingData() throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f)
    _ = try r.prepareReason(reasonRef: id(1), commandID: id(2), body: "synthetic", at: instant())
    try sql(f.url) { execute($0, "UPDATE reasons SET body=x'ff',payload_bytes=1") }
    #expect(throws: HistoryError.corrupt) { try r.reason(for: id(2)) }
    #expect(throws: HistoryError.corrupt) { try HistoryRepository.open(at: f.url, capacity: capacity()) }
    try sql(f.url) { execute($0, "DROP TABLE reasons") }
    #expect(throws: HistoryError.corrupt) { try r.reasons() }
    try r.close()
}

@Test func nulPathClosedConnectionAndFileSizesHaveExplicitOutcomes() throws {
    let f = try Fixture(); defer { f.remove() }
    let nul = URL(fileURLWithPath: f.url.path + "\0suffix")
    #expect(throws: HistoryError.unavailable) { try HistoryRepository.create(at: nul, capacity: capacity()) }
    #expect(throws: HistoryError.unavailable) { try HistoryRepository.open(at: nul, capacity: capacity()) }
    #expect(!FileManager.default.fileExists(atPath: f.url.path))
    let r = try create(f)
    let usage = r.fileUsage()
    #expect((usage.databaseBytes ?? 0) > 0)
    #expect(usage.walBytes != nil && usage.sharedMemoryBytes != nil)
    #expect(try r.capacity().logicalPayloadBytes == 0)
    let attributes = try FileManager.default.attributesOfItem(atPath: f.url.path)
    #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    try r.close()
    #expect(throws: HistoryError.closed) { try r.reasons() }
    #expect(throws: HistoryError.closed) { try r.deleteReasons() }
}

@Test func reasonPagesAreBoundedAndStableIncludingDeletionTombstones() throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f)
    for n in 1...3 {
        _ = try r.prepareReason(reasonRef: id(n), commandID: id(n + 100), body: "fixture", at: instant())
    }
    let first = try r.reasons(limit: 2)
    #expect(first.count == 2 && first[0].reasonRef == id(1) && first[1].reasonRef == id(2))
    let second = try r.reasons(limit: 2, after: first[1].reasonRef)
    #expect(second.count == 1 && second[0].reasonRef == id(3))
    #expect(try r.reasons(limit: 2, after: second[0].reasonRef).isEmpty)
    #expect(throws: HistoryError.invalidPage) { try r.reasons(limit: 0) }
    #expect(throws: HistoryError.invalidPage) { try r.reasons(limit: 501) }
    try r.deleteReasons()
    #expect(try r.reasons(limit: 2).allSatisfy(\.isDeleted))
    try r.close()
}

@Test func noncanonicalLogicalIdentitiesCannotHideOrDuplicateADeletedReason() throws {
    let f = try Fixture(); defer { f.remove() }
    let r = try create(f)
    let ref = ReasonRef(UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!)
    let command = CommandID(UUID(uuidString: "BBBBBBBB-CCCC-DDDD-EEEE-FFFFFFFFFFFF")!)
    _ = try r.prepareReason(reasonRef: ref, commandID: command, body: "fixture", at: instant())
    try r.deleteReasons()
    try sql(f.url) { db in
        // Case-insensitive UNIQUE also rejects a second row with the same decoded UUID.
        #expect(sqlite3_exec(db, "INSERT INTO reasons SELECT lower(reason_ref),lower(command_id),prepared_at,x'78',1 FROM reasons", nil, nil, nil) == SQLITE_CONSTRAINT)
        execute(db, "UPDATE reasons SET reason_ref=lower(reason_ref),command_id=lower(command_id)")
    }
    #expect(throws: HistoryError.corrupt) { try r.reason(for: command) }
    #expect(throws: HistoryError.corrupt) { try r.prepareReason(reasonRef: ref, commandID: command, body: "fixture", at: instant()) }
    #expect(throws: HistoryError.corrupt) { try HistoryRepository.open(at: f.url, capacity: capacity()) }
    try r.close()
}
