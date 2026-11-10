import Foundation
import Testing
import ItomaCore
import ItomaHistory
import ItomaSQLite

private let ledgerSource = UUID(uuidString: "00000000-0000-0000-0000-000000000136")!
private let ledgerScope = UUID(uuidString: "00000000-0000-0000-0000-000000000137")!
private func point(_ n: Int64, source: UUID = ledgerSource, event: UUID? = nil,
                   outcome: ReflectionObservationOutcome = .accepted) throws -> ReflectionObservation {
    try .init(eventID: event ?? UUID(uuidString: String(format: "00000000-0000-0000-0000-%012lld", n))!, sourceID: source, sequence: n,
        observedAt: Instant(secondsSince1970: 1_794_261_600 + Double(n) / 10), kind: .ownStoreObserved,
        outcome: outcome, policyRevision: 4, scopeID: ledgerScope, timeZone: "Asia/Tokyo")
}
private struct LedgerFixture {
    let directory: URL
    let url: URL
    let capacity: ReflectionLedgerCapacity
    let ledger: ReflectionObservationLedger
    init(bytes: Int64 = 100_000, count: Int = 500) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("prototype-ledger.sqlite")
        capacity = try .init(maximumPayloadBytes: bytes, maximumObservations: count)
        ledger = try ReflectionObservationLedger.create(at: url, capacity: capacity)
    }
    func remove() { try? ledger.close(); try? FileManager.default.removeItem(at: directory) }
}

