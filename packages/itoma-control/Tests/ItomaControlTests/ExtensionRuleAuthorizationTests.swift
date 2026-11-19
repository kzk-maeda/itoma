import CSQLiteTest
import Foundation
import ItomaCore
import ItomaStorage
@testable import ItomaControl
import Testing

private func id<Kind>(_ n: Int) -> EntityID<Kind> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private func instant(_ n: Double) throws -> Instant { try Instant(secondsSince1970: n) }

@ItomaControlActor private func extensionService(_ f: Fixture, repository: ControlRepository? = nil) throws -> CommandService {
    try CommandService(repository: repository ?? f.repository, scheduler: f.scheduler, restriction: f.restriction,
        contexts: f.contexts, historyCapacity: HistoryOutboxCapacity(maximumPendingEvents: 100),
        identifiers: f.identifiers, origin: .activityExtension)
}
@ItomaControlActor private func confirmHost(_ f: Fixture) async throws {
    try f.repository.installRuleExecutionAuthorization()
    let result = await f.service.reconcile()
    #expect(result.failure == nil)
}

@Test @ItomaControlActor func unknownExtensionExecutesCurrentRuleStartAndEndAfterHostConfirmationAndReopen() async throws {
    let f = try Fixture(); defer { f.remove() }
    f.contexts.now = try instant(8 * 3600)
    try await confirmHost(f) // Schedule has not started; host store is empty.
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
    let reopened = try ControlRepository.open(at: f.url); defer { try? reopened.close() }
    let callback = try extensionService(f, repository: reopened)
    f.contexts.authorization = .unknown
    f.contexts.now = try instant(9 * 3600)
    let started = callback.reconcileSynchronously()
    #expect(started.failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(f.contexts.context(activation: .enabled).authorization.status == .unknown)
    f.contexts.now = try instant(17 * 3600)
    let ended = callback.reconcileSynchronously()
    #expect(ended.failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
}

@Test @ItomaControlActor func unknownHostAndUnconfirmedExtensionCannotWriteOrIssueConfirmation() async throws {
    let f = try Fixture(); defer { f.remove() }
    let callback = try extensionService(f)
    f.contexts.authorization = .unknown
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired) // Old installation.
    try f.repository.installRuleExecutionAuthorization()
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired) // Installed != confirmed.
    f.contexts.authorization = .approved
    #expect(callback.reconcileSynchronously().failure == nil) // Native approval still works.
    f.contexts.authorization = .unknown
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired) // Extension cannot issue proof.
    f.contexts.authorization = .approved
    try await confirmHost(f)
    f.contexts.authorization = .unknown
    let writes = f.restriction.plans.count
    #expect(await f.service.reconcile().failure == .authorizationRequired) // No host fallback.
    #expect(f.restriction.plans.count == writes)
    #expect(callback.reconcileSynchronously().failure == nil)
}

@Test @ItomaControlActor func observedDenialRevokesConfirmationAndRequiresExplicitResume() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    let callback = try extensionService(f)
    f.contexts.authorization = .denied
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired)
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
    f.contexts.authorization = .unknown
    let writes = f.restriction.plans.count
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired)
    #expect(f.restriction.plans.count == writes)
    f.contexts.authorization = .approved
    #expect(await f.service.reconcile().failure == nil)
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
    #expect(try await f.service.resume(commandID: id(900)).failure == nil)
    f.contexts.authorization = .unknown
    #expect(callback.reconcileSynchronously().failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
}

@Test @ItomaControlActor func stopWinsBetweenCallbackPreparationAndWriteAndOldProofDoesNotSurviveABA() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    let callback = try extensionService(f)
    f.contexts.authorization = .unknown
    guard case let .ready(frame) = try callback.beginReconciliation(recoverInterruptedCommands: false) else {
        Issue.record("Expected current delegated rule execution"); return
    }
    let writes = f.restriction.plans.count
    var snapshot = try f.repository.readSnapshot()
    snapshot = try f.repository.setActivation(.paused, expectedSequence: snapshot.snapshotSequence)
    _ = try f.repository.setActivation(.enabled, expectedSequence: snapshot.snapshotSequence) // Older schema6 writer.
    #expect(try callback.finalizeReconciliation(frame).result.failure != nil)
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired)
    #expect(f.restriction.plans.count == writes)
    #expect(try await f.service.stop(commandID: id(901)).failure == nil)
    #expect(callback.reconcileSynchronously().failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
}

@Test @ItomaControlActor func unknownExtensionPreservesProtectedGrantAndReblocksOnlyAtFixedDeadline() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    let grant = try f.accept()
    #expect(try await f.service.executeAcceptedGrant(commandID: grant.commandID).failure == nil)
    let registration = try #require(f.scheduler.requests.first)
    let callback = try extensionService(f)
    f.contexts.authorization = .unknown
    f.contexts.now = try instant(grant.acceptedAt.secondsSince1970 + 60)
    #expect(callback.reconcileSynchronously().failure == nil)
    #expect(try f.repository.grant(grant.id)?.grant.status == .active)
    #expect(f.restriction.plans.last?.desiredTargets == [id(2)])
    // Old/unknown callback identities cannot consume this live generation or grant an extension.
    #expect(callback.reconcileSynchronously(registrationID: id(999), generation: registration.generation).failure == nil)
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
    f.contexts.now = grant.effectiveExpiresAt
    #expect(callback.reconcileSynchronously(registrationID: registration.id, generation: registration.generation).failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(f.scheduler.requests.count == 1) // No automatic new registrations/retries.
}

