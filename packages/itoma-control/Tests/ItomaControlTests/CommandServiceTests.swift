import CSQLiteTest
import Foundation
import ItomaCore
import ItomaStorage
@testable import ItomaControl
import Testing

private func id<Kind>(_ n: Int) -> EntityID<Kind> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private func instant(_ n: Double = 43_200) throws -> Instant { try Instant(secondsSince1970: n) }

@ItomaControlActor final class Contexts: EvaluationContextProvider {
    var now: Instant
    var authorization: AuthorizationStatus = .approved
    var zone: TimeZoneID
    var readCount = 0
    var onRead: (@ItomaControlActor (Int) -> AuthorizationStatus)?
    init() throws { now = try instant(); zone = try TimeZoneID("UTC") }
    func context(activation: Activation) -> EvaluationContext {
        readCount += 1
        if let onRead { authorization = onRead(readCount) }
        return EvaluationContext(now: now, timeZone: zone, authorization: AuthorizationObservation(status: authorization, observedAt: now), activation: activation)
    }
}

@ItomaControlActor final class IDs: ControlIdentifiers {
    var counter = 1_000
    func registrationID() -> RegistrationID { counter += 1; return id(counter) }
    func evaluationID() -> EvaluationID { counter += 1; return id(counter) }
    func eventID() -> EventID { counter += 1; return id(counter) }
}

@ItomaControlActor final class Scheduler: DeadlineScheduler {
    let contexts: Contexts
    var requests: [DeadlineRegistration] = []
    var cancellations: [RegistrationID] = []
    var cancellationResponse: DeadlineCancellationResult = .accepted
    var cancelHook: (@ItomaControlActor (DeadlineRegistration) async throws -> Void)?
    var response: DeadlineScheduleResult?
    var hook: (@ItomaControlActor (DeadlineRegistration) async throws -> Void)?
    init(contexts: Contexts) { self.contexts = contexts }
    func register(_ registration: DeadlineRegistration) async -> DeadlineScheduleResult {
        requests.append(registration)
        do { try await hook?(registration) }
        catch { Issue.record("Scheduler fixture hook failed"); return .unknown(.unknown) }
        return response ?? .accepted(DeadlineReceipt(registrationID: registration.id, generation: registration.generation,
            scheduledFor: registration.scheduledFor, acceptedAt: contexts.now))
    }
    func cancel(_ registration: DeadlineRegistration) async -> DeadlineCancellationResult {
        cancellations.append(registration.id)
        do { try await cancelHook?(registration) }
        catch { Issue.record("Cancel fixture hook failed"); return .unknown(.unknown) }
        return cancellationResponse
    }
}

@ItomaControlActor final class Restriction: RestrictionAdapter {
    var plans: [Evaluation] = []
    var response: RestrictionApplicationResult = .accepted(.writeAttempt)
    var hook: (@ItomaControlActor (Evaluation) throws -> Void)?
    func apply(_ evaluation: Evaluation) -> RestrictionApplicationResult {
        plans.append(evaluation)
        do { try hook?(evaluation) }
        catch { Issue.record("Restriction fixture hook failed"); return .uncertain(.unknown) }
        return response
    }
}

