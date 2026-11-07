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

@ItomaControlActor private func twoGrants(_ f: Fixture) async throws -> [TemporaryGrant] {
    let a = try f.accept(1, target: 1)
    _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    let b = try f.accept(2, target: 2)
    _ = try await f.service.executeAcceptedGrant(commandID: id(2))
    return [a, b]
}

@ItomaControlActor private func candidate(_ f: Fixture, number: Int = 100, invalidates: Bool = false, durationOnly: Bool = false) throws -> PolicyCandidate {
    var snapshot = try f.repository.readSnapshot()
    let proposed: PolicySnapshot
    if durationOnly {
        proposed = try PolicySnapshot(revision: snapshot.policy.revision.next(), rules: snapshot.policy.rules,
            priorityOrder: snapshot.policy.priorityOrder, defaultUnlockDuration: UnlockDuration(minutes: 10))
    } else if invalidates {
        let old = snapshot.policy.rules[0]
        let changed = try Rule(id: old.id, version: old.version.next(), enabled: old.enabled, selectionRef: old.selectionRef,
            schedule: old.schedule, unlockMode: .unavailable)
        proposed = try PolicySnapshot(revision: snapshot.policy.revision.next(), rules: [changed], priorityOrder: [changed.id])
    } else {
        snapshot = try f.repository.putSelection(StoredSelection(selection: Selection(ref: id(2), targets: [id(1), id(2)]), opaquePayload: Data([2])), expectedSequence: snapshot.snapshotSequence)
        let high = try Rule(id: id(2), version: RuleVersion(0), enabled: true, selectionRef: id(2),
            schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 723, endMinute: 780, endDayOffset: .sameDay), unlockMode: .unavailable)
        proposed = try PolicySnapshot(revision: snapshot.policy.revision.next(), rules: snapshot.policy.rules + [high], priorityOrder: [id(2), id(1)])
    }
    let command = try Command(id: id(number), kind: .commitPolicy, status: .pending, expectedPolicyRevision: snapshot.policy.revision,
        candidatePolicyRevision: proposed.revision, attempt: AttemptNumber(0))
    let result = try PolicyCandidate(commandID: command.id, expectedRevision: snapshot.policy.revision, proposedPolicy: proposed)
    _ = try f.repository.write { try $0.acceptCandidate(command: command, candidate: result, expectedSequence: snapshot.snapshotSequence) }
    return result
}

