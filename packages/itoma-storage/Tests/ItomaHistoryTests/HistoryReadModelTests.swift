import CSQLite
import Foundation
import ItomaCore
import ItomaStorage
import ItomaSQLite
@testable import ItomaHistory
import Testing

private func entity<K>(_ n: Int) -> EntityID<K> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private func instant(_ n: Double) throws -> Instant { try Instant(secondsSince1970: n) }
private struct ReadFixture {
    let directory: URL, url: URL
    let capacity: HistoryCapacityPolicy
    let history: HistoryRepository
    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("history.sqlite")
        capacity = try HistoryCapacityPolicy(warningBytes: 500_000, maximumBytes: 1_000_000)
        history = try HistoryRepository.create(at: url, capacity: capacity)
    }
    func remove() { try? history.close(); try? FileManager.default.removeItem(at: directory) }
    func sql(_ statement: String) throws {
        let db = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        defer { try? db.close() }
        for part in statement.split(separator: ";") { try db.execute(String(part)) }
    }
}

@Test func descendingHistoryPagesTieBreakEqualTimesWithoutDuplicates() throws {
    let f = try ReadFixture(); defer { f.remove() }
    for n in 1...42 { try f.history.recordCancellation(eventID: entity(n), at: instant(Double(n % 3))) }
    var page = try f.history.readPage(kind: .event, limit: 7), seen: [String] = []
    let revision = page.revision
    while true {
        #expect(page.rows.count <= 7)
        seen += page.rows.map(\.key)
        guard let key = page.next else { break }
        page = try f.history.readPage(kind: .event, limit: 7, after: key, expectedRevision: revision)
    }
    #expect(Set(seen).count == 42 && seen.count == 42)
    let expected = (1...42).sorted { $0 % 3 != $1 % 3 ? $0 % 3 > $1 % 3 : $0 > $1 }
        .map { (entity($0) as EventID).rawValue.uuidString }
    #expect(seen == expected)
    let first = try f.history.readPage(kind: .event, limit: 7)
    let older = try f.history.readPage(kind: .event, limit: 7, after: first.next, expectedRevision: first.revision)
    let restored = try f.history.readPage(kind: .event, limit: 7, before: older.previous, expectedRevision: first.revision)
    #expect(restored.rows.map(\.key) == first.rows.map(\.key))
    #expect(restored.previous == nil)
}

@Test func fractionalTimesAndHalfOpenDayRangeDoNotRoundIntoAnotherDay() throws {
    let f = try ReadFixture(); defer { f.remove() }
    for (n, seconds) in [1: 9.999999, 2: 10.123456789, 3: 19.999999, 4: 20.0] {
        try f.history.recordCancellation(eventID: entity(n), at: instant(seconds))
    }
    let page = try f.history.readPage(kind: .event, from: instant(10), until: instant(20))
    #expect(page.rows.map(\.occurredAt.secondsSince1970) == [19.999999, 10.123456789])
    #expect(throws: HistoryError.invalidPage) { try f.history.readPage(kind: .event, limit: 41) }
    #expect(throws: HistoryError.invalidPage) { try f.history.readPage(kind: .event, from: instant(20), until: instant(10)) }
}

@Test func reasonMetadataStaysSeparateAndDeletionInvalidatesOldPageRevision() throws {
    let f = try ReadFixture(); defer { f.remove() }
    _ = try f.history.prepareReason(reasonRef: entity(1), commandID: entity(1), body: "架空の理由\n\0exact", at: instant(10))
    let before = try f.history.readPage(kind: .reason)
    #expect(before.rows.count == 1 && before.rows[0].record == nil && before.rows[0].reasonDeleted == false)
    #expect(try f.history.reason(for: entity(1))?.body == "架空の理由\n\0exact")
    try f.history.deleteReasons()
    #expect(throws: HistoryError.conflict) { try f.history.readPage(kind: .reason, expectedRevision: before.revision) }
    #expect(throws: HistoryError.conflict) { try f.history.readReason(for: entity(1), expectedRevision: before.revision) }
    let after = try f.history.readPage(kind: .reason)
    #expect(after.rows[0].reasonDeleted == true && after.capacity.logicalPayloadBytes == 0)
    #expect(try f.history.reason(for: entity(1))?.body == nil)
    #expect(throws: HistoryError.deleted) { try f.history.prepareReason(reasonRef: entity(1), commandID: entity(1), body: "架空の理由\n\0exact", at: instant(10)) }
}