@ItomaControlActor final class Fixture {
    let directory: URL
    let url: URL
    let repository: ControlRepository
    let contexts: Contexts
    let scheduler: Scheduler
    let restriction = Restriction()
    let identifiers = IDs()
    let service: CommandService
    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("control.sqlite")
        let rule = try Rule(id: id(1), version: RuleVersion(0), enabled: true, selectionRef: id(1),
            schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 540, endMinute: 1020, endDayOffset: .sameDay), unlockMode: .reason)
        repository = try ControlRepository.create(at: url, initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [rule], priorityOrder: [id(1)]),
            selections: [StoredSelection(selection: Selection(ref: id(1), targets: [id(1), id(2)]), opaquePayload: Data([1]))], activation: .enabled)
        contexts = try Contexts(); scheduler = Scheduler(contexts: contexts)
        service = try CommandService(repository: repository, scheduler: scheduler, restriction: restriction, contexts: contexts,
            historyCapacity: HistoryOutboxCapacity(maximumPendingEvents: 100), identifiers: identifiers)
    }
    func accept(_ number: Int = 1, target: Int = 1) throws -> TemporaryGrant {
        let snapshot = try repository.readSnapshot(), context = contexts.context(activation: snapshot.activation)
        let evaluation = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection), context: context, grants: [])
        let command = try Command(id: id(number), kind: .requestTemporaryGrant, status: .pending,
            expectedPolicyRevision: snapshot.policy.revision, attempt: AttemptNumber(0), reasonRef: id(100 + number))
        let request = try GrantRequest(grantID: id(number), commandID: id(number), targetRef: id(target), expectedPolicyRevision: snapshot.policy.revision,
            expectedOccurrence: #require(evaluation.rules.targets[id(target)]?.winner?.key), condition: UnlockCondition.reason("fixture"))
        return try repository.write { try $0.acceptGrant(command: command, request: request, context: context, expectedSequence: snapshot.snapshotSequence) }.grant
    }
    func remove() { scheduler.hook = nil; scheduler.cancelHook = nil; restriction.hook = nil; contexts.onRead = nil; try? repository.close(); try? FileManager.default.removeItem(at: directory) }
}

private func sql(_ url: URL, _ text: String) throws -> Int32 {
    var handle: OpaquePointer?
    guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let db = handle else {
        throw CommandServiceError.invalidState
    }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 1)
    return sqlite3_exec(db, text, nil, nil, nil)
}

@Test @ItomaControlActor func preparingAndReceiptAreDurableBeforeSynchronousApplyAndWritersDoNotAwait() async throws {
    let f = try Fixture(); defer { f.remove() }
    let accepted = try f.accept()
    f.scheduler.hook = { registration in
        #expect(try f.repository.registration(registration.id)?.status == .preparing)
        #expect(try f.repository.command(id(1))?.status == .scheduling)
        #expect(try sql(f.url, "BEGIN IMMEDIATE; ROLLBACK") == SQLITE_OK)
        let reopened = try ControlRepository.open(at: f.url)
        #expect(try reopened.grant(id(1))?.grant.initialExpiresAt == accepted.initialExpiresAt)
        try reopened.close()
        let duplicate = try await f.service.executeAcceptedGrant(commandID: id(1))
        #expect(duplicate.disposition == .inProgress)
    }
    f.restriction.hook = { _ in
        #expect(try sql(f.url, "BEGIN IMMEDIATE") == SQLITE_BUSY)
        let registered = try #require(f.scheduler.requests.first)
        // A separate WAL reader sees the prior receipt commit, not the uncommitted Applying.
        let other = try ControlRepository.open(at: f.url)
        #expect(try other.registration(registered.id)?.status == .registered)
        #expect(try other.command(id(1))?.status == .applying)
        #expect(try other.readSnapshot().application?.observation.status == .applying)
        try other.close()
    }
    let result = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(result.disposition == .committed && result.failure == nil)
    #expect(f.scheduler.requests.count == 1 && f.restriction.plans.count == 1)
    #expect(f.restriction.plans[0].desiredTargets == [id(2)])
    #expect(try f.repository.command(id(1))?.status == .succeeded)
    #expect(try f.repository.grant(id(1))?.grant.status == .active)
    #expect(try f.repository.readSnapshot().application?.observation.evidence == .writeAttempt)
    #expect(f.scheduler.cancellations.isEmpty)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(f.scheduler.requests.count == 1 && f.restriction.plans.count == 1)
    try f.repository.close()
    let reopened = try ControlRepository.open(at: f.url)
    #expect(try reopened.readSnapshot().application?.observation.validUntil == accepted.effectiveExpiresAt)
    try reopened.close()
}