@Test @ItomaControlActor func unknownExtensionCannotUseMissingReceiptOrCreateNewGrantOrResume() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    let grant = try f.accept()
    // A Pending grant without P1 receipt never becomes an exemption in a callback.
    f.contexts.authorization = .unknown
    let callback = try extensionService(f)
    #expect(callback.reconcileSynchronously().failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    let request = try GrantRequest(grantID: id(500), commandID: id(500), targetRef: id(2),
        expectedPolicyRevision: PolicyRevision(0), expectedOccurrence: grant.occurrence,
        condition: UnlockCondition.reason("synthetic"))
    let snapshot = try f.repository.readSnapshot()
    #expect(throws: GrantEvaluationError.authorizationRequired) {
        try GrantEvaluator.propose(request, policy: snapshot.policy, selections: snapshot.selections.map(\.selection),
            context: f.contexts.context(activation: snapshot.activation), existingGrants: [])
    }
    #expect(try await f.service.stop(commandID: id(902)).failure == nil)
    await #expect(throws: CommandServiceError.authorizationRequired) { try await f.service.resume(commandID: id(903)) }
    #expect(f.scheduler.requests.isEmpty)
}

@Test @ItomaControlActor func clockRollbackCannotUseFutureHostConfirmation() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    f.contexts.authorization = .unknown
    f.contexts.now = try instant(43_100)
    let writes = f.restriction.plans.count
    #expect(try extensionService(f).reconcileSynchronously().failure == .authorizationRequired)
    #expect(f.restriction.plans.count == writes)
}

@ItomaControlActor private func editedPolicy(_ f: Fixture) throws -> PolicyCandidate {
    let snapshot = try f.repository.readSnapshot()
    let policy = try PolicySnapshot(revision: snapshot.policy.revision.next(), rules: snapshot.policy.rules,
        priorityOrder: snapshot.policy.priorityOrder, defaultUnlockDuration: UnlockDuration(minutes: 10))
    let command = try Command(id: id(950), kind: .commitPolicy, status: .pending,
        expectedPolicyRevision: snapshot.policy.revision, candidatePolicyRevision: policy.revision, attempt: AttemptNumber(0))
    let candidate = try PolicyCandidate(commandID: command.id, expectedRevision: snapshot.policy.revision, proposedPolicy: policy)
    _ = try f.repository.write { try $0.acceptCandidate(command: command, candidate: candidate, expectedSequence: snapshot.snapshotSequence) }
    return candidate
}

@Test @ItomaControlActor func preparedCandidateDoesNotExecuteAndUnapprovedCommitCannotReuseOldPolicyProof() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    let candidate = try editedPolicy(f), callback = try extensionService(f)
    f.contexts.authorization = .unknown
    #expect(callback.reconcileSynchronously().failure == nil)
    #expect(f.restriction.plans.last?.policyRevision.rawValue == 0) // Pending revision1 never runs.
    #expect(try await f.service.executeAcceptedCandidate(commandID: candidate.commandID).failure == .authorizationRequired)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 1) // Settings can be saved offline.
    let writes = f.restriction.plans.count
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired)
    #expect(f.restriction.plans.count == writes)
    f.contexts.authorization = .approved
    #expect(await f.service.reconcile().failure == nil)
    f.contexts.authorization = .unknown
    #expect(callback.reconcileSynchronously().failure == nil)
    #expect(f.restriction.plans.last?.policyRevision.rawValue == 1) // Even an old wakeup uses latest state.
}

@Test @ItomaControlActor func approvedCandidateCommitConfirmsNewRevisionForTheNextColdCallback() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    let candidate = try editedPolicy(f)
    #expect(try await f.service.executeAcceptedCandidate(commandID: candidate.commandID).failure == nil)
    f.contexts.authorization = .unknown
    #expect(try extensionService(f).reconcileSynchronously().failure == nil)
    #expect(f.restriction.plans.last?.policyRevision.rawValue == 1)
}

@Test @ItomaControlActor func denialObservedDuringDelegatedWritePreventsSuccessAndLaterUnknownCannotReviveIt() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    f.contexts.authorization = .unknown
    f.restriction.hook = { _ in f.contexts.authorization = .denied }
    let callback = try extensionService(f)
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
    f.restriction.hook = nil
    f.contexts.authorization = .unknown
    let writes = f.restriction.plans.count
    #expect(callback.reconcileSynchronously().failure == .authorizationRequired)
    #expect(f.restriction.plans.count == writes)
}


@Test @ItomaControlActor func optionalAuthorityCorruptionBlocksDelegationButDoesNotBlockExplicitStop() async throws {
    let f = try Fixture(); defer { f.remove() }
    try await confirmHost(f)
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(f.url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(handle); defer { sqlite3_close(db) }
    #expect(sqlite3_exec(db, "DROP TRIGGER rule_execution_intent_changed", nil, nil, nil) == SQLITE_OK)
    f.contexts.authorization = .unknown
    let callback = try extensionService(f), writes = f.restriction.plans.count
    #expect(callback.reconcileSynchronously().failure == .storageFailure)
    #expect(f.restriction.plans.count == writes)
    #expect(try await f.service.stop(commandID: id(960)).failure == nil)
    #expect(try f.repository.readSnapshot().activation == .paused)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
}
