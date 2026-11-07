import CSQLite
import Foundation
import ItomaCore
import ItomaStorage
import Testing

private struct Fixture {
    let directory: URL
    let url: URL
    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("control.sqlite")
    }
    func remove() { try? FileManager.default.removeItem(at: directory) }
}

private func id<Kind>(_ number: Int) -> EntityID<Kind> {
    EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!)
}

private func policy() throws -> PolicySnapshot {
    try PolicySnapshot(revision: PolicyRevision(7), rules: [
        Rule(id: id(1), version: RuleVersion(2), enabled: true, selectionRef: id(1),
             schedule: WeeklySchedule(weekdays: [.friday], startMinute: 1260, endMinute: 120, endDayOffset: .nextDay),
             unlockMode: .reason)
    ], priorityOrder: [id(1)])
}

private func selection(_ number: Int = 1, payload: Data = Data([0, 255, 17])) -> StoredSelection {
    StoredSelection(selection: Selection(ref: id(number), targets: [id(1), id(2)]), opaquePayload: payload)
}

private func create(_ fixture: Fixture, timeout: Int32 = 100) throws -> ControlRepository {
    try ControlRepository.create(at: fixture.url, initialPolicy: policy(), selections: [selection()],
                                  activation: .paused, busyTimeoutMilliseconds: timeout)
}

/// Test-only SQL fault injection on a separate real connection. Never real native tokens/reasons.
private func sql<T>(_ url: URL, _ body: (OpaquePointer) throws -> T) throws -> T {
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK)
    let db = try #require(handle)
    defer { sqlite3_close(db) }
    return try body(db)
}

private func execute(_ db: OpaquePointer, _ text: String) throws {
    #expect(sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK)
}

@Test func controlSnapshotRoundTripsOpaqueSelectionsAndAbsolutePolicy() throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f)
    let snapshot = try repository.readSnapshot()
    #expect(snapshot.policy == (try policy()))
    #expect(snapshot.lastValidPolicy == snapshot.policy)
    #expect(snapshot.selections == [selection()])
    #expect(snapshot.snapshotSequence.rawValue == 0 && snapshot.activation == .paused)
    try repository.close()
    let reopened = try ControlRepository.open(at: f.url)
    #expect(try reopened.readSnapshot() == snapshot)
    try reopened.close()
}

@Test func missingDatabaseDoesNotCreateAnyFiles() throws {
    let f = try Fixture(); defer { f.remove() }
    #expect(throws: StorageError.missingDatabase) { try ControlRepository.open(at: f.url) }
    #expect(!FileManager.default.fileExists(atPath: f.url.path))
}

@Test func explicitCreationNeverOverwritesAnExistingFile() throws {
    let f = try Fixture(); defer { f.remove() }
    let sentinel = Data("existing non-database recovery data".utf8)
    try sentinel.write(to: f.url)
    #expect(throws: StorageError.alreadyExists) { try create(f) }
    #expect(try Data(contentsOf: f.url) == sentinel)
    #expect(throws: StorageError.corrupt) { try ControlRepository.open(at: f.url) }
    #expect(try Data(contentsOf: f.url) == sentinel)
}

@Test(arguments: [Int64(0), 4, 77])
func unsupportedSchemaIsNotInitializedOrDowngraded(version: Int64) throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f)
    try repository.close()
    try sql(f.url) { try execute($0, "PRAGMA user_version=\(version)") }
    let original = try Data(contentsOf: f.url)
    #expect(throws: StorageError.unsupportedSchema(version)) { try ControlRepository.open(at: f.url) }
    #expect(try Data(contentsOf: f.url) == original)
}

@Test func emptyExistingFileIsNotTreatedAsNewSettings() throws {
    let f = try Fixture(); defer { f.remove() }
    try Data().write(to: f.url)
    #expect(throws: StorageError.unsupportedSchema(0)) { try ControlRepository.open(at: f.url) }
    #expect(try Data(contentsOf: f.url).isEmpty)
}

@Test func wrongApplicationIDIsRejectedWithoutErasingOtherData() throws {
    let f = try Fixture(); defer { f.remove() }
    try sql(f.url) { try execute($0, "PRAGMA user_version=3; PRAGMA application_id=123; CREATE TABLE other_data(value TEXT)") }
    let original = try Data(contentsOf: f.url)
    #expect(throws: StorageError.wrongDatabase) { try ControlRepository.open(at: f.url) }
    #expect(try Data(contentsOf: f.url) == original)
}

@Test func corruptedPolicyAndMissingSelectionAreReportedInsteadOfAnEmptySnapshot() throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f)
    try sql(f.url) { try execute($0, "UPDATE control_state SET policy=x'7b'") }
    #expect(throws: StorageError.corrupt) { try repository.readSnapshot() }
    try repository.close()
    #expect(throws: StorageError.corrupt) { try ControlRepository.open(at: f.url) }
    let second = try Fixture(); defer { second.remove() }
    let valid = try create(second)
    try sql(second.url) { try execute($0, "DELETE FROM selections") }
    #expect(throws: StorageError.corrupt) { try valid.readSnapshot() }
    try valid.close()
}