@Test(arguments: [false, true]) @ItomaControlActor
func registrationFailureOrUnknownNeverAppliesAnExemption(unknown: Bool) async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    f.scheduler.response = unknown ? .unknown(.registrationFailure) : .rejected(.registrationFailure)
    let result = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(result.disposition == .committed && result.failure == .registrationFailure)
    #expect(f.restriction.plans.isEmpty && f.scheduler.cancellations.isEmpty)
    #expect(try f.repository.command(id(1))?.status == (unknown ? .uncertain : .failed))
    #expect(try f.repository.grant(id(1))?.grant.status == (unknown ? .uncertain : .failed))
    #expect(try f.repository.readSnapshot().application == nil)
    let again = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(again.disposition == .requiresExplicitRetry)
    #expect(f.scheduler.requests.count == 1)
}

@Test @ItomaControlActor func receiptSaveFailureLeavesPreparingAndNeverCallsApply() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    f.scheduler.hook = { _ in
        let code = try sql(f.url, "CREATE TRIGGER receipt_failure BEFORE UPDATE ON registrations BEGIN SELECT RAISE(ABORT,'fixture'); END")
        #expect(code == SQLITE_OK)
    }
    let result = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(result.disposition == .uncertain && result.failure == .storageFailure)
    #expect(f.restriction.plans.isEmpty)
    #expect(try f.repository.registration(f.scheduler.requests[0].id)?.status == .preparing)
    #expect(try f.repository.command(id(1))?.status == .scheduling)
    #expect(f.scheduler.cancellations.isEmpty)
}

@Test @ItomaControlActor func expiryDuringRegistrationIsRecheckedBeforeAnyApply() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    f.scheduler.hook = { _ in f.contexts.now = grant.effectiveExpiresAt }
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(f.restriction.plans.isEmpty)
    #expect(try f.repository.command(id(1))?.status == .expired)
    #expect(try f.repository.grant(id(1))?.hasEnded == true)
}

@Test @ItomaControlActor func activationChangeDuringRegistrationDoesNotReplayTheOldPlan() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    f.scheduler.hook = { _ in
        _ = try f.repository.setActivation(.paused, expectedSequence: f.repository.readSnapshot().snapshotSequence)
    }
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(f.restriction.plans.isEmpty)
    #expect(try f.repository.command(id(1))?.status == .superseded)
    #expect(try f.repository.readSnapshot().activation == .paused)
}

@Test @ItomaControlActor func firedReceiptBeforeFinalWriterDoesNotAuthorizeApply() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    f.scheduler.hook = { preparing in
        let fired = try DeadlineRegistration(id: preparing.id, grantID: preparing.grantID, commandID: preparing.commandID,
            generation: preparing.generation, policyRevision: preparing.policyRevision, scheduledFor: preparing.scheduledFor,
            status: .fired, firedAt: f.contexts.now)
        _ = try f.repository.write { try $0.recordRegistration(fired, expected: preparing) }
    }
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(f.restriction.plans.isEmpty)
    #expect(try f.repository.registration(f.scheduler.requests[0].id)?.status == .fired)
}

@Test @ItomaControlActor func explicitRetryKeepsDeadlineAndGrantAndAdvancesAttemptAndGeneration() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    f.scheduler.response = .rejected(.registrationFailure)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    f.contexts.now = try instant(43_260)
    f.scheduler.response = nil
    let retried = try await f.service.retryGrant(commandID: id(1))
    #expect(retried.disposition == .committed)
    #expect(try f.repository.command(id(1))?.attempt.rawValue == 1)
    #expect(f.scheduler.requests.count == 2 && f.scheduler.requests[1].generation.rawValue == 1)
    #expect(f.scheduler.requests[1].scheduledFor == grant.effectiveExpiresAt)
    #expect(try f.repository.grant(id(1))?.grant.initialExpiresAt == grant.initialExpiresAt)
    #expect(try f.repository.grant(id(1))?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
}