@Test @ItomaControlActor func allShortenedDeadlinesCommitBeforeActivationAndOldCancellation() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grants = try await twoGrants(f)
    let oldRegistrations = f.scheduler.requests
    let proposal = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: proposal.commandID)
    #expect(confirmation.requiredDeadlineUpdates.count == 2)
    f.scheduler.hook = { request in
        if request.commandID == proposal.commandID {
            #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
            for grant in grants {
                let stored = try f.repository.grant(grant.id)
                #expect(stored?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
            }
            #expect(f.scheduler.cancellations.isEmpty)
            let available = try sql(f.url, "BEGIN IMMEDIATE; ROLLBACK")
            #expect(available == SQLITE_OK)
        }
    }
    f.restriction.hook = { _ in
        let other = try ControlRepository.open(at: f.url)
        #expect(try other.readSnapshot().policy.revision.rawValue == 0)
        #expect(try other.readSnapshot().application?.observation.status == .applying)
        let ready = f.scheduler.requests.filter { $0.commandID == proposal.commandID }
        #expect(ready.count == 2)
        for request in ready { #expect(try other.registration(request.id)?.status == .registered) }
        try other.close()
        #expect(f.scheduler.cancellations.isEmpty)
    }
    f.scheduler.cancelHook = { _ in
        let snapshot = try f.repository.readSnapshot()
        #expect(snapshot.policy == proposal.proposedPolicy && snapshot.application?.observation.status == .applied)
        let available = try sql(f.url, "BEGIN IMMEDIATE; ROLLBACK")
        #expect(available == SQLITE_OK)
        for grant in grants { #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == instant(43_380)) }
    }
    let result = try await f.service.executeAcceptedCandidate(commandID: proposal.commandID, confirmation: confirmation)
    #expect(result.disposition == .committed && result.failure == nil)
    #expect(f.scheduler.requests.filter { $0.commandID == proposal.commandID }.count == 2)
    #expect(Set(f.scheduler.cancellations) == Set(oldRegistrations.map(\.id)))
    for old in oldRegistrations { #expect(try f.repository.registration(old.id)?.status == .obsolete) }
    let expectedDeadline = try instant(43_380)
    for grant in grants {
        let stored = try #require(f.repository.grant(grant.id)?.grant)
        #expect(stored.initialExpiresAt == grant.initialExpiresAt && stored.effectiveExpiresAt == expectedDeadline)
    }
    #expect(try f.repository.readSnapshot().lastValidPolicy.revision.rawValue == 0)
}

@Test(arguments: [false, true]) @ItomaControlActor
func partialRegistrationFailureRetainsOldPolicyExpiryAndProtection(unknown: Bool) async throws {
    let f = try Fixture(); defer { f.remove() }
    let grants = try await twoGrants(f), old = f.scheduler.requests
    let proposal = try candidate(f), confirmation = try f.service.previewCandidate(commandID: id(100))
    f.scheduler.hook = { request in
        if request.commandID == proposal.commandID && f.scheduler.requests.filter({ $0.commandID == proposal.commandID }).count == 2 {
            f.scheduler.response = unknown ? .unknown(.registrationFailure) : .rejected(.registrationFailure)
        }
    }
    let count = f.restriction.plans.count
    let result = try await f.service.executeAcceptedCandidate(commandID: proposal.commandID, confirmation: confirmation)
    #expect(result.failure == .registrationFailure)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    for grant in grants { #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt) }
    for registration in old { #expect(try f.repository.registration(registration.id)?.status == .registered) }
    #expect(f.restriction.plans.count == count && f.scheduler.cancellations.isEmpty)
    let remaining = try f.repository.write { tx in try f.service.protectedGrants(context: f.contexts.context(activation: tx.snapshot().activation), transaction: tx) }
    #expect(remaining.allSatisfy { $0.status == .active }) // unactivated candidate receipt never replaces the old effective receipt
}

@Test @ItomaControlActor func receiptStorageFailureKeepsTheCandidateUnapplied() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grants = try await twoGrants(f)
    _ = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    f.scheduler.hook = { request in
        if request.commandID == id(100) {
            let result = try sql(f.url, "CREATE TRIGGER candidate_receipt_failure BEFORE UPDATE ON registrations BEGIN SELECT RAISE(ABORT,'fixture'); END")
            #expect(result == SQLITE_OK)
        }
    }
    let count = f.restriction.plans.count
    let result = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation)
    #expect(result.failure == .storageFailure)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    #expect(f.restriction.plans.count == count && f.scheduler.cancellations.isEmpty)
    for grant in grants { #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt) }
}

@Test @ItomaControlActor func editImpactChangingDuringRegistrationRequiresNewConfirmation() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    f.scheduler.hook = { request in if request.commandID == id(100) { f.contexts.now = try instant(43_380) } }
    var reconfirm = false
    do { _ = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation) }
    catch CommandServiceError.confirmationChanged { reconfirm = true }
    #expect(reconfirm)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    #expect(try f.repository.command(id(100))?.status == .failed)
    #expect(f.scheduler.cancellations.isEmpty)
    f.scheduler.hook = nil
    let fresh = try f.service.previewCandidate(commandID: id(100))
    #expect(fresh.requiredDeadlineUpdates.isEmpty && fresh.requiresConfirmation)
    let retried = try await f.service.retryCandidate(commandID: id(100), confirmation: fresh)
    #expect(retried.disposition == .committed)
    #expect(try f.repository.command(id(100))?.attempt.rawValue == 1)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 1)
}

