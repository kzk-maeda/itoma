import CSQLite
import Foundation
import ItomaCore
import ItomaStorage
import Testing

private func id<Kind>(_ n: Int) -> EntityID<Kind> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private func time(_ clock: String) throws -> Instant { try Instant(#require(ISO8601DateFormatter().date(from: "2026-11-06T\(clock):00Z"))) }
private func context(_ clock: String = "12:00", activation: Activation = .enabled) throws -> EvaluationContext {
    try EvaluationContext(now: time(clock), timeZone: TimeZoneID("UTC"),
                          authorization: AuthorizationObservation(status: .approved, observedAt: time(clock)), activation: activation)
}
private func rule(_ number: Int = 1, start: Int = 540, end: Int = 1020) throws -> Rule {
    try Rule(id: id(number), version: RuleVersion(1), enabled: true, selectionRef: id(number),
             schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: start, endMinute: end, endDayOffset: .sameDay),
             unlockMode: number == 1 ? .reason : .unavailable)
}
private func policy(_ revision: Int64 = 0, high: Bool = false, duration: Int = 5) throws -> PolicySnapshot {
    try PolicySnapshot(revision: PolicyRevision(revision), rules: high ? [rule(), rule(2, start: 723, end: 780)] : [rule()],
                       priorityOrder: high ? [id(2), id(1)] : [id(1)], defaultUnlockDuration: UnlockDuration(minutes: duration))
}
private struct Fixture {
    let directory: URL
    let url: URL
    let repository: ControlRepository
    init(bothTargetsOverlap: Bool = false) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("control.sqlite")
        repository = try ControlRepository.create(at: url, initialPolicy: policy(), selections: [
            StoredSelection(selection: Selection(ref: id(1), targets: [id(1), id(2)]), opaquePayload: Data([1])),
            StoredSelection(selection: Selection(ref: id(2), targets: bothTargetsOverlap ? [id(1), id(2)] : [id(1)]), opaquePayload: Data([2]))
        ], activation: .enabled)
    }
    func remove() { try? repository.close(); try? FileManager.default.removeItem(at: directory) }
}
private func grantCommand(_ number: Int = 1) throws -> Command {
    try Command(id: id(number), kind: .requestTemporaryGrant, status: .pending, expectedPolicyRevision: PolicyRevision(0),
                attempt: AttemptNumber(0), reasonRef: id(100 + number))
}
private func state(_ command: Command, _ status: CommandStatus) throws -> Command {
    try Command(id: command.id, kind: command.kind, status: status, expectedPolicyRevision: command.expectedPolicyRevision,
                candidatePolicyRevision: command.candidatePolicyRevision, attempt: command.attempt, reasonRef: command.reasonRef)
}
private func state(_ grant: TemporaryGrant, _ status: GrantStatus, expiry: Instant? = nil, initial: Instant? = nil) throws -> TemporaryGrant {
    try TemporaryGrant(id: grant.id, commandID: grant.commandID, targetRef: grant.targetRef, occurrence: grant.occurrence,
                       acceptedAt: grant.acceptedAt, initialExpiresAt: initial ?? grant.initialExpiresAt,
                       effectiveExpiresAt: expiry ?? grant.effectiveExpiresAt, status: status)
}
private func request(_ f: Fixture, number: Int = 1, target: Int = 1) throws -> GrantRequest {
    let snapshot = try f.repository.readSnapshot()
    let evaluation = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection), context: context(), grants: [])
    return try GrantRequest(grantID: id(number), commandID: id(number), targetRef: id(target), expectedPolicyRevision: snapshot.policy.revision,
                            expectedOccurrence: #require(evaluation.rules.targets[id(target)]?.winner?.key), condition: UnlockCondition.reason("調べ物をする"))
}
private func accept(_ f: Fixture, number: Int = 1, target: Int = 1) throws -> GrantAcceptance {
    let input = try request(f, number: number, target: target)
    let sequence = try f.repository.readSnapshot().snapshotSequence
    return try f.repository.write { try $0.acceptGrant(command: grantCommand(number), request: input, context: context(), expectedSequence: sequence) }
}
private func registration(
    _ grant: TemporaryGrant, number: Int = 1, generation: Int64 = 0, command: CommandID? = nil,
    deadline: Instant? = nil, candidate: Int64? = nil
) throws -> DeadlineRegistration {
    try DeadlineRegistration(id: id(number), grantID: grant.id, commandID: command ?? grant.commandID,
                             generation: RegistrationGeneration(generation), policyRevision: PolicyRevision(0),
                             candidatePolicyRevision: candidate.map { try PolicyRevision($0) }, scheduledFor: deadline ?? grant.effectiveExpiresAt, status: .preparing)
}
private func state(_ value: DeadlineRegistration, _ status: DeadlineStatus, receipt: Bool = false, firedAt: Instant? = nil) throws -> DeadlineRegistration {
    try DeadlineRegistration(id: value.id, grantID: value.grantID, commandID: value.commandID, generation: value.generation,
                             policyRevision: value.policyRevision, candidatePolicyRevision: value.candidatePolicyRevision,
                             scheduledFor: value.scheduledFor, status: status,
                             receipt: receipt ? DeadlineReceipt(registrationID: value.id, generation: value.generation,
                                                                 scheduledFor: value.scheduledFor, acceptedAt: time("12:00")) : value.receipt,
                             firedAt: firedAt)
}
private func registered(_ f: Fixture, _ prepared: DeadlineRegistration) throws -> DeadlineRegistration {
    _ = try f.repository.write { try $0.recordRegistration(prepared) }
    let result = try state(prepared, .registered, receipt: true)
    return try f.repository.write { try $0.recordRegistration(result, expected: prepared) }
}
/// Synthetic adapter result for persistence tests; no actual OS restriction operation occurs.
private func active(_ f: Fixture, number: Int = 1, target: Int = 1, registrationNumber: Int? = nil) throws -> TemporaryGrant {
    let grant = try accept(f, number: number, target: target).grant
    let receipt = try registered(f, registration(grant, number: registrationNumber ?? number))
    let owner = try grantCommand(number), applying = try state(owner, .applying)
    let applyingGrant = try state(grant, .applying), activeGrant = try state(grant, .active)
    try f.repository.write {
        _ = try $0.recordCommand(applying, expected: owner)
        _ = try $0.recordGrant(applyingGrant, expected: grant, registrationID: receipt.id, context: context())
        _ = try $0.recordGrant(activeGrant, expected: applyingGrant, registrationID: receipt.id, context: context())
        _ = try $0.recordCommand(state(owner, .succeeded), expected: applying)
    }
    return activeGrant
}
private func edit(_ number: Int = 10, proposed: PolicySnapshot? = nil) throws -> (Command, PolicyCandidate) {
    let proposed = try proposed ?? policy(1, high: true)
    return try (Command(id: id(number), kind: .commitPolicy, status: .pending,
                        expectedPolicyRevision: PolicyRevision(proposed.revision.rawValue - 1), candidatePolicyRevision: proposed.revision,
                        attempt: AttemptNumber(0)),
                PolicyCandidate(commandID: id(number), expectedRevision: PolicyRevision(proposed.revision.rawValue - 1), proposedPolicy: proposed))
}
private func stage(_ f: Fixture, _ command: Command, _ candidate: PolicyCandidate) throws {
    let sequence = try f.repository.readSnapshot().snapshotSequence
    _ = try f.repository.write { try $0.acceptCandidate(command: command, candidate: candidate, expectedSequence: sequence) }
}
private func confirmation(_ f: Fixture, _ candidate: PolicyCandidate) throws -> PolicyEditAssessment {
    let snapshot = try f.repository.readSnapshot()
    let grants = try f.repository.unfinishedGrants().filter { !$0.hasEnded }.map(\.grant)
    return try GrantEditEvaluator.preview(candidate: candidate, activePolicy: snapshot.policy, selections: snapshot.selections.map(\.selection),
                                          context: context("12:01"), snapshotSequence: snapshot.snapshotSequence, grants: grants)
}
private func sql<T>(_ url: URL, _ body: (OpaquePointer) throws -> T) throws -> T {
    var connection: OpaquePointer?
    #expect(sqlite3_open_v2(url.path, &connection, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
    let db = try #require(connection); defer { sqlite3_close(db) }
    return try body(db)
}
private func execute(_ db: OpaquePointer, _ text: String) throws { #expect(sqlite3_exec(db, text, nil, nil, nil) == SQLITE_OK) }

@Test func oneTargetHasOneUnfinishedGrantAndRepeatedCommandsKeepTheirOriginalDeadline() throws {
    let f = try Fixture(); defer { f.remove() }
    let input = try request(f), result = try accept(f)
    let duplicate = try f.repository.write { try $0.acceptGrant(command: grantCommand(), request: input,
                                                               context: context("12:02"), expectedSequence: SnapshotSequence(0)) }
    #expect(duplicate.alreadyAccepted && duplicate.grant == result.grant)
    let overlapping = try accept(f, number: 2)
    #expect(overlapping.alreadyAccepted && overlapping.command.id == id(2) && overlapping.command.status == .superseded)
    #expect(try f.repository.grantForCommand(id(2))?.grant.id == result.grant.id)
    #expect(try f.repository.unfinishedGrants().count == 1)
    let unknown = try state(result.grant, .uncertain)
    _ = try f.repository.write { try $0.recordGrant(unknown, expected: result.grant) }
    #expect(try accept(f, number: 3).grant == unknown)
    #expect(unknown.effectiveExpiresAt == (try time("12:05")))
}

@Test func staleSecondWriterCannotInsertANewGrantForTheSameTarget() throws {
    let f = try Fixture(); defer { f.remove() }
    let other = try ControlRepository.open(at: f.url); defer { try? other.close() }
    let input = try request(f, number: 2), first = try accept(f)
    #expect(throws: StorageError.conflict) {
        try other.write { try $0.acceptGrant(command: grantCommand(2), request: input, context: context(), expectedSequence: SnapshotSequence(0)) }
    }
    let sequence = try other.readSnapshot().snapshotSequence
    let repeated = try other.write { try $0.acceptGrant(command: grantCommand(2), request: input, context: context(), expectedSequence: sequence) }
    #expect(repeated.grant == first.grant && repeated.alreadyAccepted)
    #expect(try other.unfinishedGrants().count == 1)
}

