import CSQLiteTest
import Foundation
import ItomaCore
import ItomaStorage
@testable import ItomaControl
import Testing

private func id<Kind>(_ n: Int) -> EntityID<Kind> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private func instant(_ n: Double) throws -> Instant { try Instant(secondsSince1970: n) }
private func sql(_ url: URL, _ text: String) throws -> Int32 {
    var handle: OpaquePointer?
    guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let db = handle else { throw CommandServiceError.invalidState }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 1)
    return sqlite3_exec(db, text, nil, nil, nil)
}

@ItomaControlActor private func confirmedGrant(_ f: Fixture, number: Int = 1, target: Int = 1) async throws -> TemporaryGrant {
    let grant = try f.accept(number, target: target)
    let result = try await f.service.executeAcceptedGrant(commandID: id(number))
    #expect(result.failure == nil)
    return grant
}

@ItomaControlActor private func shorteningCandidate(_ f: Fixture) throws -> PolicyCandidate {
    var snapshot = try f.repository.readSnapshot()
    snapshot = try f.repository.putSelection(StoredSelection(selection: Selection(ref: id(2), targets: [id(1), id(2)]),
        opaquePayload: Data([2])), expectedSequence: snapshot.snapshotSequence)
    let high = try Rule(id: id(2), version: RuleVersion(0), enabled: true, selectionRef: id(2),
        schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 723, endMinute: 780, endDayOffset: .sameDay), unlockMode: .unavailable)
    let policy = try PolicySnapshot(revision: snapshot.policy.revision.next(), rules: snapshot.policy.rules + [high], priorityOrder: [id(2), id(1)])
    let command = try Command(id: id(100), kind: .commitPolicy, status: .pending, expectedPolicyRevision: snapshot.policy.revision,
        candidatePolicyRevision: policy.revision, attempt: AttemptNumber(0))
    let candidate = try PolicyCandidate(commandID: command.id, expectedRevision: snapshot.policy.revision, proposedPolicy: policy)
    _ = try f.repository.write { try $0.acceptCandidate(command: command, candidate: candidate, expectedSequence: snapshot.snapshotSequence) }
    return candidate
}

@Test @ItomaControlActor func deadlineReblocksAtExactExpiryAndCommitsBeforeLockFreeCleanup() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    f.contexts.now = grant.effectiveExpiresAt
    f.restriction.hook = { _ in
        let other = try ControlRepository.open(at: f.url); defer { try? other.close() }
        #expect(try other.readSnapshot().application?.observation.status == .applying)
        #expect(f.scheduler.cancellations.isEmpty)
    }
    f.scheduler.cancelHook = { _ async throws in
        #expect(try f.repository.readSnapshot().application?.observation.status == .applied)
        #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
        #expect(try sql(f.url, "BEGIN IMMEDIATE; ROLLBACK") == SQLITE_OK)
    }
    let result = await f.service.handleDeadlineCallback(registrationID: request.id, generation: request.generation)
    #expect(result.disposition == .committed && result.failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(try f.repository.registration(request.id)?.firedAt == grant.effectiveExpiresAt)
    #expect(try f.repository.registration(request.id)?.status == .obsolete)
    #expect(f.scheduler.requests.count == 1 && f.scheduler.cancellations == [request.id])
    #expect(try f.repository.grant(grant.id)?.grant.initialExpiresAt == grant.initialExpiresAt)
}

@Test @ItomaControlActor func oldAndDuplicateCallbackCannotEndANewerGrantForTheSameTarget() async throws {
    let f = try Fixture(); defer { f.remove() }
    let old = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    f.contexts.now = old.effectiveExpiresAt
    _ = await f.service.handleDeadlineCallback(registrationID: request.id, generation: request.generation)
    let newer = try await confirmedGrant(f, number: 2)
    f.contexts.now = try instant(f.contexts.now.secondsSince1970 + 1)
    _ = await f.service.handleDeadlineCallback(registrationID: request.id, generation: request.generation)
    #expect(try f.repository.registration(request.id)?.firedAt == old.effectiveExpiresAt)
    #expect(try f.repository.grant(newer.id)?.grant.status == .active)
    #expect(try f.repository.grant(newer.id)?.grant.effectiveExpiresAt == newer.effectiveExpiresAt)
    #expect(f.restriction.plans.last?.desiredTargets == [id(2)])
    #expect(f.scheduler.requests.count == 2 && f.scheduler.cancellations == [request.id])
}

