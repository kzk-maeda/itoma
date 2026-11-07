import CSQLiteTest
import Foundation
import ItomaCore
import ItomaStorage
@testable import ItomaControl
import Testing

private func id<Kind>(_ n: Int) -> EntityID<Kind> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private func sql(_ url: URL, _ text: String) throws -> Int32 {
    var handle: OpaquePointer?
    guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let db = handle else { throw CommandServiceError.invalidState }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 1)
    return sqlite3_exec(db, text, nil, nil, nil)
}
@ItomaControlActor private func confirmedGrant(_ f: Fixture) async throws -> TemporaryGrant {
    let grant = try f.accept()
    _ = try await f.service.executeAcceptedGrant(commandID: grant.commandID)
    return grant
}

@Test @ItomaControlActor func stopIntentAndApplyingAreDurableBeforeClearingAndBeforeLockFreeCleanup() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    f.restriction.hook = { plan in
        let other = try ControlRepository.open(at: f.url); defer { try? other.close() }
        let snapshot = try other.readSnapshot()
        #expect(snapshot.activation == .paused && snapshot.activationCommandID == id(100))
        #expect(snapshot.application?.observation.status == .applying)
        #expect(try other.command(id(100))?.status == .applying)
        #expect(try other.grant(grant.id)?.hasEnded == true)
        #expect(plan.desiredTargets.isEmpty && f.scheduler.cancellations.isEmpty)
    }
    f.scheduler.cancelHook = { _ async throws in
        #expect(try f.repository.command(id(100))?.status == .succeeded)
        #expect(try sql(f.url, "BEGIN IMMEDIATE; ROLLBACK") == SQLITE_OK)
        let duplicate = try await f.service.stop(commandID: id(100))
        #expect(duplicate.disposition == .inProgress)
    }
    let result = try await f.service.stop(commandID: id(100))
    #expect(result.disposition == .committed && result.failure == nil)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(f.scheduler.requests.count == 1 && f.scheduler.cancellations.count == 1)
}

@Test(arguments: [AuthorizationStatus.unknown, .denied]) @ItomaControlActor
func explicitStopDoesNotNeedApprovedAuthorization(_ authorization: AuthorizationStatus) async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    f.contexts.authorization = authorization
    let result = try await f.service.stop(commandID: id(100))
    #expect(result.failure == nil && result.disposition == .committed)
    #expect(try f.repository.readSnapshot().activation == .paused)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
}

@Test @ItomaControlActor func failedStopPreservesPausedIntentAndProtectionAndExplicitRetryOnlyReappliesTheCurrentPlan() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    f.restriction.response = .failed(.osOperationFailure)
    let failed = try await f.service.stop(commandID: id(100))
    #expect(failed.disposition == .uncertain && failed.failure == .osOperationFailure)
    #expect(try f.repository.readSnapshot().activation == .paused)
    #expect(try f.repository.command(id(100))?.status == .uncertain)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(f.scheduler.cancellations.isEmpty)
    let count = f.restriction.plans.count
    let duplicate = try await f.service.stop(commandID: id(100))
    #expect(duplicate.disposition == .requiresExplicitRetry && f.restriction.plans.count == count)
    f.restriction.response = .accepted(.writeAttempt)
    let retried = try await f.service.retryActivation(commandID: id(100))
    #expect(retried.failure == nil)
    #expect(try f.repository.command(id(100))?.attempt.rawValue == 1)
    #expect(try f.repository.command(id(100))?.status == .succeeded)
    #expect(f.scheduler.requests.count == 1 && f.scheduler.cancellations.count == 1)
}

@Test @ItomaControlActor func explicitResumeAppliesBaselineWithoutRevivingGrantsAndOldStopIsOnlyADuplicate() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    _ = try await f.service.stop(commandID: id(100))
    let result = try await f.service.resume(commandID: id(101))
    #expect(result.failure == nil && result.disposition == .committed)
    #expect(try f.repository.readSnapshot().activation == .enabled)
    #expect(try f.repository.readSnapshot().activationCommandID == id(101))
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    let count = f.restriction.plans.count
    _ = try await f.service.stop(commandID: id(100))
    _ = try await f.service.resume(commandID: id(101))
    #expect(try f.repository.readSnapshot().activation == .enabled)
    #expect(f.restriction.plans.count == count)
}

@Test(arguments: [AuthorizationStatus.unknown, .denied]) @ItomaControlActor
func resumeWithoutApprovalCreatesNoCommandAndNeverEnables(_ authorization: AuthorizationStatus) async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await f.service.stop(commandID: id(100))
    let count = f.restriction.plans.count
    f.contexts.authorization = authorization
    do {
        _ = try await f.service.resume(commandID: id(101))
        Issue.record("Unapproved resume unexpectedly accepted")
    } catch { #expect(error as? CommandServiceError == .authorizationRequired) }
    #expect(try f.repository.command(id(101)) == nil)
    #expect(try f.repository.readSnapshot().activation == .paused)
    #expect(f.restriction.plans.count == count)
}

@Test @ItomaControlActor func anOldPendingStopCannotClearAfterANewerExplicitResume() async throws {
    let f = try Fixture(); defer { f.remove() }
    try f.service.acceptActivationRequest(commandID: id(100), kind: .stop)
    try f.service.acceptActivationRequest(commandID: id(101), kind: .resumeAfterAuthorization)
    _ = try await f.service.executeAcceptedActivation(commandID: id(100))
    #expect(try f.repository.command(id(100))?.status == .superseded)
    #expect(f.restriction.plans.isEmpty)
    _ = try await f.service.executeAcceptedActivation(commandID: id(101))
    #expect(try f.repository.command(id(101))?.status == .succeeded)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
}