@Test func reflectionLedgerPersistsPointsAndDeduplicatesWithoutAdvancingRevision() throws {
    let f = try LedgerFixture(); defer { f.remove() }
    let observation = try point(1)
    #expect(try f.ledger.append(observation) == .stored)
    let first = try f.ledger.page()
    #expect(try f.ledger.append(observation) == .duplicate)
    #expect(try f.ledger.page().revision == first.revision)
    try f.ledger.close()
    let reopened = try ReflectionObservationLedger.open(at: f.url, capacity: f.capacity); defer { try? reopened.close() }
    #expect(try reopened.page().observations == [observation])
    #expect(try reopened.page().incomplete == false)
}
@Test func reflectionLedgerConflictingIdentityOrPayloadRollsBack() throws {
    let f = try LedgerFixture(); defer { f.remove() }
    let first = try point(1); _ = try f.ledger.append(first)
    let before = try f.ledger.page()
    #expect(throws: ReflectionLedgerError.conflict) { try f.ledger.append(point(1, outcome: .unknown)) }
    #expect(throws: ReflectionLedgerError.conflict) { try f.ledger.append(point(2, event: first.eventID)) }
    #expect(try f.ledger.page().revision == before.revision)
    #expect(try f.ledger.page().observationCount == 1)
}
@Test func reflectionLedgerPagesAreBoundedAndRejectStaleRevision() throws {
    let f = try LedgerFixture(); defer { f.remove() }
    for n in 1...105 { _ = try f.ledger.append(point(Int64(n))) }
    let first = try f.ledger.page(limit: 40), cursor = try #require(first.nextCursor)
    let second = try f.ledger.page(limit: 40, after: cursor, expectedRevision: first.revision)
    #expect(first.observations.count == 40); #expect(second.observations.first?.sequence == 41)
    let last = try f.ledger.page(limit: 40, after: #require(second.nextCursor), expectedRevision: first.revision)
    #expect(last.observations.count == 25); #expect(last.nextCursor == nil)
    _ = try f.ledger.append(point(106))
    #expect(throws: ReflectionLedgerError.changed) { try f.ledger.page(after: cursor, expectedRevision: first.revision) }
    #expect(throws: ReflectionLedgerError.invalidInput) { try f.ledger.page(limit: 101) }
    #expect(throws: ReflectionLedgerError.invalidInput) { try f.ledger.page(after: -1) }
}
@Test func reflectionLedgerCapacityFailureIsDurableAndDeletionAllowsNewPoints() throws {
    let f = try LedgerFixture(count: 1); defer { f.remove() }
    _ = try f.ledger.append(point(1))
    #expect(try f.ledger.append(point(2)) == .capacityStopped)
    let full = try f.ledger.page()
    #expect(full.incomplete); #expect(full.observationCount == 1)
    #expect(try f.ledger.append(point(2)) == .capacityStopped)
    #expect(try f.ledger.page().revision == full.revision)
    try f.ledger.delete(sourceID: ledgerSource, through: 2)
    #expect(try f.ledger.page().deleted)
    #expect(try f.ledger.page().logicalPayloadBytes == 0)
    #expect(try f.ledger.append(point(1)) == .deleted)
    #expect(try f.ledger.append(point(2)) == .deleted)
    #expect(try f.ledger.append(point(3)) == .stored)
    #expect(try f.ledger.page().deleted == false)
    #expect(try f.ledger.page().incomplete)
    let bytes = try LedgerFixture(bytes: 1); defer { bytes.remove() }
    #expect(try bytes.ledger.append(point(1)) == .capacityStopped)
    #expect(try bytes.ledger.page().incomplete)
}
@Test func reflectionLedgerSourceCutoffsDoNotDeleteOtherSourcesOrResurrectOldPoints() throws {
    let f = try LedgerFixture(); defer { f.remove() }
    let other = UUID()
    _ = try f.ledger.append(point(1)); _ = try f.ledger.append(point(3))
    _ = try f.ledger.append(point(1, source: other, event: UUID()))
    #expect(try f.ledger.page().incomplete)
    try f.ledger.delete(sourceID: ledgerSource, through: 3)
    #expect(try f.ledger.append(point(2)) == .deleted)
    #expect(try f.ledger.page().observations.map(\.sourceID) == [other])
    #expect(throws: ReflectionLedgerError.invalidInput) { try f.ledger.delete(sourceID: ledgerSource, through: 4) }
    try f.ledger.close()
    let reopened = try ReflectionObservationLedger.open(at: f.url, capacity: f.capacity); defer { try? reopened.close() }
    #expect(try reopened.append(point(3)) == .deleted)
    #expect(try reopened.page().observations.count == 1)
}
@Test func reflectionLedgerRejectsCorruptPayloadAndUnknownSchemaWithoutReset() throws {
    let f = try LedgerFixture(); defer { f.remove() }
    _ = try f.ledger.append(point(1)); try f.ledger.close()
    let db = try SQLiteDatabase(path: f.url.path, busyTimeoutMilliseconds: 100)
    try db.execute("UPDATE ledger_points SET payload=x'7b',payload_bytes=1")
    try db.close()
    #expect(throws: ReflectionLedgerError.corrupt) { try ReflectionObservationLedger.open(at: f.url, capacity: f.capacity) }
    let raw = try SQLiteDatabase(path: f.url.path, busyTimeoutMilliseconds: 100)
    #expect(try raw.rows("SELECT payload FROM ledger_points") == [[.blob(Data([0x7b]))]])
    try raw.execute("PRAGMA user_version=2"); try raw.close()
    #expect(throws: ReflectionLedgerError.unsupportedSchema(2)) { try ReflectionObservationLedger.open(at: f.url, capacity: f.capacity) }
}
@Test func reflectionLedgerCreateOpenAndPointValidationAreExplicit() throws {
    let f = try LedgerFixture(); defer { f.remove() }
    #expect(throws: ReflectionLedgerError.alreadyExists) { try ReflectionObservationLedger.create(at: f.url, capacity: f.capacity) }
    #expect(throws: ReflectionLedgerError.missing) { try ReflectionObservationLedger.open(at: f.directory.appendingPathComponent("missing"), capacity: f.capacity) }
    #expect(throws: ReflectionLedgerError.invalidInput) { try ReflectionObservationLedger.create(at: URL(string: "https://example.com")!, capacity: f.capacity) }
    #expect(throws: ReflectionLedgerError.invalidInput) { try ReflectionLedgerCapacity(maximumPayloadBytes: 0, maximumObservations: 1) }
    let json = try JSONEncoder().encode(point(1))
    let text = String(data: json, encoding: .utf8)!
    #expect(!text.contains("body")); #expect(!text.contains("token")); #expect(!text.contains("applicationName"))
    var invalidObject = try #require(JSONSerialization.jsonObject(with: json) as? [String: Any])
    invalidObject["timeZone"] = "Invalid/Zone"
    let invalid = try JSONSerialization.data(withJSONObject: invalidObject)
    #expect(throws: ReflectionLedgerError.invalidInput) { try JSONDecoder().decode(ReflectionObservation.self, from: invalid) }
    try f.ledger.close()
    #expect(throws: ReflectionLedgerError.closed) { try f.ledger.page() }
}

@Test func reflectionLedgerMissingPayloadWithoutDeletionCutoffIsCorruption() throws {
    let f = try LedgerFixture(); defer { f.remove() }
    let original = try point(1); _ = try f.ledger.append(original)
    let db = try SQLiteDatabase(path: f.url.path, busyTimeoutMilliseconds: 100)
    try db.execute("DELETE FROM ledger_points"); try db.close()
    #expect(throws: ReflectionLedgerError.corrupt) { try f.ledger.page() }
    #expect(throws: ReflectionLedgerError.corrupt) { try f.ledger.append(original) }
    try f.ledger.close()
    #expect(throws: ReflectionLedgerError.corrupt) { try ReflectionObservationLedger.open(at: f.url, capacity: f.capacity) }
}