@Test @ItomaControlActor func unknownOrWrongGenerationEventsOnlyEvaluateCurrentState() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    _ = await f.service.handleDeadlineCallback(registrationID: request.id, generation: try request.generation.next())
    _ = await f.service.handleDeadlineCallback(registrationID: id(99_999), generation: request.generation)
    #expect(try f.repository.registration(request.id)?.firedAt == nil)
    #expect(try f.repository.grant(grant.id)?.grant.status == .active)
    #expect(f.restriction.plans.last?.desiredTargets == [id(2)])
    #expect(f.scheduler.requests.count == 1 && f.scheduler.cancellations.isEmpty)
}

@Test @ItomaControlActor func anEarlyEffectiveCallbackConsumesProtectionAndNeverExtendsTheGrant() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    _ = await f.service.handleDeadlineCallback(registrationID: request.id, generation: request.generation)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(f.scheduler.requests.count == 1)
}

@Test @ItomaControlActor func anUnactivatedCandidateCallbackPreservesTheOldConfirmedGrantAndPolicy() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), proposal = try shorteningCandidate(f)
    let preview = try f.service.previewCandidate(commandID: proposal.commandID)
    let stored = try f.repository.command(proposal.commandID), command = try #require(stored)
    let frame = try f.service.prepareCandidate(command: command, confirmation: preview,
        context: f.contexts.context(activation: .enabled))
    let prepared = try #require(frame.registrations.first)
    let receipt = DeadlineReceipt(registrationID: prepared.id, generation: prepared.generation, scheduledFor: prepared.scheduledFor, acceptedAt: f.contexts.now)
    let registered = try DeadlineRegistration(id: prepared.id, grantID: prepared.grantID, commandID: prepared.commandID,
        generation: prepared.generation, policyRevision: prepared.policyRevision, candidatePolicyRevision: prepared.candidatePolicyRevision,
        scheduledFor: prepared.scheduledFor, status: .registered, receipt: receipt)
    _ = try f.repository.write { try $0.recordRegistration(registered, expected: prepared) }
    f.contexts.now = prepared.scheduledFor
    _ = await f.service.handleDeadlineCallback(registrationID: prepared.id, generation: prepared.generation)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    #expect(try f.repository.grant(grant.id)?.grant.status == .active)
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
    #expect(f.restriction.plans.last?.desiredTargets == [id(2)])
}

@Test @ItomaControlActor func reconciliationUsesAnActivatedCandidateReceiptEvenWhenItsStoreWriteFailed() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), proposal = try shorteningCandidate(f)
    f.restriction.response = .failed(.osOperationFailure)
    _ = try await f.service.executeAcceptedCandidate(commandID: proposal.commandID,
        confirmation: f.service.previewCandidate(commandID: proposal.commandID))
    #expect(try f.repository.command(proposal.commandID)?.status == .failed)
    #expect(try f.repository.readSnapshot().policy == proposal.proposedPolicy)
    f.restriction.response = .accepted(.ownStoreReadback)
    let result = await f.service.reconcile(recoverInterruptedCommands: true)
    #expect(result.disposition == .committed)
    #expect(try f.repository.grant(grant.id)?.grant.status == .active)
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == instant(43_380))
    #expect(try f.repository.command(proposal.commandID)?.status == .failed)
    #expect(f.restriction.plans.last?.desiredTargets == [id(2)])
    #expect(f.scheduler.requests.count == 2)
}