@Test(arguments: [false, true]) @ItomaControlActor
func restrictionFailureOrUncertaintyIsPersistedWithoutAnActiveExemption(unknown: Bool) async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    f.restriction.response = unknown ? .uncertain(.osOperationFailure) : .failed(.osOperationFailure)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(try f.repository.command(id(1))?.status == (unknown ? .uncertain : .failed))
    #expect(try f.repository.grant(id(1))?.grant.status == (unknown ? .uncertain : .failed))
    #expect(try f.repository.readSnapshot().application?.observation.status == (unknown ? .uncertain : .failed))
    #expect(f.scheduler.cancellations.isEmpty)
}

@Test @ItomaControlActor func OSAttemptThenResultCommitFailureIsUncertainAndRetainsTheProtection() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    // Result storage fails after the synchronous adapter's write attempt.
    #expect(try sql(f.url, "CREATE TRIGGER result_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applied\"')>0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    let result = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(result.disposition == .uncertain && result.failure == .storageFailure)
    #expect(f.restriction.plans.count == 1)
    #expect(try f.repository.command(id(1))?.status == .applying)
    #expect(try f.repository.grant(id(1))?.grant.status == .applying)
    #expect(try f.repository.readSnapshot().application?.observation.status != .applied)
    #expect(try f.repository.readSnapshot().application?.observation.validUntil == nil)
    #expect(try f.repository.registration(f.scheduler.requests[0].id)?.status == .registered)
    #expect(f.scheduler.cancellations.isEmpty)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(f.scheduler.requests.count == 1 && f.restriction.plans.count == 1)
}

@Test @ItomaControlActor func nativeApplyCrossingTheDeadlineImmediatelyAttemptsBaselineAndDoesNotCommitActive() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    f.restriction.hook = { _ in f.contexts.now = grant.effectiveExpiresAt }
    let result = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(result.disposition == .committed)
    #expect(f.restriction.plans.count == 2)
    #expect(f.restriction.plans[1].desiredTargets == [id(1), id(2)])
    #expect(try f.repository.grant(id(1))?.grant.status == .expired)
    #expect(try f.repository.readSnapshot().application?.evaluation.desiredTargets == [id(1), id(2)])
}

@Test @ItomaControlActor func anActiveFlagWithoutRegisteredProtectionIsNotAnExemptionInANewPlan() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    let old = try #require(f.repository.registrations(grantID: id(1)).first)
    let unknown = try DeadlineRegistration(id: old.id, grantID: old.grantID, commandID: old.commandID,
        generation: old.generation, policyRevision: old.policyRevision, scheduledFor: old.scheduledFor, status: .unknown, receipt: old.receipt)
    _ = try f.repository.write { try $0.recordRegistration(unknown, expected: old) }
    _ = try f.accept(2, target: 2)
    _ = try await f.service.executeAcceptedGrant(commandID: id(2))
    #expect(f.restriction.plans.last?.desiredTargets == [id(1)])
    #expect(try f.repository.grant(id(1))?.grant.status == .uncertain)
    #expect(try f.repository.grant(id(2))?.grant.status == .active)
}

@Test @ItomaControlActor func clockRollbackRecoveryRechecksOtherGrantsReceiptTime() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    f.scheduler.hook = { _ in f.contexts.now = try instant(43_260) }
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    f.scheduler.hook = nil
    f.contexts.now = try instant(43_320)
    _ = try f.accept(2, target: 2)
    f.restriction.hook = { _ in f.contexts.now = try instant(43_230) }
    _ = try await f.service.executeAcceptedGrant(commandID: id(2))
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(try f.repository.grant(id(1))?.grant.status == .uncertain)
}