@Test func preparingMustBePersistedBeforeReceiptAndActiveNeedsRegisteredUnfiredDeadline() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try accept(f).grant, prepared = try registration(grant)
    #expect(throws: StorageError.conflict) { try f.repository.write { try $0.recordRegistration(state(prepared, .registered, receipt: true)) } }
    #expect(throws: StorageError.conflict) { try f.repository.write { try $0.recordGrant(state(grant, .active), expected: grant) } }
    let receipt = try registered(f, prepared)
    let owner = try grantCommand(), applying = try state(owner, .applying)
    _ = try f.repository.write { try $0.recordCommand(applying, expected: owner) }
    let fired = try state(receipt, .fired, firedAt: time("12:01"))
    _ = try f.repository.write { try $0.recordRegistration(fired, expected: receipt) }
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.recordGrant(state(grant, .applying), expected: grant, registrationID: receipt.id, context: context("12:01")) }
    }
    #expect(throws: StorageError.conflict) { try f.repository.write { try $0.recordRegistration(receipt, expected: fired) } }
    #expect(try f.repository.grant(grant.id)?.grant == grant)
}

@Test func genericGrantUpdatesCannotRewriteCapsOrPublishAnUnpreparedShortening() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try accept(f).grant
    let shorter = try grant.shortened(to: time("12:03"))
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.recordGrant(shorter, expected: grant) }
    }
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.recordGrant(state(grant, .pending, expiry: time("12:06"), initial: time("12:06")), expected: grant) }
    }
    #expect(try f.repository.grant(grant.id)?.grant.initialExpiresAt == (try time("12:05")))
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == (try time("12:05")))
}