@Test @ItomaControlActor func missingProtectionIsReblockedAndAWriteFailureRemainsUncertainWithoutCanceling() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    try f.repository.write { tx in
        let stored = try tx.registration(request.id), current = try #require(stored)
        _ = try tx.recordRegistration(f.service.registration(current, status: .unknown), expected: current)
    }
    f.scheduler.response = .rejected(.registrationFailure)
    f.restriction.response = .failed(.osOperationFailure)
    let failed = await f.service.reconcile()
    #expect(failed.disposition == .uncertain && failed.failure == .osOperationFailure)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(f.scheduler.requests.count == 1 && f.scheduler.cancellations.isEmpty)
    f.restriction.response = .accepted(.writeAttempt)
    _ = await f.service.reconcile()
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(f.scheduler.cancellations == [request.id])
}

@Test @ItomaControlActor func interruptedApplyingRequiresExplicitRetryAndKeepsItsOriginalDeadline() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    #expect(try sql(f.url, "CREATE TRIGGER result_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applying\"')=0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    let failed = try await f.service.executeAcceptedGrant(commandID: grant.commandID)
    #expect(failed.disposition == .uncertain)
    #expect(try f.repository.command(grant.commandID)?.status == .applying)
    #expect(try f.repository.readSnapshot().application?.observation.status == .applying)
    f.restriction.hook = nil
    #expect(try sql(f.url, "DROP TRIGGER result_failure") == SQLITE_OK)
    let recovered = await f.service.reconcile(recoverInterruptedCommands: true)
    #expect(recovered.disposition == .committed)
    #expect(try f.repository.command(grant.commandID)?.status == .uncertain)
    #expect(try f.repository.grant(grant.id)?.grant.status == .uncertain)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(f.scheduler.requests.count == 1 && f.scheduler.cancellations.isEmpty)
    let notRetried = try await f.service.executeAcceptedGrant(commandID: grant.commandID)
    #expect(notRetried.disposition == .requiresExplicitRetry)
    let retried = try await f.service.retryGrant(commandID: grant.commandID)
    #expect(retried.failure == nil)
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
    #expect(try f.repository.command(grant.commandID)?.attempt.rawValue == 1)
    #expect(f.scheduler.requests.count == 2)
}

@Test @ItomaControlActor func reconciliationDuringLiveRegistrationDoesNotRecoverOrRetryThatRequest() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    f.scheduler.hook = { request async throws in
        let current = await f.service.reconcile(recoverInterruptedCommands: true)
        #expect(current.disposition == .committed)
        #expect(try f.repository.command(grant.commandID)?.status == .scheduling)
        #expect(f.scheduler.requests.count == 1)
        #expect(try f.repository.registration(request.id)?.status == .preparing)
    }
    let result = try await f.service.executeAcceptedGrant(commandID: grant.commandID)
    #expect(result.failure == nil)
    #expect(try f.repository.grant(grant.id)?.grant.status == .active)
}

@Test @ItomaControlActor func resultCommitFailureKeepsApplyingAndProtectionUntilAConfirmedReblock() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    f.contexts.now = grant.effectiveExpiresAt
    #expect(try sql(f.url, "CREATE TRIGGER result_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applying\"')=0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    let failed = await f.service.handleDeadlineCallback(registrationID: request.id, generation: request.generation)
    #expect(failed.disposition == .uncertain)
    #expect(f.scheduler.cancellations.isEmpty)
    #expect(try f.repository.registration(request.id)?.firedAt == grant.effectiveExpiresAt)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(try f.repository.readSnapshot().application?.observation.status != .applied)
    #expect(try sql(f.url, "DROP TRIGGER result_failure") == SQLITE_OK)
    let recovered = await f.service.handleDeadlineCallback(registrationID: request.id, generation: request.generation)
    #expect(recovered.disposition == .committed)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(f.scheduler.cancellations == [request.id])
}