@Test @ItomaControlActor func anOlderResumeMarkerCannotApplyAfterANewerStopIntent() async throws {
    let f = try Fixture(); defer { f.remove() }
    try f.service.acceptActivationRequest(commandID: id(100), kind: .stop)
    try f.service.acceptActivationRequest(commandID: id(101), kind: .resumeAfterAuthorization)
    let stored = try f.repository.command(id(101)), resume = try #require(stored)
    let start = try f.service.beginReconciliation(recoverInterruptedCommands: false, action: resume)
    guard case let .ready(frame) = start else { Issue.record("Expected Applying"); return }
    try f.service.acceptActivationRequest(commandID: id(102), kind: .stop)
    _ = try f.service.finalizeReconciliation(frame)
    #expect(f.restriction.plans.isEmpty)
    #expect(try f.repository.command(id(101))?.status == .superseded)
    #expect(try f.repository.readSnapshot().activation == .paused)
    _ = try await f.service.executeAcceptedActivation(commandID: id(102))
    #expect(try f.repository.command(id(102))?.status == .succeeded)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
}

@Test @ItomaControlActor func interruptedStopRetainsIntentAndDoesNotAutomaticallyRetryTheCommand() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    #expect(try sql(f.url, "CREATE TRIGGER result_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applying\"')=0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    let failed = try await f.service.stop(commandID: id(100))
    #expect(failed.disposition == .uncertain)
    #expect(try f.repository.readSnapshot().activation == .paused)
    #expect(try f.repository.command(id(100))?.status == .applying)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(f.scheduler.cancellations.isEmpty)
    #expect(try sql(f.url, "DROP TRIGGER result_failure") == SQLITE_OK)
    _ = await f.service.reconcile(recoverInterruptedCommands: true)
    #expect(try f.repository.command(id(100))?.status == .uncertain)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
    _ = try await f.service.retryActivation(commandID: id(100))
    #expect(try f.repository.command(id(100))?.status == .succeeded)
    #expect(f.scheduler.requests.count == 1)
}

@Test @ItomaControlActor func retryingAnOlderFailedStopCannotOverrideANewerResume() async throws {
    let f = try Fixture(); defer { f.remove() }
    f.restriction.response = .failed(.osOperationFailure)
    _ = try await f.service.stop(commandID: id(100))
    f.restriction.response = .accepted(.writeAttempt)
    _ = try await f.service.resume(commandID: id(101))
    let count = f.restriction.plans.count
    _ = try await f.service.retryActivation(commandID: id(100))
    #expect(try f.repository.command(id(100))?.status == .superseded)
    #expect(try f.repository.readSnapshot().activation == .enabled)
    #expect(try f.repository.readSnapshot().activationCommandID == id(101))
    #expect(f.restriction.plans.count == count)
}

@Test @ItomaControlActor func anOldActionAttemptCannotOverwriteANewerAttemptsAppliedResult() async throws {
    let f = try Fixture(); defer { f.remove() }
    try f.service.acceptActivationRequest(commandID: id(100), kind: .stop)
    let stored = try f.repository.command(id(100)), stop = try #require(stored)
    let start = try f.service.beginReconciliation(recoverInterruptedCommands: false, action: stop)
    guard case let .ready(frame) = start, let applying = frame.action else { Issue.record("Expected owned Applying"); return }
    _ = try f.repository.write { try $0.recordCommand(f.service.changing(applying, status: .uncertain), expected: applying) }
    _ = try await f.service.retryActivation(commandID: id(100))
    let current = try f.repository.readSnapshot().application, count = f.restriction.plans.count
    let old = try f.service.finalizeReconciliation(frame)
    #expect(old.result.disposition == .requiresRecovery)
    #expect(try f.repository.command(id(100))?.attempt.rawValue == 1)
    #expect(try f.repository.command(id(100))?.status == .succeeded)
    #expect(try f.repository.readSnapshot().application == current)
    #expect(f.restriction.plans.count == count)
}

@Test @ItomaControlActor func denialDuringResumeRequiresFreshUserConfirmationEvenAfterApprovalReturns() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    _ = try await f.service.stop(commandID: id(100))
    f.restriction.hook = { _ in f.contexts.authorization = .denied }
    let denied = try await f.service.resume(commandID: id(101))
    #expect(denied.disposition == .uncertain && denied.failure == .authorizationRequired)
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    f.restriction.hook = nil; f.contexts.authorization = .approved
    _ = await f.service.reconcile()
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
    _ = try await f.service.resume(commandID: id(102))
    #expect(try f.repository.readSnapshot().activation == .enabled)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
}

@Test @ItomaControlActor func historyCapacityCannotBlockAnExplicitStop() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await confirmedGrant(f)
    let service = try CommandService(repository: f.repository, scheduler: f.scheduler, restriction: f.restriction,
        contexts: f.contexts, historyCapacity: HistoryOutboxCapacity(maximumPendingEvents: 1), identifiers: f.identifiers)
    let result = try await service.stop(commandID: id(100))
    #expect(result.failure == nil && result.disposition == .committed)
    #expect(try f.repository.historyBoundary().historyIncomplete)
    #expect(try f.repository.command(id(100))?.status == .succeeded)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
}
