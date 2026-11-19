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
        repository = try ControlRepository.create(at: url,
            initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [], priorityOrder: []), activation: .enabled)
    }
    func remove() { try? repository.close(); try? FileManager.default.removeItem(at: directory) }
}
private func context(_ status: AuthorizationStatus = .approved) throws -> EvaluationContext {
    let now = try Instant(secondsSince1970: 100)
    return try EvaluationContext(now: now, timeZone: TimeZoneID("UTC"),
        authorization: AuthorizationObservation(status: status, observedAt: now), activation: .enabled)
}
private func execute(_ url: URL, _ text: String) throws {
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(handle); defer { sqlite3_close(db) }
    #expect(sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK)
}

@Test func authorityInstallationIsExplicitIdempotentAndDoesNotChangeControlSnapshotOrBackfillApproval() throws {
    let f = try Fixture(); defer { f.remove() }
    let snapshot = try f.repository.readSnapshot(), now = try context().now
    #expect(try !f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: now) })
    try f.repository.write { try $0.confirmRuleExecution(context: context()) } // Missing installation is a no-op.
    try f.repository.installRuleExecutionAuthorization()
    try f.repository.installRuleExecutionAuthorization()
    #expect(try f.repository.readSnapshot() == snapshot)
    #expect(try !f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: now) })
    try f.repository.write { try $0.confirmRuleExecution(context: context()) }
    let reopened = try ControlRepository.open(at: f.url); defer { try? reopened.close() }
    #expect(try reopened.write { try $0.hasCurrentRuleExecutionConfirmation(at: now) })
    #expect(try reopened.readSnapshot() == snapshot)
}

@Test(arguments: [AuthorizationStatus.unknown, .denied])
func unknownOrDeniedCannotIssueAnExecutionConfirmation(_ status: AuthorizationStatus) throws {
    let f = try Fixture(); defer { f.remove() }
    try f.repository.installRuleExecutionAuthorization()
    #expect(throws: StorageError.invalidCommand) { try f.repository.write { try $0.confirmRuleExecution(context: context(status)) } }
    #expect(try !f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: context().now) })
}

@Test func oldWriterActivationABAAndSelectionMutationInvalidateProofWithoutNewControllerCode() throws {
    let f = try Fixture(); defer { f.remove() }
    try f.repository.installRuleExecutionAuthorization()
    try f.repository.write { try $0.confirmRuleExecution(context: context()) }
    try execute(f.url, "UPDATE control_state SET activation='paused'; UPDATE control_state SET activation='enabled'")
    #expect(try !f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: context().now) })
    try f.repository.write { try $0.confirmRuleExecution(context: context()) }
    // An inserted unreferenced selection does not change the current committed intent.
    _ = try f.repository.putSelection(StoredSelection(selection: Selection(ref: SelectionRef(UUID()), targets: [TargetRef(UUID())]),
        opaquePayload: Data([1])), expectedSequence: f.repository.readSnapshot().snapshotSequence)
    #expect(try f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: context().now) })
    try execute(f.url, "UPDATE selections SET opaque_payload=X'02'")
    #expect(try !f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: context().now) })
}

@Test func corruptRecordAndMissingTriggerFailClosedAndInstallationDoesNotRepairOrReapprove() throws {
    let f = try Fixture(); defer { f.remove() }
    try f.repository.installRuleExecutionAuthorization()
    try f.repository.write { try $0.confirmRuleExecution(context: context()) }
    try execute(f.url, "UPDATE rule_execution_authorization SET record=X'FF'")
    #expect(throws: StorageError.corrupt) { try f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: context().now) } }
    try execute(f.url, "DROP TRIGGER rule_execution_intent_changed")
    #expect(throws: StorageError.corrupt) { try f.repository.installRuleExecutionAuthorization() }
    #expect(throws: StorageError.corrupt) { try f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: context().now) } }
}

@Test func rolledBackConfirmationDoesNotAuthorizeAnything() throws {
    let f = try Fixture(); defer { f.remove() }
    try f.repository.installRuleExecutionAuthorization()
    #expect(throws: StorageError.conflict) {
        try f.repository.write { tx in
            try tx.confirmRuleExecution(context: context())
            throw StorageError.conflict
        }
    }
    #expect(try !f.repository.write { try $0.hasCurrentRuleExecutionConfirmation(at: context().now) })
}