@Test(arguments: [AuthorizationStatus.unknown, .denied]) @ItomaControlActor
func unapprovedEnabledStateDoesNotClearTheStoreAndApprovalAloneDoesNotResume(_ authorization: AuthorizationStatus) async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), count = f.restriction.plans.count
    f.contexts.authorization = authorization
    let result = await f.service.reconcile()
    #expect(result.disposition == .uncertain && result.failure == .authorizationRequired)
    #expect(f.restriction.plans.count == count && f.scheduler.cancellations.isEmpty)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    if authorization == .denied {
        #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
        f.contexts.authorization = .approved
        _ = await f.service.reconcile()
        #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
        #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
        #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    }
}

@Test @ItomaControlActor func aStoredExplicitPauseCanClearOwnStoreWhileAuthorizationIsUnknown() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    _ = try f.repository.write { try $0.setActivation(.paused, expectedSequence: $0.snapshot().snapshotSequence) }
    f.contexts.authorization = .unknown
    let result = await f.service.reconcile()
    #expect(result.disposition == .committed)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
    #expect(try f.repository.readSnapshot().activation == .paused)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
}

@Test(arguments: [false, true]) @ItomaControlActor
func crossingABoundaryDuringApplyIsCompensatedOnceAndRepeatedChangesStayUncertain(changeAgain: Bool) async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), count = f.restriction.plans.count
    f.restriction.hook = { _ in
        if f.restriction.plans.count == count + 1 { f.contexts.now = grant.effectiveExpiresAt }
        else if changeAgain { f.contexts.zone = try TimeZoneID("Etc/GMT-1") }
    }
    let result = await f.service.reconcile()
    #expect(f.restriction.plans.count == count + 2)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(try f.repository.readSnapshot().application?.observation.status == (changeAgain ? .uncertain : .applied))
    #expect(result.disposition == (changeAgain ? .uncertain : .committed))
    #expect(changeAgain ? f.scheduler.cancellations.isEmpty : f.scheduler.cancellations.count == 1)
}

@Test @ItomaControlActor func aSupersededReconciliationMarkerNeverOverwritesAnotherControllersObservation() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await confirmedGrant(f)
    let start = try f.service.beginReconciliation(recoverInterruptedCommands: false)
    guard case let .ready(frame) = start else { Issue.record("Expected durable marker"); return }
    _ = await f.service.reconcile()
    let current = try f.repository.readSnapshot().application, count = f.restriction.plans.count
    let stale = try f.service.finalizeReconciliation(frame)
    #expect(stale.result.disposition == .requiresRecovery)
    #expect(f.restriction.plans.count == count)
    #expect(try f.repository.readSnapshot().application == current)
}

@Test @ItomaControlActor func unknownCancellationKeepsLogicalEndAndIsRetriedAfterTheNextSuccessfulReconciliation() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    f.contexts.now = grant.effectiveExpiresAt
    f.scheduler.cancellationResponse = .unknown(.registrationFailure)
    let result = await f.service.handleDeadlineCallback(registrationID: request.id, generation: request.generation)
    #expect(result.disposition == .committed && result.failure == .registrationFailure)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(try f.repository.registration(request.id)?.status == .unknown)
    f.scheduler.cancellationResponse = .accepted
    _ = await f.service.reconcile()
    #expect(try f.repository.registration(request.id)?.status == .obsolete)
    #expect(f.scheduler.cancellations == [request.id, request.id])
}

@Test @ItomaControlActor func postWriteTransientContextFactsSurviveAResultAndObservationStorageFailure() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), count = f.restriction.plans.count
    let original = try TimeZoneID("UTC"), changed = try TimeZoneID("Etc/GMT-1")
    f.restriction.hook = { _ in f.contexts.zone = f.restriction.plans.count == count + 1 ? changed : original }
    #expect(try sql(f.url, "CREATE TRIGGER result_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applying\"')=0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    let result = await f.service.reconcile()
    #expect(result.disposition == .uncertain)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(try f.repository.readSnapshot().application?.observation.status != .applied)
    #expect(f.scheduler.cancellations.isEmpty)
}