@Test @ItomaControlActor func anotherPolicyCommittingDuringRegistrationSupersedesTheCandidate() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    var changed = false
    f.scheduler.hook = { request in
        guard request.commandID == id(100), !changed else { return }
        changed = true
        let other = try candidate(f, number: 101, durationOnly: true)
        try f.repository.write { tx in
            let saved = try tx.command(id(101))
            let pending = try #require(saved)
            let applying = try Command(id: pending.id, kind: pending.kind, status: .applying, expectedPolicyRevision: pending.expectedPolicyRevision,
                candidatePolicyRevision: pending.candidatePolicyRevision, attempt: pending.attempt)
            _ = try tx.recordCommand(applying, expected: pending)
            _ = try tx.activateCandidate(commandID: other.commandID, expectedSequence: tx.snapshot().snapshotSequence,
                context: f.contexts.context(activation: .enabled))
        }
    }
    let count = f.restriction.plans.count
    _ = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation)
    #expect(try f.repository.command(id(100))?.status == .superseded)
    #expect(try f.repository.readSnapshot().policy.defaultUnlockDuration.minutes == 10)
    #expect(f.restriction.plans.count == count && f.scheduler.cancellations.isEmpty)
}

@Test @ItomaControlActor func oldCancellationFailureDoesNotExtendOrRollbackTheNewDeadline() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    f.scheduler.cancellationResponse = .unknown(.registrationFailure)
    let result = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation)
    #expect(result.disposition == .committed && result.failure == .registrationFailure)
    #expect(try f.repository.command(id(100))?.status == .succeeded)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 1)
    for n in 1...2 { #expect(try f.repository.grant(id(n))?.grant.effectiveExpiresAt == instant(43_380)) }
    #expect(try f.repository.readSnapshot().application?.observation.status == .applied)
}

@Test @ItomaControlActor func restrictionFailureKeepsRegisteredDesiredPolicyButDoesNotCancelOldProtection() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    f.restriction.response = .failed(.osOperationFailure)
    _ = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 1)
    #expect(try f.repository.readSnapshot().application?.observation.status == .failed)
    #expect(f.scheduler.cancellations.isEmpty)
    let count = f.scheduler.requests.count
    let retry = try await f.service.retryCandidate(commandID: id(100), confirmation: confirmation)
    #expect(retry.disposition == .requiresRecovery && f.scheduler.requests.count == count)
}

@Test @ItomaControlActor func unapprovedConfigurationSaveDoesNotApplyAnEmptyRestrictionPlan() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try candidate(f)
    f.contexts.authorization = .denied
    let preview = try f.service.previewCandidate(commandID: id(100))
    #expect(!preview.requiresConfirmation)
    let result = try await f.service.executeAcceptedCandidate(commandID: id(100))
    #expect(result.disposition == .committed && result.failure == .authorizationRequired)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 1)
    #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
    #expect(try f.repository.readSnapshot().application?.observation.status == .uncertain)
    #expect(f.restriction.plans.isEmpty && f.scheduler.requests.isEmpty)
}

@Test @ItomaControlActor func missingImpactConfirmationIsRejectedBeforeRegistration() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f)
    let count = f.scheduler.requests.count
    var required = false
    do { _ = try await f.service.executeAcceptedCandidate(commandID: id(100)) }
    catch CommandServiceError.confirmationRequired { required = true }
    #expect(required && f.scheduler.requests.count == count)
    #expect(try f.repository.command(id(100))?.status == .pending)
}

@Test @ItomaControlActor func resultCommitFailureLeavesOldPolicyAndADurableUncertainMarker() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grants = try await twoGrants(f)
    _ = try candidate(f, invalidates: true)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    #expect(try sql(f.url, "CREATE TRIGGER candidate_result_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applied\"')>0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    let result = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation)
    #expect(result.disposition == .uncertain)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    #expect(try f.repository.readSnapshot().application?.observation.status != .applied)
    #expect(f.restriction.plans.last?.desiredTargets == [id(1), id(2)])
    #expect(f.scheduler.cancellations.isEmpty)
    for grant in grants { #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt) }
}