@Test func newerPreparationMakesOldGenerationIneligibleAndLateOldCallbacksDoNotAlterTheGrant() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try accept(f).grant, old = try registered(f, registration(grant))
    let newer = try registration(grant, number: 2, generation: 1)
    _ = try f.repository.write { try $0.recordRegistration(newer) }
    let owner = try grantCommand()
    _ = try f.repository.write { try $0.recordCommand(state(owner, .applying), expected: owner) }
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.recordGrant(state(grant, .applying), expected: grant, registrationID: old.id, context: context()) }
    }
    let current = try state(newer, .registered, receipt: true)
    _ = try f.repository.write { try $0.recordRegistration(current, expected: newer) }
    let applying = try state(grant, .applying)
    _ = try f.repository.write { try $0.recordGrant(applying, expected: grant, registrationID: current.id, context: context()) }
    let obsolete = try state(old, .obsolete, firedAt: time("12:01"))
    _ = try f.repository.write { try $0.recordRegistration(obsolete, expected: old) }
    #expect(try f.repository.grant(grant.id)?.grant == applying)
    #expect(try f.repository.registrations(grantID: grant.id).count == 2)
}

@Test func endedGrantCannotReturnThroughAnUncertainReblockState() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f), invalid = try state(grant, .invalidated)
    _ = try f.repository.write { try $0.recordGrant(invalid, expected: grant) }
    let pending = try state(invalid, .reblockPending)
    _ = try f.repository.write { try $0.recordGrant(pending, expected: invalid) }
    let unknown = try state(pending, .uncertain)
    _ = try f.repository.write { try $0.recordGrant(unknown, expected: pending) }
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.recordGrant(state(unknown, .applying), expected: unknown, registrationID: id(1), context: context("12:01")) }
    }
    #expect(try accept(f, number: 2).grant == unknown)
    let reconciled = try state(unknown, .reconciled)
    _ = try f.repository.write { try $0.recordGrant(reconciled, expected: unknown) }
    #expect(try accept(f, number: 2).alreadyAccepted)
    #expect(!(try accept(f, number: 3)).alreadyAccepted)
    #expect(throws: StorageError.conflict) { try f.repository.write { try $0.recordGrant(unknown, expected: reconciled) } }
}

