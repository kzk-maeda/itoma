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
        repository = try ControlRepository.create(at: url, initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [], priorityOrder: []), activation: .enabled)
    }
    func remove() { try? repository.close(); try? FileManager.default.removeItem(at: directory) }
}
private func command(_ kind: CommandKind, id: CommandID = CommandID(UUID())) throws -> Command {
    try Command(id: id, kind: kind, status: .pending, expectedPolicyRevision: PolicyRevision(0), attempt: AttemptNumber(0))
}
private func context(_ activation: Activation, authorization: AuthorizationStatus = .approved) throws -> EvaluationContext {
    let now = try Instant(secondsSince1970: 100)
    return try EvaluationContext(now: now, timeZone: TimeZoneID("UTC"), authorization: AuthorizationObservation(status: authorization, observedAt: now), activation: activation)
}
private func execute(_ url: URL, _ text: String) throws {
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(handle); defer { sqlite3_close(db) }
    #expect(sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK)
}

@Test func activationIntentIsDurableAndADuplicateNeverReplaysAnOlderStop() throws {
    let f = try Fixture(); defer { f.remove() }
    let stop = try command(.stop)
    let stopped = try f.repository.write { try $0.acceptActivationCommand(command: stop, context: context(.enabled, authorization: .unknown), expectedSequence: SnapshotSequence(0)) }
    #expect(stopped.snapshot.activation == .paused && stopped.snapshot.activationCommandID == stop.id)
    let resume = try command(.resumeAfterAuthorization)
    let resumed = try f.repository.write { try $0.acceptActivationCommand(command: resume, context: context(.paused), expectedSequence: stopped.snapshot.snapshotSequence) }
    #expect(resumed.snapshot.activation == .enabled && resumed.snapshot.activationCommandID == resume.id)
    let repeated = try f.repository.write { try $0.acceptActivationCommand(command: stop, context: context(.enabled), expectedSequence: SnapshotSequence(0)) }
    #expect(repeated.alreadyAccepted && repeated.snapshot == resumed.snapshot)
    try f.repository.close()
    let opened = try ControlRepository.open(at: f.url); defer { try? opened.close() }
    #expect(try opened.readSnapshot().activationCommandID == resume.id)
    #expect(try opened.command(stop.id) == stop)
}

@Test(arguments: [AuthorizationStatus.unknown, .denied])
func resumeRequiresSuppliedApprovalAndDoesNotRecordAnIntentOtherwise(_ authorization: AuthorizationStatus) throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.repository.setActivation(.paused, expectedSequence: SnapshotSequence(0))
    let snapshot = try f.repository.readSnapshot(), resume = try command(.resumeAfterAuthorization)
    #expect(throws: StorageError.invalidCommand) {
        try f.repository.write { try $0.acceptActivationCommand(command: resume, context: context(.paused, authorization: authorization), expectedSequence: snapshot.snapshotSequence) }
    }
    #expect(try f.repository.readSnapshot() == snapshot)
    #expect(try f.repository.command(resume.id) == nil)
}

@Test func activationAcceptanceRejectsConflictingIDAndStaleSequenceAtomically() throws {
    let f = try Fixture(); defer { f.remove() }
    let stop = try command(.stop)
    let stopped = try f.repository.write { try $0.acceptActivationCommand(command: stop, context: context(.enabled), expectedSequence: SnapshotSequence(0)) }
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.acceptActivationCommand(command: command(.resumeAfterAuthorization, id: stop.id), context: context(.paused), expectedSequence: stopped.snapshot.snapshotSequence) }
    }
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.acceptActivationCommand(command: command(.resumeAfterAuthorization), context: context(.paused), expectedSequence: SnapshotSequence(0)) }
    }
    #expect(try f.repository.readSnapshot() == stopped.snapshot)
}

private enum Injected: Error { case beforeCommit }
@Test func rollbackDoesNotPartiallySaveActivationOrItsCommand() throws {
    let f = try Fixture(); defer { f.remove() }
    let before = try f.repository.readSnapshot(), stop = try command(.stop)
    #expect(throws: Injected.beforeCommit) {
        try f.repository.write { tx in
            _ = try tx.acceptActivationCommand(command: stop, context: context(.enabled), expectedSequence: before.snapshotSequence)
            throw Injected.beforeCommit
        }
    }
    #expect(try f.repository.readSnapshot() == before)
    #expect(try f.repository.command(stop.id) == nil)
}

@Test func schemaFiveMigrationPreservesExistingObservationAndCreatesNoUserIntent() throws {
    let f = try Fixture(); defer { f.remove() }
    let now = try Instant(secondsSince1970: 100), until = try Instant(secondsSince1970: 200), id = EvaluationID(UUID())
    let evaluation = try Evaluation(id: id, policyRevision: PolicyRevision(0), snapshotSequence: SnapshotSequence(0), evaluatedAt: now,
        timeZone: TimeZoneID("UTC"), nextBoundary: until, desiredTargets: [])
    let observation = try ApplicationObservation(evaluationID: id, status: .applied, evidence: .writeAttempt, observedAt: now, validUntil: until, error: nil)
    let before = try f.repository.write { try $0.recordApplication(StoredApplication(evaluation: evaluation, observation: observation), expectedSequence: SnapshotSequence(0)) }
    try f.repository.close()
    try execute(f.url, "DROP TABLE activation_state; PRAGMA user_version=5")
    #expect(throws: StorageError.unsupportedSchema(5)) { try ControlRepository.open(at: f.url) }
    let migrated = try ControlRepository.migrate(at: f.url); defer { try? migrated.close() }
    #expect(try migrated.readSnapshot() == before)
    #expect(try migrated.readSnapshot().activationCommandID == nil)
}

@Test func anInvalidCurrentActivationCommandIsCorruptRatherThanAnEmptyIntent() throws {
    let f = try Fixture(); defer { f.remove() }
    try execute(f.url, "UPDATE activation_state SET command_id='00000000-0000-0000-0000-000000000001'")
    #expect(throws: StorageError.corrupt) { try f.repository.readSnapshot() }
}