@Test @ItomaControlActor func aCandidateAlreadySupersededBeforeExecutionGetsADurableTerminalResult() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try candidate(f, durationOnly: true)
    _ = try candidate(f, number: 101, durationOnly: true)
    _ = try await f.service.executeAcceptedCandidate(commandID: id(101))
    let count = f.restriction.plans.count
    _ = try await f.service.executeAcceptedCandidate(commandID: id(100))
    #expect(try f.repository.command(id(100))?.status == .superseded)
    #expect(f.restriction.plans.count == count)
}

@Test @ItomaControlActor func currentTimezoneInvalidationCommitsBeforeTheCandidateAndSurvivesItsRollback() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f)
    f.contexts.zone = try TimeZoneID("Etc/GMT-1")
    _ = try candidate(f, durationOnly: true)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    #expect(try f.repository.grant(id(1))?.hasEnded == true)
    #expect(try sql(f.url, "CREATE TRIGGER negative_fact_result_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applied\"')>0 BEGIN SELECT RAISE(ABORT,'fixture'); END") == SQLITE_OK)
    _ = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    f.contexts.zone = try TimeZoneID("UTC")
    for n in 1...2 {
        let stored = try f.repository.grant(id(n))
        #expect(stored?.grant.status == .invalidated && stored?.hasEnded == true)
    }
}

@Test @ItomaControlActor func timezoneInvalidationDuringAwaitSurvivesRejectedConfirmation() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: id(100)), changedZone = try TimeZoneID("Etc/GMT-1")
    f.scheduler.hook = { request in if request.commandID == id(100) { f.contexts.zone = changedZone } }
    var changed = false
    do { _ = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation) }
    catch CommandServiceError.confirmationChanged { changed = true }
    #expect(changed)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    f.contexts.zone = try TimeZoneID("UTC")
    #expect(try f.repository.grant(id(1))?.hasEnded == true)
    #expect(try f.repository.grant(id(2))?.hasEnded == true)
}

@Test(arguments: 1...8) @ItomaControlActor
func everyObservedTransientDenialIsCommittedEvenWhenConfirmationFails(read: Int) async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    f.contexts.readCount = 0
    var observed = false
    f.contexts.onRead = { number in
        if number == read { observed = true; return .denied }
        return .approved
    }
    do { _ = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation) }
    catch CommandServiceError.confirmationChanged { }
    if observed {
        #expect(try f.repository.readSnapshot().activation == .awaitingReauthorizationConfirmation)
        #expect(try f.repository.grant(id(1))?.hasEnded == true)
        #expect(try f.repository.grant(id(2))?.hasEnded == true)
    }
}

@Test @ItomaControlActor func defaultDurationEditDoesNotRescheduleOrExtendExistingGrants() async throws {
    let f = try Fixture(); defer { f.remove() }
    let original = try await twoGrants(f), count = f.scheduler.requests.count
    _ = try candidate(f, durationOnly: true)
    _ = try await f.service.executeAcceptedCandidate(commandID: id(100))
    #expect(try f.repository.readSnapshot().policy.defaultUnlockDuration.minutes == 10)
    #expect(f.scheduler.requests.count == count && f.scheduler.cancellations.isEmpty)
    for grant in original { #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt) }
}

@Test @ItomaControlActor func aLateOldCandidateRegistrationCannotFailTheNewerAttempt() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    f.scheduler.hook = { request in
        guard request.commandID == id(100) else { return }
        try f.repository.write { tx in
            let stored = try tx.command(id(100))
            let command = try #require(stored)
            let uncertain = try Command(id: command.id, kind: command.kind, status: .uncertain, expectedPolicyRevision: command.expectedPolicyRevision,
                candidatePolicyRevision: command.candidatePolicyRevision, attempt: command.attempt)
            _ = try tx.recordCommand(uncertain, expected: command)
            let pending = try Command(id: command.id, kind: command.kind, status: .pending, expectedPolicyRevision: command.expectedPolicyRevision,
                candidatePolicyRevision: command.candidatePolicyRevision, attempt: command.attempt.next())
            _ = try tx.recordCommand(pending, expected: uncertain)
            let scheduling = try Command(id: command.id, kind: command.kind, status: .scheduling, expectedPolicyRevision: command.expectedPolicyRevision,
                candidatePolicyRevision: command.candidatePolicyRevision, attempt: pending.attempt)
            _ = try tx.recordCommand(scheduling, expected: pending)
            for n in 1...2 {
                let latest = try tx.latestRegistration(grantID: id(n))
                let generation = try #require(latest).generation.next()
                _ = try tx.recordRegistration(DeadlineRegistration(id: id(90_000 + n), grantID: id(n), commandID: command.id, generation: generation,
                    policyRevision: request.policyRevision, candidatePolicyRevision: request.candidatePolicyRevision, scheduledFor: request.scheduledFor, status: .preparing))
            }
        }
        f.scheduler.response = .rejected(.registrationFailure)
    }
    let result = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation)
    #expect(result.disposition == .requiresRecovery)
    #expect(try f.repository.command(id(100))?.attempt.rawValue == 1)
    #expect(try f.repository.command(id(100))?.status == .scheduling)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
}