@Test func pauseAndResumeInvalidatesPreviousGrantsWithoutChangingThePolicy() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f)
    let before = try f.repository.readSnapshot()
    let paused = try f.repository.setActivation(.paused, expectedSequence: before.snapshotSequence)
    #expect(paused.policy == before.policy)
    #expect(try f.repository.grant(grant.id)?.hasEnded == true)
    _ = try f.repository.setActivation(.enabled, expectedSequence: paused.snapshotSequence)
    #expect(try f.repository.grant(grant.id)?.grant.status == .invalidated)
}

@Test func R11ShorteningRequiresConfirmationAndCandidateBoundReceiptAndCommitsAtomically() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f), (owner, candidate) = try edit()
    let confirmed = try confirmation(f, candidate)
    try stage(f, owner, candidate)
    let short = try grant.shortened(to: time("12:03"))
    let receipt = try registered(f, registration(grant, number: 2, generation: 1, command: owner.id, deadline: short.effectiveExpiresAt, candidate: 1))
    let change = RegisteredGrantChange(expected: grant, updated: short, registrationID: receipt.id)
    try f.repository.write {
        let applying = try state(owner, .applying)
        _ = try $0.recordCommand(applying, expected: owner)
        _ = try $0.activateCandidate(commandID: owner.id, expectedSequence: $0.snapshot().snapshotSequence,
                                     context: context("12:01"), confirmation: confirmed, grantChanges: [change])
        _ = try $0.recordCommand(state(owner, .succeeded), expected: applying)
    }
    #expect(try f.repository.readSnapshot().policy == candidate.proposedPolicy)
    #expect(try f.repository.grant(grant.id)?.grant == short)
    #expect(short.initialExpiresAt == (try time("12:05")))
    let (remove, removed) = try edit(11, proposed: policy(2))
    try stage(f, remove, removed)
    try f.repository.write {
        _ = try $0.recordCommand(state(remove, .applying), expected: remove)
        _ = try $0.activateCandidate(commandID: remove.id, expectedSequence: $0.snapshot().snapshotSequence, context: context("12:02"))
    }
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == (try time("12:03")))
}

