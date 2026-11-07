import CSQLite
import Foundation
import ItomaCore
import ItomaStorage
import Testing

private struct Fixture {
    let directory: URL
    let url: URL
    let repository: ControlRepository
    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("control.sqlite")
        repository = try ControlRepository.create(at: url, initialPolicy: policy(0), activation: .paused)
    }
    func remove() { try? repository.close(); try? FileManager.default.removeItem(at: directory) }
}

private func id(_ number: Int) -> CommandID {
    CommandID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!)
}
private func policy(_ revision: Int64, duration: Int = 5) throws -> PolicySnapshot {
    try PolicySnapshot(revision: PolicyRevision(revision), rules: [], priorityOrder: [], defaultUnlockDuration: UnlockDuration(minutes: duration))
}
private func candidate(_ number: Int = 1, duration: Int = 10) throws -> PolicyCandidate {
    try PolicyCandidate(commandID: id(number), expectedRevision: PolicyRevision(0), proposedPolicy: policy(1, duration: duration))
}
private func command(_ number: Int = 1, status: CommandStatus = .pending, attempt: Int64 = 0) throws -> Command {
    try Command(id: id(number), kind: .commitPolicy, status: status, expectedPolicyRevision: PolicyRevision(0),
                candidatePolicyRevision: PolicyRevision(1), attempt: AttemptNumber(attempt))
}
private func accept(_ f: Fixture, number: Int = 1, sequence: Int64 = 0, duration: Int = 10) throws -> CommandAcceptance {
    try f.repository.write { try $0.acceptCandidate(command: command(number), candidate: candidate(number, duration: duration),
                                                     expectedSequence: SnapshotSequence(sequence)) }
}
private func sql<T>(_ url: URL, _ body: (OpaquePointer) throws -> T) throws -> T {
    var connection: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &connection, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(connection); defer { sqlite3_close(db) }
    return try body(db)
}
private func execute(_ db: OpaquePointer, _ text: String) throws {
    #expect(sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK)
}
private func scalar(_ db: OpaquePointer, _ text: String) throws -> Int64 {
    var statement: OpaquePointer?
    #expect(sqlite3_prepare_v2(db, text, -1, &statement, nil) == SQLITE_OK)
    let prepared = try #require(statement); defer { sqlite3_finalize(prepared) }
    #expect(sqlite3_step(prepared) == SQLITE_ROW)
    return sqlite3_column_int64(prepared, 0)
}
private enum InjectedFailure: Error { case beforeCommit }

@Test func pendingCandidateIsDurableAndDoesNotActivatePolicy() throws {
    let f = try Fixture(); defer { f.remove() }
    let result = try accept(f)
    #expect(!result.alreadyAccepted && result.command.status == .pending)
    #expect(result.snapshot.policy.revision.rawValue == 0 && result.snapshot.snapshotSequence.rawValue == 1)
    try f.repository.close()
    let reopened = try ControlRepository.open(at: f.url)
    #expect(try reopened.command(id(1)) == command())
    #expect(try reopened.candidate(commandID: id(1)) == candidate())
    #expect(try reopened.attempts(commandID: id(1)) == [command()])
    try reopened.close()
}

@Test func repeatedCommandUsesStructuralPayloadEqualityAndRejectsDifferentIntent() throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try accept(f)
    let repeated = try accept(f) // stale original sequence is fine for the same cached command
    #expect(repeated.alreadyAccepted && repeated.snapshot.snapshotSequence.rawValue == 1)
    #expect(throws: StorageError.conflict) { try accept(f, duration: 11) }
    #expect(try f.repository.readSnapshot().snapshotSequence.rawValue == 1)
}

@Test func finalCASActivatesOnlyOneCompetingCandidateAndKeepsLastValidPolicy() throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try accept(f)
    _ = try accept(f, number: 2, sequence: 1, duration: 11)
    try f.repository.write {
        _ = try $0.recordCommand(command(status: .applying), expected: command())
        _ = try $0.activateCandidate(commandID: id(1), expectedSequence: $0.snapshot().snapshotSequence)
        _ = try $0.recordCommand(command(status: .succeeded), expected: command(status: .applying))
    }
    let committed = try f.repository.readSnapshot()
    #expect(committed.policy.defaultUnlockDuration.minutes == 10 && committed.lastValidPolicy.revision.rawValue == 0)
    #expect(throws: StorageError.conflict) {
        try f.repository.write {
            _ = try $0.recordCommand(command(2, status: .applying), expected: command(2))
            _ = try $0.activateCandidate(commandID: id(2), expectedSequence: $0.snapshot().snapshotSequence)
        }
    }
    #expect(try f.repository.readSnapshot() == committed)
    #expect(try f.repository.command(id(2))?.status == .pending) // failed final TX rolls back attempt changes too
    #expect(try accept(f).alreadyAccepted) // original completed command still returns the same result
}

@Test func interruptedFinalTransactionKeepsPendingIntentAndOldPolicy() throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try accept(f)
    _ = try f.repository.write { try $0.recordCommand(command(status: .applying), expected: command()) }
    let before = try f.repository.readSnapshot()
    #expect(throws: InjectedFailure.beforeCommit) {
        try f.repository.write {
            _ = try $0.activateCandidate(commandID: id(1), expectedSequence: before.snapshotSequence)
            throw InjectedFailure.beforeCommit
        }
    }
    #expect(try f.repository.readSnapshot() == before)
    #expect(try f.repository.command(id(1))?.status == .applying)
    #expect(try f.repository.candidate(commandID: id(1)) != nil)
}