@Test func activationUsesSnapshotCASAndLeavesPolicyRevisionAlone() throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f)
    let changed = try repository.setActivation(.enabled, expectedSequence: SnapshotSequence(0))
    #expect(changed.snapshotSequence.rawValue == 1 && changed.policy.revision.rawValue == 7)
    #expect(changed.policy.rules[0].version.rawValue == 2)
    #expect(throws: StorageError.conflict) {
        try repository.setActivation(.paused, expectedSequence: SnapshotSequence(0))
    }
    #expect(try repository.readSnapshot() == changed)
    try repository.close()
}

@Test func separateConnectionsSeeCommittedStateAndBusyWritersDoNotAdvanceSequence() throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f, timeout: 1)
    try sql(f.url) { writer in
        try execute(writer, "BEGIN IMMEDIATE")
        #expect(try repository.readSnapshot().snapshotSequence.rawValue == 0) // WAL reader is available
        #expect(throws: StorageError.busy) {
            try repository.setActivation(.enabled, expectedSequence: SnapshotSequence(0))
        }
        try execute(writer, "ROLLBACK")
    }
    #expect(try repository.readSnapshot().snapshotSequence.rawValue == 0)
    _ = try repository.setActivation(.enabled, expectedSequence: SnapshotSequence(0))
    let other = try ControlRepository.open(at: f.url)
    #expect(try other.readSnapshot().activation == .enabled)
    try other.close()
    try repository.close()
}

@Test func selectionsAreOpaqueImmutableAndIdempotentAndPrepareNewReferences() throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f)
    #expect(try repository.putSelection(selection(), expectedSequence: SnapshotSequence(0)).snapshotSequence.rawValue == 0)
    #expect(throws: StorageError.conflict) {
        try repository.putSelection(selection(payload: Data([1])), expectedSequence: SnapshotSequence(0))
    }
    let updated = try repository.putSelection(selection(2, payload: Data()), expectedSequence: SnapshotSequence(0))
    #expect(updated.snapshotSequence.rawValue == 1)
    #expect(updated.selections.count == 2 && updated.selections[1].opaquePayload.isEmpty)
    #expect(updated.policy == (try policy())) // staging a new reference cannot alter current rules
    try repository.close()
}

@Test func invalidInitialSelectionsDoNotLeaveAnEmptyDatabase() throws {
    let f = try Fixture(); defer { f.remove() }
    #expect(throws: StorageError.invalidSelection) {
        try ControlRepository.create(at: f.url, initialPolicy: policy(), activation: .paused)
    }
    #expect(!FileManager.default.fileExists(atPath: f.url.path))
}

@Test func embeddedNulInAFilePathCannotOpenOrCreateItsTruncatedPrefix() throws {
    let f = try Fixture(); defer { f.remove() }
    let invalid = URL(fileURLWithPath: f.url.path + "\0suffix")
    #expect(throws: StorageError.unavailable) {
        try ControlRepository.create(at: invalid, initialPolicy: policy(), selections: [selection()], activation: .paused)
    }
    #expect(throws: StorageError.unavailable) { try ControlRepository.open(at: invalid) }
    #expect(!FileManager.default.fileExists(atPath: f.url.path))
}

@Test func closedRepositoryReturnsAnErrorAndKeepsThePersistedSnapshot() throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f)
    try repository.close()
    #expect(throws: StorageError.closed) { try repository.readSnapshot() }
    let reopened = try ControlRepository.open(at: f.url)
    #expect(try reopened.readSnapshot().policy == policy())
    try reopened.close()
}

@Test func anAlreadyOpenConnectionCannotReadOrWriteAfterAnotherConnectionChangesTheSchema() throws {
    let f = try Fixture(); defer { f.remove() }
    let repository = try create(f)
    try sql(f.url) { try execute($0, "PRAGMA user_version=4") }
    #expect(throws: StorageError.unsupportedSchema(4)) { try repository.readSnapshot() }
    #expect(throws: StorageError.unsupportedSchema(4)) {
        try repository.setActivation(.enabled, expectedSequence: SnapshotSequence(0))
    }
    #expect(throws: StorageError.unsupportedSchema(4)) {
        try repository.putSelection(selection(2), expectedSequence: SnapshotSequence(0))
    }
    try sql(f.url) { try execute($0, "PRAGMA user_version=3; PRAGMA application_id=123") }
    #expect(throws: StorageError.wrongDatabase) {
        try repository.setActivation(.enabled, expectedSequence: SnapshotSequence(0))
    }
    try sql(f.url) { try execute($0, "PRAGMA application_id=0x49544F4D") }
    let unchanged = try repository.readSnapshot()
    #expect(unchanged.snapshotSequence.rawValue == 0 && unchanged.activation == .paused)
    #expect(unchanged.selections == [selection()])
    try repository.close()
}