@Test(arguments: [AuthorizationStatus.unknown, .denied]) @ItomaControlActor
func authorizationLossAfterApplyDoesNotTranslateTheCoreGateIntoAStoreClear(status: AuthorizationStatus) async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    f.restriction.hook = { _ in f.contexts.authorization = status }
    let result = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(result.disposition == .committed && result.failure == .authorizationRequired)
    #expect(f.restriction.plans.count == 1) // no empty-target second write
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(try f.repository.grant(id(1))?.hasEnded == true)
    #expect(try f.repository.readSnapshot().activation == (status == .denied ? .awaitingReauthorizationConfirmation : .enabled))
}

@Test @ItomaControlActor func failedSecondApplyCannotExposeTheOldAppliedObservationAsCurrentEvidence() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(1, target: 2)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(try f.repository.readSnapshot().application?.observation.status == .applied)
    _ = try f.accept(2, target: 1)
    #expect(try sql(f.url, "CREATE TRIGGER second_result_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applied\"')>0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    let result = try await f.service.executeAcceptedGrant(commandID: id(2))
    #expect(result.disposition == .uncertain)
    let snapshot = try f.repository.readSnapshot()
    #expect(snapshot.application?.observation.status != .applied)
    #expect(snapshot.application?.observation.validUntil == nil)
    #expect(try f.repository.command(id(2))?.status == .applying)
}

@Test @ItomaControlActor func recoveryApplyAlsoLosesEvidenceWhenItsContextChanges() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    f.restriction.hook = { _ in
        if f.restriction.plans.count == 1 { f.contexts.now = grant.effectiveExpiresAt }
        else { f.contexts.authorization = .unknown }
    }
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(f.restriction.plans.count == 2)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(try f.repository.readSnapshot().application?.observation.validUntil == nil)
}

@Test @ItomaControlActor func otherGrantsInvalidatedByTimezoneStayInvalidatedWhenTheTimezoneReturns() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(1, target: 1)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    f.contexts.zone = try TimeZoneID("Etc/GMT-1")
    _ = try f.accept(2, target: 2)
    _ = try await f.service.executeAcceptedGrant(commandID: id(2))
    let storedEnded = try f.repository.grant(id(1))
    let ended = try #require(storedEnded)
    #expect(ended.grant.status == .invalidated && ended.hasEnded)
    f.contexts.zone = try TimeZoneID("UTC")
    let snapshot = try f.repository.readSnapshot()
    let storedSecond = try f.repository.grant(id(2))
    let second = try #require(storedSecond)
    let all = [ended.grant, second.grant]
    let evaluation = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection), context: f.contexts.context(activation: snapshot.activation), grants: all)
    #expect(evaluation.assessments.first { $0.grant.id == id(1) }?.disposition == .invalidated)
    #expect(evaluation.desiredTargets.contains(id(1)))
}

@Test @ItomaControlActor func aSupersededApplyingMarkerCannotAuthorizeAnOSWriteAfterAnotherControllersAppliedCommit() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(1, target: 1)
    let storedOwner = try f.repository.command(id(1))
    let owner = try #require(storedOwner)
    let storedPreparing = try f.service.prepareGrant(owner)
    let preparing = try #require(storedPreparing)
    let accepted = await f.scheduler.register(preparing)
    guard case let .accepted(receipt) = accepted else { Issue.record("Unexpected scheduler fixture result"); return }
    let registered = try DeadlineRegistration(id: preparing.id, grantID: preparing.grantID, commandID: preparing.commandID,
        generation: preparing.generation, policyRevision: preparing.policyRevision, scheduledFor: preparing.scheduledFor, status: .registered, receipt: receipt)
    _ = try f.repository.write { try $0.recordRegistration(registered, expected: preparing) }
    let started = try f.service.beginApplication(commandID: id(1), registrationID: preparing.id, attempt: owner.attempt)
    guard case let .ready(markerID) = started else { Issue.record("Expected durable Applying fixture"); return }
    _ = try f.accept(2, target: 2)
    _ = try await f.service.executeAcceptedGrant(commandID: id(2))
    let otherCommit = try f.repository.readSnapshot().application
    #expect(otherCommit?.observation.status == .applied)
    #expect(otherCommit?.evaluation.id != markerID)
    let count = f.restriction.plans.count
    let resumed = try f.service.finalizeGrant(commandID: id(1), registrationID: preparing.id, applicationID: markerID, attempt: owner.attempt)
    #expect(resumed.disposition == .requiresRecovery)
    #expect(f.restriction.plans.count == count)
    #expect(try f.repository.readSnapshot().application == otherCommit)
}