@Test @ItomaControlActor func removingTheFutureWinnerDoesNotExtendAlreadyShortenedGrants() async throws {
    let f = try Fixture(); defer { f.remove() }
    let original = try await twoGrants(f)
    _ = try candidate(f)
    let confirmed = try f.service.previewCandidate(commandID: id(100))
    _ = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmed)
    let snapshot = try f.repository.readSnapshot(), count = f.scheduler.requests.count
    let activeRule = snapshot.policy.rules.first { $0.id == id(1) }!
    let policy = try PolicySnapshot(revision: snapshot.policy.revision.next(), rules: [activeRule], priorityOrder: [activeRule.id])
    let command = try Command(id: id(101), kind: .commitPolicy, status: .pending, expectedPolicyRevision: snapshot.policy.revision,
        candidatePolicyRevision: policy.revision, attempt: AttemptNumber(0))
    let proposal = try PolicyCandidate(commandID: command.id, expectedRevision: snapshot.policy.revision, proposedPolicy: policy)
    _ = try f.repository.write { try $0.acceptCandidate(command: command, candidate: proposal, expectedSequence: snapshot.snapshotSequence) }
    _ = try await f.service.executeAcceptedCandidate(commandID: command.id)
    let deadline = try instant(43_380)
    #expect(f.scheduler.requests.count == count)
    for grant in original {
        let stored = try f.repository.grant(grant.id)?.grant
        #expect(stored?.effectiveExpiresAt == deadline && stored?.initialExpiresAt == grant.initialExpiresAt)
    }
}

@Test(arguments: [false, true]) @ItomaControlActor
func postOSContextFactsSurviveResultFailureEvenIfTheContextReturnsAndObservationWritesFail(transient: Bool) async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try await twoGrants(f); _ = try candidate(f, durationOnly: true)
    let confirmation = try f.service.previewCandidate(commandID: id(100))
    let changed = try TimeZoneID("Etc/GMT-1"), original = try TimeZoneID("UTC"), initial = f.restriction.plans.count
    f.restriction.hook = { _ in
        if f.restriction.plans.count == initial + 1 { f.contexts.zone = changed }
        else if transient { f.contexts.zone = original }
    }
    let trigger = transient
        ? "CREATE TRIGGER post_os_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applying\"')=0 BEGIN SELECT RAISE(ABORT,'fixture'); END"
        : "CREATE TRIGGER post_os_failure BEFORE UPDATE ON application_state WHEN instr(CAST(NEW.record AS TEXT),'\"status\":\"applied\"')>0 BEGIN SELECT RAISE(ABORT,'fixture'); END"
    #expect(try sql(f.url, trigger) == SQLITE_OK)
    let result = try await f.service.executeAcceptedCandidate(commandID: id(100), confirmation: confirmation)
    #expect(result.disposition == .uncertain)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    f.contexts.zone = original
    for n in 1...2 {
        let stored = try f.repository.grant(id(n))
        #expect(stored?.hasEnded == true && stored?.grant.status == .invalidated)
    }
    #expect(try f.repository.readSnapshot().application?.observation.status != .applied)
    #expect(f.scheduler.cancellations.isEmpty)
}