@Test(arguments: [DeadlineStatus.preparing, .failed, .unknown])
func missingReceiptKeepsOldPolicyAndExpiryAndCandidateUnreflected(status: DeadlineStatus) throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f), (owner, candidate) = try edit(), confirmed = try confirmation(f, candidate)
    try stage(f, owner, candidate)
    let prepared = try registration(grant, number: 2, generation: 1, command: owner.id, deadline: time("12:03"), candidate: 1)
    _ = try f.repository.write { try $0.recordRegistration(prepared) }
    if status != .preparing { _ = try f.repository.write { try $0.recordRegistration(state(prepared, status), expected: prepared) } }
    let before = try f.repository.readSnapshot()
    let change = try RegisteredGrantChange(expected: grant, updated: grant.shortened(to: time("12:03")), registrationID: prepared.id)
    #expect(throws: StorageError.conflict) {
        try f.repository.write {
            _ = try $0.recordCommand(state(owner, .applying), expected: owner)
            _ = try $0.activateCandidate(commandID: owner.id, expectedSequence: $0.snapshot().snapshotSequence,
                                         context: context("12:01"), confirmation: confirmed, grantChanges: [change])
        }
    }
    #expect(try f.repository.readSnapshot() == before)
    #expect(try f.repository.grant(grant.id)?.grant == grant)
    #expect(try f.repository.command(owner.id)?.status == .pending)
}

@Test func editCannotOmitAffectedGrantsOrReuseConfirmationAtTheSwitchBoundary() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f), (owner, candidate) = try edit(), confirmed = try confirmation(f, candidate)
    try stage(f, owner, candidate)
    let receipt = try registered(f, registration(grant, number: 2, generation: 1, command: owner.id, deadline: time("12:03"), candidate: 1))
    _ = try f.repository.write { try $0.recordCommand(state(owner, .applying), expected: owner) }
    let before = try f.repository.readSnapshot()
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.activateCandidate(commandID: owner.id, expectedSequence: before.snapshotSequence,
                                                          context: context("12:01"), confirmation: confirmed) }
    }
    let change = try RegisteredGrantChange(expected: grant, updated: grant.shortened(to: time("12:03")), registrationID: receipt.id)
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.activateCandidate(commandID: owner.id, expectedSequence: before.snapshotSequence,
                                                          context: context("12:01"), grantChanges: [change]) }
    }
    #expect(throws: StorageError.conflict) {
        try f.repository.write { try $0.activateCandidate(commandID: owner.id, expectedSequence: before.snapshotSequence,
                                                          context: context("12:03"), confirmation: confirmed, grantChanges: [change]) }
    }
    #expect(try f.repository.readSnapshot() == before)
}