@Test func retryHasANewAttemptButKeepsTheSameCommandAndPayload() throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try accept(f)
    _ = try f.repository.write { try $0.recordCommand(command(status: .failed), expected: command()) }
    for status in [CommandStatus.pending, .scheduling, .applying] {
        #expect(throws: StorageError.invalidCommand) {
            try f.repository.write { try $0.recordCommand(command(status: status), expected: command(status: .failed)) }
        }
    }
    let retried = try command(attempt: 1)
    _ = try f.repository.write { try $0.recordCommand(retried, expected: command(status: .failed)) }
    #expect(try f.repository.attempts(commandID: id(1)) == [command(status: .failed), retried])
    #expect(try accept(f).command == retried)
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.recordCommand(command(status: .applying), expected: command()) }
    }
}

@Test(arguments: [CommandStatus.cancelled, .superseded])
func cancelledCandidateCannotBeActivatedOrReturnedToAnInflightState(status: CommandStatus) throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try accept(f)
    _ = try f.repository.write { try $0.recordCommand(command(status: status), expected: command()) }
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.recordCommand(command(status: .applying), expected: command(status: status)) }
    }
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.activateCandidate(commandID: id(1), expectedSequence: $0.snapshot().snapshotSequence) }
    }
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
}

@Test func transactionObjectsExpireAndNestedTransactionsFailInsteadOfDeadlocking() throws {
    let f = try Fixture(); defer { f.remove() }
    let escaped = try f.repository.write { transaction in
        #expect(throws: StorageError.nestedTransaction) { try f.repository.readSnapshot() }
        #expect(throws: StorageError.busy) { try f.repository.close() }
        let snapshot = try transaction.snapshot()
        #expect(snapshot.policy.revision.rawValue == 0)
        return transaction
    }
    #expect(throws: StorageError.transactionExpired) { try escaped.snapshot() }
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
}

@Test func schemaOneMigrationIsExplicitAndPreservesSnapshot() throws {
    let f = try Fixture(); defer { f.remove() }
    let before = try f.repository.readSnapshot()
    try f.repository.close()
    try sql(f.url) { try execute($0, "DROP TABLE registrations; DROP TABLE command_grant_results; DROP TABLE grants; DROP TABLE policy_candidates; DROP TABLE command_attempts; DROP TABLE commands; PRAGMA user_version=1") }
    #expect(throws: StorageError.unsupportedSchema(1)) { try ControlRepository.open(at: f.url) }
    let migrated = try ControlRepository.migrate(at: f.url)
    #expect(try migrated.readSnapshot() == before)
    #expect(try migrated.command(id(1)) == nil)
    try migrated.close()
    let reopened = try ControlRepository.open(at: f.url)
    #expect(try reopened.readSnapshot() == before)
    try reopened.close()
}

@Test func failedMigrationRollsBackDDLAndVersionInsteadOfClearingData() throws {
    let f = try Fixture(); defer { f.remove() }
    try f.repository.close()
    try sql(f.url) { try execute($0, "DROP TABLE registrations; DROP TABLE command_grant_results; DROP TABLE grants; DROP TABLE policy_candidates; DROP TABLE command_attempts; DROP TABLE commands; CREATE TABLE command_attempts(unexpected TEXT); PRAGMA user_version=1") }
    #expect(throws: StorageError.databaseFailure) { try ControlRepository.migrate(at: f.url) }
    try sql(f.url) {
        let version = try scalar($0, "PRAGMA user_version")
        let count = try scalar($0, "SELECT COUNT(*) FROM sqlite_master WHERE name='commands'")
        let revision = try scalar($0, "SELECT policy_revision FROM control_state")
        #expect(version == 1 && count == 0 && revision == 0)
    }
}

@Test func caughtCounterOverflowCannotCommitAPartiallyAcceptedCommand() throws {
    let f = try Fixture(); defer { f.remove() }
    try sql(f.url) { try execute($0, "UPDATE control_state SET snapshot_sequence=9223372036854775807") }
    var caught: ModelError?
    #expect(throws: StorageError.rollbackRequired) {
        try f.repository.write { transaction in
            do { _ = try transaction.acceptCandidate(command: command(), candidate: candidate(), expectedSequence: SnapshotSequence(Int64.max)) }
            catch { caught = error as? ModelError }
        }
    }
    #expect(caught == .counterOverflow)
    #expect(try f.repository.command(id(1)) == nil)
    #expect(try f.repository.candidate(commandID: id(1)) == nil)
    #expect(try f.repository.attempts(commandID: id(1)).isEmpty)
    #expect(try f.repository.readSnapshot().snapshotSequence.rawValue == Int64.max)
}

@Test func caughtCounterOverflowCannotCommitAPartialAttemptUpdate() throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try accept(f)
    try sql(f.url) { try execute($0, "UPDATE control_state SET snapshot_sequence=9223372036854775807") }
    var caught: ModelError?
    #expect(throws: StorageError.rollbackRequired) {
        try f.repository.write { transaction in
            do { _ = try transaction.recordCommand(command(status: .applying), expected: command()) }
            catch { caught = error as? ModelError }
        }
    }
    #expect(caught == .counterOverflow)
    #expect(try f.repository.command(id(1)) == command())
    #expect(try f.repository.attempts(commandID: id(1)) == [command()])
}

@Test func missingCandidateOrCommandTableIsCorruptionNotAnEmptyCommandResult() throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try accept(f)
    try sql(f.url) { try execute($0, "DELETE FROM policy_candidates") }
    #expect(throws: StorageError.corrupt) { try f.repository.candidate(commandID: id(1)) }
    #expect(throws: StorageError.corrupt) { try accept(f) }
    try f.repository.close()
    try sql(f.url) { try execute($0, "DROP TABLE command_attempts") }
    #expect(throws: StorageError.corrupt) { try ControlRepository.open(at: f.url) }
}