@Test func idempotentCancellationDoesNotInvalidatePaginationButNewRecordsDo() throws {
    let f = try ReadFixture(); defer { f.remove() }
    try f.history.recordCancellation(eventID: entity(1), at: instant(10))
    let revision = try f.history.readPage(kind: .event).revision
    try f.history.recordCancellation(eventID: entity(1), at: instant(10))
    #expect(try f.history.readPage(kind: .event).revision == revision)
    try f.history.recordCancellation(eventID: entity(2), at: instant(5))
    #expect(throws: HistoryError.conflict) { try f.history.readPage(kind: .event, expectedRevision: revision) }
}

@Test func schemaTwoMigrationRetainsReasonsCancelledEventsAndExactTimes() throws {
    let f = try ReadFixture(); defer { f.remove() }
    _ = try f.history.prepareReason(reasonRef: entity(1), commandID: entity(1), body: "migration fixture", at: instant(10.123456789))
    try f.history.recordCancellation(eventID: entity(2), at: instant(9.999999))
    let used = try f.history.capacity().logicalPayloadBytes
    try f.history.close()
    try f.sql("DROP TABLE reflection_facts; DROP TABLE reflection_sources; DROP TABLE reflection_state; DROP TABLE history_read_index; DROP TABLE history_read_state")
    try f.sql("PRAGMA user_version=2")
    #expect(throws: HistoryError.unsupportedSchema(2)) { try HistoryRepository.open(at: f.url, capacity: f.capacity) }
    let migrated = try HistoryRepository.migrate(at: f.url, capacity: f.capacity)
    defer { try? migrated.close() }
    #expect(try migrated.reason(for: entity(1))?.body == "migration fixture")
    #expect(try migrated.readPage(kind: .reason).rows[0].occurredAt == instant(10.123456789))
    #expect(try migrated.readPage(kind: .event).rows[0].occurredAt == instant(9.999999))
    #expect(try migrated.capacity().logicalPayloadBytes == used)
}

@Test func failedReadIndexBackfillRollsBackSchemaAndLeavesOldBytesUntouched() throws {
    let f = try ReadFixture(); defer { f.remove() }
    try f.history.recordCancellation(eventID: entity(1), at: instant(10))
    try f.history.close()
    try f.sql("DROP TABLE reflection_facts; DROP TABLE reflection_sources; DROP TABLE reflection_state; DROP TABLE history_read_index; DROP TABLE history_read_state")
    try f.sql("PRAGMA user_version=2")
    try f.sql("UPDATE history_events SET record=x'7b',payload_bytes=1")
    #expect(throws: HistoryError.corrupt) { try HistoryRepository.migrate(at: f.url, capacity: f.capacity) }
    let db = try SQLiteDatabase(path: f.url.path, busyTimeoutMilliseconds: 100); defer { try? db.close() }
    #expect(try db.rows("PRAGMA user_version") == [[.integer(2)]])
    #expect(try db.rows("SELECT name FROM sqlite_master WHERE name='history_read_index'").isEmpty)
    #expect(try db.rows("SELECT record FROM history_events") == [[.blob(Data([0x7b]))]])
}

@Test func sqliteRealRoundTripsWithoutLosingInstantPrecisionAndRejectsNonfiniteBindings() throws {
    let f = try ReadFixture(); defer { f.remove() }
    let db = try SQLiteDatabase(path: f.url.path, busyTimeoutMilliseconds: 100); defer { try? db.close() }
    let timestamp = 1_793_000_000.1234567
    #expect(try db.rows("SELECT ?", [.real(timestamp)]) == [[.real(timestamp)]])
    #expect(throws: SQLiteFailure.invalidArgument) { try db.rows("SELECT ?", [.real(.infinity)]) }
}

@Test func historyDayFiltersRespectDSTAndRejectNormalizedInvalidDates() throws {
    let zone = try #require(TimeZone(identifier: "America/New_York"))
    let short = try HistoryDayRange(day: "2026-03-08", timeZone: zone)
    let long = try HistoryDayRange(day: "2026-11-01", timeZone: zone)
    #expect(short.end.secondsSince1970 - short.start.secondsSince1970 == 23 * 3600)
    #expect(long.end.secondsSince1970 - long.start.secondsSince1970 == 25 * 3600)
    #expect(throws: HistoryError.invalidPage) { try HistoryDayRange(day: "2026-02-30", timeZone: zone) }
    #expect(throws: HistoryError.invalidPage) { try HistoryDayRange(day: "2026-1-01", timeZone: zone) }
}