@Test @ItomaControlActor func confirmedDenialDuringANewRequestInvalidatesAllOldGrantsAndWaitsForUserReauthorizationIntent() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(1, target: 1)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    _ = try f.accept(2, target: 2)
    f.contexts.authorization = .denied
    _ = try await f.service.executeAcceptedGrant(commandID: id(2))
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
    #expect(try f.repository.grant(id(1))?.hasEnded == true)
    #expect(try f.repository.grant(id(2))?.hasEnded == true)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(f.restriction.plans.count == 1 && f.scheduler.requests.count == 1)
    f.contexts.authorization = .approved
    #expect(throws: GrantEvaluationError.activationRequired) { try f.accept(3, target: 2) }
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
}

@Test @ItomaControlActor func aLateOldRegistrationFailureCannotFailANewerAttempt() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept()
    f.scheduler.hook = { old in
        try f.repository.write { tx in
            let storedCommand = try tx.command(id(1)), storedGrant = try tx.grant(id(1))
            let command = try #require(storedCommand), grant = try #require(storedGrant).grant
            let uncertain = try Command(id: command.id, kind: command.kind, status: .uncertain, expectedPolicyRevision: command.expectedPolicyRevision,
                attempt: command.attempt, reasonRef: command.reasonRef)
            _ = try tx.recordCommand(uncertain, expected: command)
            let pending = try Command(id: command.id, kind: command.kind, status: .pending, expectedPolicyRevision: command.expectedPolicyRevision,
                attempt: command.attempt.next(), reasonRef: command.reasonRef)
            _ = try tx.recordCommand(pending, expected: uncertain)
            let scheduling = try Command(id: pending.id, kind: pending.kind, status: .scheduling, expectedPolicyRevision: pending.expectedPolicyRevision,
                attempt: pending.attempt, reasonRef: pending.reasonRef)
            _ = try tx.recordCommand(scheduling, expected: pending)
            let next = try DeadlineRegistration(id: id(99_999), grantID: grant.id, commandID: command.id, generation: old.generation.next(),
                policyRevision: old.policyRevision, scheduledFor: old.scheduledFor, status: .preparing)
            _ = try tx.recordRegistration(next)
        }
        f.scheduler.response = .rejected(.registrationFailure)
    }
    let result = try await f.service.executeAcceptedGrant(commandID: id(1))
    #expect(result.disposition == .requiresRecovery)
    #expect(try f.repository.command(id(1))?.attempt.rawValue == 1)
    #expect(try f.repository.command(id(1))?.status == .scheduling)
    #expect(try f.repository.grant(id(1))?.grant.status == .scheduling)
    #expect(f.restriction.plans.isEmpty)
}

@Test @ItomaControlActor func grantPostOSContextFactsAlsoSurviveTheResultTransactionRollback() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(1, target: 1)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    _ = try f.accept(2, target: 2)
    let changed = try TimeZoneID("Etc/GMT-1"), original = try TimeZoneID("UTC"), initial = f.restriction.plans.count
    f.restriction.hook = { _ in
        f.contexts.zone = f.restriction.plans.count == initial + 1 ? changed : original
    }
    #expect(try sql(f.url, "CREATE TRIGGER grant_post_os_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applying\"')=0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    let result = try await f.service.executeAcceptedGrant(commandID: id(2))
    #expect(result.disposition == .uncertain)
    for n in 1...2 { #expect(try f.repository.grant(id(n))?.hasEnded == true) }
    #expect(try f.repository.readSnapshot().application?.observation.status != .applied)
}
