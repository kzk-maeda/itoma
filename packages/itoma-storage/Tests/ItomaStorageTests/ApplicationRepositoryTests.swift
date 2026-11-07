import CSQLite
import Foundation
import ItomaCore
import ItomaStorage
import Testing

@Test func applicationObservationRoundTripsAndSchemaFourMigrationPreservesUnknownEvidence() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("control.sqlite")
    let repository = try ControlRepository.create(at: url, initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [], priorityOrder: []), activation: .paused)
    let now = try Instant(secondsSince1970: 100), until = try Instant(secondsSince1970: 200)
    let id = EvaluationID(UUID())
    let evaluation = try Evaluation(id: id, policyRevision: PolicyRevision(0), snapshotSequence: SnapshotSequence(0), evaluatedAt: now, timeZone: TimeZoneID("UTC"), nextBoundary: until, desiredTargets: [])
    let observation = try ApplicationObservation(evaluationID: id, status: .applied, evidence: .writeAttempt, observedAt: now, validUntil: until, error: nil)
    let application = try StoredApplication(evaluation: evaluation, observation: observation)
    let stored = try repository.write { try $0.recordApplication(application, expectedSequence: SnapshotSequence(0)) }
    #expect(stored.application == application)
    #expect(throws: StorageError.conflict) { try repository.write { try $0.recordApplication(application, expectedSequence: SnapshotSequence(0)) } }
    try repository.close()
    let reopened = try ControlRepository.open(at: url)
    #expect(try reopened.readSnapshot().application == application)
    try reopened.close()
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(handle)
    #expect(sqlite3_exec(db, "DROP TABLE activation_state; DROP TABLE application_state; PRAGMA user_version=4", nil, nil, nil) == SQLITE_OK)
    sqlite3_close(db)
    #expect(throws: StorageError.unsupportedSchema(4)) { try ControlRepository.open(at: url) }
    let migrated = try ControlRepository.migrate(at: url)
    #expect(try migrated.readSnapshot().application == nil) // never invent evidence during migration
    #expect(try migrated.readSnapshot().policy == stored.policy)
    try migrated.close()
}

@Test func applicationEvidenceRequiresMatchingIdentityAndABoundedUnexpiredAppliedWindow() throws {
    let now = try Instant(secondsSince1970: 100), until = try Instant(secondsSince1970: 200)
    let id = EvaluationID(UUID())
    let evaluation = try Evaluation(id: id, policyRevision: PolicyRevision(0), snapshotSequence: SnapshotSequence(0), evaluatedAt: now, timeZone: TimeZoneID("UTC"), nextBoundary: until, desiredTargets: [])
    let expired = try ApplicationObservation(evaluationID: id, status: .applied, evidence: .writeAttempt, observedAt: until, validUntil: until, error: nil)
    #expect(throws: StorageError.conflict) { try StoredApplication(evaluation: evaluation, observation: expired) }
    let other = try ApplicationObservation(evaluationID: EvaluationID(UUID()), status: .applied, evidence: .writeAttempt, observedAt: now, validUntil: until, error: nil)
    #expect(throws: StorageError.conflict) { try StoredApplication(evaluation: evaluation, observation: other) }
}