@Test func failureForSecondGrantRollsBackTheFirstShorteningAsWell() throws {
    let f = try Fixture(bothTargetsOverlap: true); defer { f.remove() }
    let first = try active(f), second = try active(f, number: 3, target: 2)
    let (owner, candidate) = try edit(), confirmed = try confirmation(f, candidate)
    try stage(f, owner, candidate)
    let good = try registered(f, registration(first, number: 2, generation: 1, command: owner.id, deadline: time("12:03"), candidate: 1))
    let bad = try registration(second, number: 4, generation: 1, command: owner.id, deadline: time("12:03"), candidate: 1)
    _ = try f.repository.write { try $0.recordRegistration(bad) }
    _ = try f.repository.write { try $0.recordRegistration(state(bad, .failed), expected: bad) }
    let changes = try [RegisteredGrantChange(expected: first, updated: first.shortened(to: time("12:03")), registrationID: good.id),
                       RegisteredGrantChange(expected: second, updated: second.shortened(to: time("12:03")), registrationID: bad.id)]
    #expect(throws: StorageError.conflict) {
        try f.repository.write {
            _ = try $0.recordCommand(state(owner, .applying), expected: owner)
            _ = try $0.activateCandidate(commandID: owner.id, expectedSequence: $0.snapshot().snapshotSequence,
                                         context: context("12:01"), confirmation: confirmed, grantChanges: changes)
        }
    }
    #expect(try f.repository.grant(first.id)?.grant == first)
    #expect(try f.repository.grant(second.id)?.grant == second)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
}

@Test func defaultDurationEditDoesNotExtendExistingGrantOrRequireAnotherReceipt() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f), (owner, candidate) = try edit(proposed: policy(1, duration: 10))
    try stage(f, owner, candidate)
    try f.repository.write {
        _ = try $0.recordCommand(state(owner, .applying), expected: owner)
        _ = try $0.activateCandidate(commandID: owner.id, expectedSequence: $0.snapshot().snapshotSequence, context: context("12:01"))
    }
    #expect(try f.repository.grant(grant.id)?.grant == grant)
    #expect(try f.repository.registrations(grantID: grant.id).count == 1)
}

@Test func reservationFlagCorruptionCannotHideAnUnfinishedGrantAndAcceptAnotherOne() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try accept(f).grant
    try sql(f.url) { try execute($0, "UPDATE grants SET reserved=0") }
    #expect(throws: StorageError.corrupt) { try f.repository.unfinishedGrants() }
    #expect(throws: StorageError.corrupt) { try accept(f, number: 2) }
    try sql(f.url) { try execute($0, "UPDATE grants SET reserved=1") }
    #expect(try f.repository.grant(grant.id)?.grant == grant)
    #expect(try f.repository.command(id(2)) == nil)
}

@Test func grantReceiptAndOccurrenceRoundTripAndSchemaTwoMigrationPreservesCommands() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f)
    try f.repository.close()
    let reopened = try ControlRepository.open(at: f.url)
    #expect(try reopened.grant(grant.id)?.grant == grant)
    #expect(try reopened.registration(id(1))?.receipt?.scheduledFor == grant.effectiveExpiresAt)
    try reopened.close()
    let empty = try Fixture(); defer { empty.remove() }
    try empty.repository.close()
    try sql(empty.url) { try execute($0, "DROP TABLE history_outbox; DROP TABLE history_event_ids; DROP TABLE history_state; DROP TABLE registrations; DROP TABLE command_grant_results; DROP TABLE grants; ALTER TABLE policy_candidates DROP COLUMN activated_revision; PRAGMA user_version=2") }
    #expect(throws: StorageError.unsupportedSchema(2)) { try ControlRepository.open(at: empty.url) }
    let migrated = try ControlRepository.migrate(at: empty.url)
    #expect(try migrated.unfinishedGrants().isEmpty)
    #expect(try migrated.readSnapshot().policy == policy())
    try migrated.close()
}