@Test(arguments: [false, true]) @ItomaControlActor
func evenAnUnknownCallbackPersistsATransientDenialOrZoneObservation(denied: Bool) async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), first = f.contexts.readCount + 1
    let changed = try TimeZoneID("Etc/GMT-1"), original = try TimeZoneID("UTC")
    f.contexts.onRead = { read in
        f.contexts.zone = !denied && read == first ? changed : original
        return denied && read == first ? .denied : .approved
    }
    _ = await f.service.handleDeadlineCallback(registrationID: id(99_999), generation: try RegistrationGeneration(0))
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(try f.repository.readSnapshot().activation == (denied ? .awaitingReauthorizationConfirmation : .enabled))
    #expect(f.restriction.plans.last?.desiredTargets == (denied ? [] : [id(1), id(2)]))
}

@Test @ItomaControlActor func anUnconfirmedRequestExpiringDuringApplyHasATerminalCommandBeforeGrantRetirement() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    f.restriction.hook = { _ in f.contexts.now = grant.effectiveExpiresAt }
    let result = await f.service.reconcile()
    #expect(result.disposition == .committed)
    #expect(try f.repository.command(grant.commandID)?.status == .expired)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(f.scheduler.requests.isEmpty && f.scheduler.cancellations.isEmpty)
    let duplicate = try await f.service.executeAcceptedGrant(commandID: grant.commandID)
    #expect(duplicate.disposition == .committed)
}

@Test @ItomaControlActor func abandonedSchedulingIsRecoveredWithoutRegisteringOrExtendingIt() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept(), stored = try f.repository.command(id(1)), command = try #require(stored)
    _ = try f.service.prepareGrant(command)
    let result = await f.service.reconcile(recoverInterruptedCommands: true)
    #expect(result.disposition == .committed)
    #expect(try f.repository.command(command.id)?.status == .uncertain)
    #expect(try f.repository.grant(grant.id)?.grant.status == .uncertain)
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
    #expect(f.scheduler.requests.isEmpty && f.scheduler.cancellations.isEmpty)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
}

@Test @ItomaControlActor func outboxCapacityDoesNotPreventAReblockAndRecordsAHistoryGap() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    let service = try CommandService(repository: f.repository, scheduler: f.scheduler, restriction: f.restriction,
        contexts: f.contexts, historyCapacity: HistoryOutboxCapacity(maximumPendingEvents: 1), identifiers: f.identifiers)
    f.contexts.now = grant.effectiveExpiresAt
    let result = await service.handleDeadlineCallback(registrationID: request.id, generation: request.generation)
    #expect(result.disposition == .committed && result.failure == nil)
    #expect(try f.repository.historyBoundary().historyIncomplete)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
}

@Test @ItomaControlActor func aBusyWriterReturnsUncertainWithoutAnyOSOrSchedulerOperation() async throws {
    let f = try Fixture(); defer { f.remove() }
    var handle: OpaquePointer?
    #expect(sqlite3_open_v2(f.url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(handle)
    defer { sqlite3_exec(db, "ROLLBACK", nil, nil, nil); sqlite3_close(db) }
    #expect(sqlite3_exec(db, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK)
    let result = await f.service.reconcile()
    #expect(result.disposition == .uncertain && result.failure == .storageFailure)
    #expect(f.restriction.plans.isEmpty && f.scheduler.requests.isEmpty && f.scheduler.cancellations.isEmpty)
}

@Test @ItomaControlActor func approvalRevokedDuringCleanupIsObservedBeforeReturning() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    f.contexts.now = grant.effectiveExpiresAt
    f.scheduler.cancelHook = { _ in f.contexts.authorization = .denied }
    let result = await f.service.reconcile()
    #expect(result.disposition == .requiresRecovery)
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
}