@Test func aJoinedCommandCannotBecomeANewGrantWhenItsOriginalOwnerExpires() throws {
    let f = try Fixture(); defer { f.remove() }
    let first = try accept(f).grant, input = try request(f, number: 2)
    let joined = try accept(f, number: 2)
    #expect(joined.command.status == .superseded && joined.grant.id == first.id)
    let expired = try state(first, .expired)
    _ = try f.repository.write { try $0.recordGrant(expired, expected: first) }
    let sequence = try f.repository.readSnapshot().snapshotSequence
    let repeated = try f.repository.write {
        try $0.acceptGrant(command: grantCommand(2), request: input, context: context("12:06"), expectedSequence: sequence)
    }
    #expect(repeated.alreadyAccepted && repeated.command.id == id(2))
    let originalDeadline = try time("12:05")
    #expect(repeated.grant.id == first.id && repeated.grant.effectiveExpiresAt == originalDeadline)
    #expect(try f.repository.grant(id(2)) == nil)
    #expect(try f.repository.readSnapshot().snapshotSequence == sequence)
}

@Test(arguments: [GrantStatus.uncertain, .pending, .scheduling, .failed])
func loweringTheStatusCannotBypassTheRegisteredShorteningPath(status: GrantStatus) throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f)
    let changed = try state(grant, status, expiry: time("12:03"))
    #expect(throws: StorageError.conflict) { try f.repository.write { try $0.recordGrant(changed, expected: grant) } }
    #expect(try f.repository.grant(grant.id)?.grant == grant)
    #expect(try f.repository.registration(id(1))?.scheduledFor == (try time("12:05")))
}

@Test(arguments: [(DeadlineStatus.registered, true), (.unknown, true), (.failed, true), (.preparing, true),
                  (.fired, true), (.fired, false), (.obsolete, false)])
func preparingAndReceiptCannotBePersistedInTheSameUncommittedScope(example: (DeadlineStatus, Bool)) throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try accept(f).grant, prepared = try registration(grant)
    let observed = try state(prepared, example.0, receipt: example.1,
                             firedAt: [.fired, .obsolete].contains(example.0) ? time("12:01") : nil)
    #expect(throws: StorageError.conflict) {
        try f.repository.write {
            _ = try $0.recordRegistration(prepared)
            _ = try $0.recordRegistration(observed, expected: prepared)
        }
    }
    #expect(try f.repository.registration(prepared.id) == nil)
    #expect(try f.repository.grant(grant.id)?.grant == grant)
}

@Test func receiptMustCommitBeforeTheScopeThatAppliesTheGrant() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try accept(f).grant, prepared = try registration(grant), owner = try grantCommand()
    _ = try f.repository.write { try $0.recordRegistration(prepared) }
    #expect(throws: StorageError.conflict) {
        try f.repository.write {
            _ = try $0.recordRegistration(state(prepared, .registered, receipt: true), expected: prepared)
            _ = try $0.recordCommand(state(owner, .applying), expected: owner)
            _ = try $0.recordGrant(state(grant, .applying), expected: grant, registrationID: prepared.id, context: context())
        }
    }
    #expect(try f.repository.registration(prepared.id) == prepared)
    #expect(try f.repository.command(owner.id) == owner)
    #expect(try f.repository.grant(grant.id)?.grant == grant)
}

@Test func receiptMustCommitBeforeTheScopeThatActivatesAShortenedCandidate() throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try active(f), (owner, candidate) = try edit(), confirmed = try confirmation(f, candidate)
    try stage(f, owner, candidate)
    let prepared = try registration(grant, number: 2, generation: 1, command: owner.id, deadline: time("12:03"), candidate: 1)
    _ = try f.repository.write { try $0.recordRegistration(prepared) }
    let change = try RegisteredGrantChange(expected: grant, updated: grant.shortened(to: time("12:03")), registrationID: prepared.id)
    #expect(throws: StorageError.conflict) {
        try f.repository.write {
            _ = try $0.recordRegistration(state(prepared, .registered, receipt: true), expected: prepared)
            _ = try $0.recordCommand(state(owner, .applying), expected: owner)
            _ = try $0.activateCandidate(commandID: owner.id, expectedSequence: $0.snapshot().snapshotSequence,
                                         context: context("12:01"), confirmation: confirmed, grantChanges: [change])
        }
    }
    #expect(try f.repository.registration(prepared.id) == prepared)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    #expect(try f.repository.grant(grant.id)?.grant == grant)
}