@Test @ItomaControlActor func aClockRollbackCannotRestoreAPreviouslyConfirmedGrant() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    f.contexts.now = try instant(grant.acceptedAt.secondsSince1970 - 1)
    _ = await f.service.reconcile()
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    f.contexts.now = grant.acceptedAt
    _ = await f.service.reconcile()
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(f.scheduler.requests.count == 1)
}

@Test(arguments: [false, true]) @ItomaControlActor
func acceptanceArrivingAfterCancellationStaysTrackedForAnotherCleanup(candidate: Bool) async throws {
    let f = try Fixture(); defer { f.remove() }
    let commandID: CommandID
    var preview: PolicyEditAssessment?
    if candidate {
        _ = try await confirmedGrant(f)
        let proposal = try shorteningCandidate(f)
        commandID = proposal.commandID
        preview = try f.service.previewCandidate(commandID: commandID)
    } else {
        commandID = try f.accept().commandID
    }
    var activeSchedule = false
    var lateID: RegistrationID?
    f.scheduler.cancelHook = { canceled in if canceled.id == lateID { activeSchedule = false } }
    f.scheduler.hook = { preparing in
        guard preparing.commandID == commandID else { return }
        lateID = preparing.id
        _ = try f.repository.write { try $0.setActivation(.paused, expectedSequence: $0.snapshot().snapshotSequence) }
        let result = await f.service.reconcile()
        #expect(result.disposition == .committed && result.failure == .interrupted)
        #expect(try f.repository.registration(preparing.id)?.status == .unknown)
        // The external registration completes after cancel. It must not become an untracked orphan.
        activeSchedule = true
    }
    if candidate { _ = try await f.service.executeAcceptedCandidate(commandID: commandID, confirmation: preview) }
    else { _ = try await f.service.executeAcceptedGrant(commandID: commandID) }
    let registrationID = try #require(lateID), saved = try f.repository.registration(registrationID)
    #expect(saved?.status == .unknown && saved?.receipt != nil)
    #expect(activeSchedule)
    #expect(try f.repository.readSnapshot().activation == .paused)
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
    _ = await f.service.reconcile()
    #expect(!activeSchedule)
    #expect(try f.repository.registration(registrationID)?.status == .obsolete)
    #expect(f.scheduler.cancellations.filter { $0 == registrationID }.count == 2)
}

@Test @ItomaControlActor func receiptArrivingBeforeCancelReturnsCannotMakeThatEarlierCancelFinal() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    var pending: DeadlineRegistration?
    f.scheduler.cancelHook = { canceled in
        guard let request = pending, canceled.id == request.id else { return }
        let receipt = DeadlineReceipt(registrationID: request.id, generation: request.generation,
            scheduledFor: request.scheduledFor, acceptedAt: f.contexts.now)
        // Simulate register's acceptance being persisted after cancel's native effect but before
        // the cancellation await returns. That receipt was not covered by the earlier cancel.
        _ = try f.service.storeScheduleReceipt(receipt, prepared: request)
    }
    f.scheduler.hook = { preparing in
        pending = preparing
        _ = try f.repository.write { try $0.setActivation(.paused, expectedSequence: $0.snapshot().snapshotSequence) }
        _ = await f.service.reconcile()
        let current = try f.repository.registration(preparing.id)
        #expect(current?.receipt != nil && current?.status == .unknown)
    }
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    let preparing = try #require(pending)
    #expect(try f.repository.registration(preparing.id)?.status == .unknown)
    f.scheduler.cancelHook = nil
    _ = await f.service.reconcile()
    #expect(try f.repository.registration(preparing.id)?.status == .obsolete)
    #expect(f.scheduler.cancellations == [preparing.id, preparing.id])
}

@Test @ItomaControlActor func callbackFactsCommitAloneCannotLeaveAnActiveGrantAfterItsProtectionFires() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f), request = try #require(f.scheduler.requests.first)
    // Stop at the callback's first durable boundary, without running reconciliation.
    try f.service.recordDeadlineCallback(registrationID: request.id, generation: request.generation)
    let other = try ControlRepository.open(at: f.url); defer { try? other.close() }
    #expect(try other.registration(request.id)?.status == .fired)
    #expect(try other.grant(grant.id)?.grant.status == .uncertain)
    #expect(try other.readSnapshot().application?.observation.status == .uncertain)
    #expect(f.restriction.plans.count == 1 && f.scheduler.cancellations.isEmpty)
    // A new controller can now reblock; it does not need to recover an old Active flag.
    _ = await f.service.reconcile()
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
}

@Test @ItomaControlActor func aDefiniteRejectedRegistrationDoesNotRemainInEndlessUnknownCleanup() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    f.scheduler.response = .rejected(.registrationFailure)
    _ = try await f.service.executeAcceptedGrant(commandID: grant.commandID)
    let request = try #require(f.scheduler.requests.first)
    f.contexts.now = grant.effectiveExpiresAt
    _ = await f.service.reconcile()
    #expect(try f.repository.command(grant.commandID)?.status == .expired)
    #expect(try f.repository.registration(request.id)?.status == .obsolete)
    let calls = f.scheduler.cancellations.count
    _ = await f.service.reconcile()
    #expect(f.scheduler.cancellations.count == calls)
}

@Test @ItomaControlActor func aClockRollbackDuringCancellationInvalidatesThePriorAppliedEvidence() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    f.contexts.now = grant.effectiveExpiresAt
    f.scheduler.cancelHook = { _ in f.contexts.now = try instant(28_800) }
    let result = await f.service.reconcile()
    #expect(result.disposition == .requiresRecovery)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    _ = await f.service.reconcile()
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
}

@Test @ItomaControlActor func aPauseSavedDuringCleanupRequiresAnotherCurrentStoreEvaluation() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try await confirmedGrant(f)
    f.contexts.now = grant.effectiveExpiresAt
    f.scheduler.cancelHook = { _ in
        _ = try f.repository.write { try $0.setActivation(.paused, expectedSequence: $0.snapshot().snapshotSequence) }
    }
    let result = await f.service.reconcile()
    #expect(result.disposition == .requiresRecovery)
    #expect(try f.repository.readSnapshot().activation == .paused)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    _ = await f.service.reconcile()
    #expect(f.restriction.plans.last?.desiredTargets.isEmpty == true)
}

@Test(arguments: [false, true]) @ItomaControlActor
func aDefiniteRejectionArrivingAfterAnEarlyCancellationRemainsFinalEvidence(candidate: Bool) async throws {
    let f = try Fixture(); defer { f.remove() }
    let commandID: CommandID
    var preview: PolicyEditAssessment?
    if candidate {
        _ = try await confirmedGrant(f)
        let proposal = try shorteningCandidate(f)
        commandID = proposal.commandID
        preview = try f.service.previewCandidate(commandID: commandID)
    } else { commandID = try f.accept().commandID }
    var rejectedID: RegistrationID?
    f.scheduler.hook = { preparing in
        guard preparing.commandID == commandID else { return }
        rejectedID = preparing.id
        _ = try f.repository.write { try $0.setActivation(.paused, expectedSequence: $0.snapshot().snapshotSequence) }
        _ = await f.service.reconcile()
        #expect(try f.repository.registration(preparing.id)?.status == .unknown)
        f.scheduler.response = .rejected(.registrationFailure)
    }
    if candidate { _ = try await f.service.executeAcceptedCandidate(commandID: commandID, confirmation: preview) }
    else { _ = try await f.service.executeAcceptedGrant(commandID: commandID) }
    let registrationID = try #require(rejectedID)
    #expect(try f.repository.registration(registrationID)?.status == .failed)
    _ = await f.service.reconcile()
    #expect(try f.repository.registration(registrationID)?.status == .obsolete)
    #expect(try f.repository.readSnapshot().activation == .paused)
}
