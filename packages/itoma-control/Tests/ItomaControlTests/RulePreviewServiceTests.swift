import Foundation
import ItomaCore
import ItomaStorage
@testable import ItomaControl
import Testing

private func id<Kind>(_ n: Int) -> EntityID<Kind> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!) }
private func raw(_ n: Int) -> String { String(format: "00000000-0000-0000-0000-%012d", n) }

@ItomaControlActor private func input(_ f: Fixture, id rawID: String? = raw(1),
    revision: String? = nil, selection: Int = 1, days: [Int] = Array(1...7), start: Int = 540,
    end: Int = 1020, nextDay: Bool = false, enabled: Bool = true, remove: Bool? = nil) throws -> RulePreviewInput {
    try RulePreviewInput(id: rawID, expectedRevision: revision ?? String(f.repository.readSnapshot().policy.revision.rawValue),
        selectionRef: raw(selection), weekdays: days, startMinute: start, endMinute: end,
        nextDay: nextDay, enabled: enabled, remove: remove)
}

@ItomaControlActor private func preview(_ service: RulePreviewService, _ f: Fixture, _ input: RulePreviewInput,
    previous: PolicyCandidate? = nil, ref: String? = nil, otherFlow: Bool = false,
    confirmed: Set<SelectionRef> = []) throws -> RulePreviewResult {
    try service.preview(input, confirmedSelections: confirmed, previousCandidate: previous,
        previousRef: ref, anotherFlowOwnsCandidate: otherFlow) {
        try f.service.previewCandidate(commandID: $0.commandID)
    }
}

@ItomaControlActor private func requireCandidate(_ result: RulePreviewResult) throws -> (PolicyCandidate, PolicyEditAssessment) {
    guard case let .confirmation(candidate, assessment) = result else {
        Issue.record("Expected a changed policy candidate"); throw CommandServiceError.invalidState
    }
    return (candidate, assessment)
}

@Test(arguments: [Array(1...7), Array((1...7).reversed()), [7, 1, 2, 3, 4, 5, 6, 1]]) @ItomaControlActor
func unchangedRulePreviewPreservesActiveGrantAndSkipsAllEffectPorts(days: [Int]) async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(); _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    let before = try f.repository.readSnapshot(), grant = try f.repository.grant(id(1))
    let requests = f.scheduler.requests, plans = f.restriction.plans
    var identifiers = 0, assessments = 0
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts,
        makeRuleID: { identifiers += 1; return id(500) }, makeCommandID: { identifiers += 1; return id(501) })
    let result = try service.preview(input(f, days: days), confirmedSelections: []) { _ in
        assessments += 1; throw CommandServiceError.invalidState
    }
    guard case let .unchanged(selectionRef) = result else { Issue.record("Expected native no-change"); return }
    #expect(selectionRef == before.policy.rules[0].selectionRef)
    #expect(try f.repository.readSnapshot() == before)
    #expect(try f.repository.grant(id(1)) == grant)
    #expect(try f.repository.command(id(501)) == nil)
    #expect(identifiers == 0 && assessments == 0)
    #expect(f.scheduler.requests == requests && f.scheduler.cancellations.isEmpty && f.restriction.plans == plans)
    let reopened = try ControlRepository.open(at: f.url); defer { try? reopened.close() }
    #expect(try reopened.readSnapshot() == before && reopened.grant(id(1)) == grant)
}

@Test @ItomaControlActor func repickedImmutableTargetsKeepTheEntireOldRule() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(); _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    var before = try f.repository.readSnapshot()
    before = try f.repository.putSelection(StoredSelection(selection: Selection(ref: id(2), targets: [id(2), id(1)]),
        opaquePayload: Data([2])), expectedSequence: before.snapshotSequence)
    let grant = try f.repository.grant(id(1)), requests = f.scheduler.requests
    let result = try preview(RulePreviewService(repository: f.repository, contexts: f.contexts), f, input(f, selection: 2), confirmed: [id(2)])
    guard case let .unchanged(selectionRef) = result else { Issue.record("Equal immutable targets should be unchanged"); return }
    #expect(selectionRef == id(1))
    #expect(try f.repository.readSnapshot() == before && f.repository.grant(id(1)) == grant)
    #expect(f.scheduler.requests == requests)
}

@Test @ItomaControlActor func revertingAPreviewCancelsOnlyItsOwnedPendingCommandWithoutCreatingAnother() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(); _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    let before = try f.repository.readSnapshot(), grant = try f.repository.grant(id(1))
    let requests = f.scheduler.requests, planCount = f.restriction.plans.count
    var commands = 0
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts,
        makeCommandID: { commands += 1; return id(500 + commands) })
    let (pending, assessment) = try requireCandidate(preview(service, f, input(f, start: 541)))
    #expect(assessment.impacts.contains { $0.kind == .invalidate })
    let result = try preview(service, f, input(f), previous: pending, ref: pending.commandID.rawValue.uuidString)
    guard case .unchanged = result else { Issue.record("Reverted draft should be unchanged"); return }
    #expect(commands == 1)
    #expect(try f.repository.command(pending.commandID)?.status == .cancelled)
    #expect(try f.repository.readSnapshot().policy == before.policy)
    #expect(try f.repository.grant(id(1)) == grant)
    #expect(f.scheduler.requests == requests && f.scheduler.cancellations.isEmpty && f.restriction.plans.count == planCount)
    #expect(throws: StorageError.conflict) {
        try preview(service, f, input(f), previous: pending, ref: pending.commandID.rawValue.uuidString)
    }
    #expect(try f.repository.command(pending.commandID)?.status == .cancelled)
}

@Test(arguments: ["time", "day", "next-day", "enabled", "targets", "delete", "new"]) @ItomaControlActor
func changedRuleSavesStillProduceVersionedImpactConfirmation(kind: String) async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(); _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    var before = try f.repository.readSnapshot()
    before = try f.repository.putSelection(StoredSelection(selection: Selection(ref: id(2), targets: [id(1), id(3)]),
        opaquePayload: Data([2])), expectedSequence: before.snapshotSequence)
    let draft: RulePreviewInput
    switch kind {
    case "time": draft = try input(f, start: 541)
    case "day": draft = try input(f, days: [1, 2])
    case "next-day": draft = try input(f, end: 120, nextDay: true)
    case "enabled": draft = try input(f, enabled: false)
    case "targets": draft = try input(f, selection: 2)
    case "delete": draft = try input(f, remove: true)
    default: draft = try input(f, id: nil)
    }
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts,
        makeRuleID: { id(9) }, makeCommandID: { id(500) })
    let (candidate, assessment) = try requireCandidate(preview(service, f, draft))
    #expect(try candidate.proposedPolicy.revision == before.policy.revision.next())
    if kind == "delete" { #expect(candidate.proposedPolicy.rules.isEmpty) }
    else if kind == "new" { #expect(candidate.proposedPolicy.rules.count == 2) }
    else { #expect(try candidate.proposedPolicy.rules[0].version == before.policy.rules[0].version.next()) }
    if kind != "new" { #expect(assessment.impacts.contains { $0.kind == .invalidate }) }
    #expect(try f.repository.readSnapshot().policy == before.policy)
    #expect(try f.repository.command(candidate.commandID)?.status == .pending)
    // Preview remains distinct from confirmation/registration/application.
    #expect(f.scheduler.requests.count == 1 && f.restriction.plans.count == 1)
}

@Test(arguments: ["revision", "malformed-id", "missing-id", "selection", "weekday", "minute", "interval", "foreign-ref", "cancelled-ref"]) @ItomaControlActor
func invalidOrStalePreviewCannotCancelThePreviouslyAcceptedCandidate(kind: String) throws {
    let f = try Fixture(); defer { f.remove() }
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts, makeCommandID: { id(500) })
    let (pending, _) = try requireCandidate(preview(service, f, input(f, start: 541)))
    if kind == "cancelled-ref" { try service.cancel(pending, ref: pending.commandID.rawValue.uuidString) }
    let before = try f.repository.readSnapshot(), command = try f.repository.command(pending.commandID)
    let draft: RulePreviewInput
    switch kind {
    case "revision": draft = try input(f, revision: "99")
    case "malformed-id": draft = try input(f, id: "invalid")
    case "missing-id": draft = try input(f, id: raw(99))
    case "selection": draft = try input(f, selection: 99)
    case "weekday": draft = try input(f, days: [0])
    case "minute": draft = try input(f, start: 1440)
    case "interval": draft = try input(f, end: 540)
    default: draft = try input(f)
    }
    #expect(throws: (any Error).self) {
        try preview(service, f, draft, previous: pending, ref: kind == "foreign-ref" ? raw(999) : pending.commandID.rawValue.uuidString)
    }
    #expect(try f.repository.readSnapshot() == before && f.repository.command(pending.commandID) == command)
    #expect(f.scheduler.requests.isEmpty && f.restriction.plans.isEmpty)
}

@Test @ItomaControlActor func anotherFlowsCandidateIsUntouchedByNoChangeAndCannotBeReplaced() throws {
    let f = try Fixture(); defer { f.remove() }
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts, makeCommandID: { id(500) })
    let (other, _) = try requireCandidate(preview(service, f, input(f, start: 541)))
    let before = try f.repository.readSnapshot(), command = try f.repository.command(other.commandID)
    let result = try preview(service, f, input(f), otherFlow: true)
    guard case .unchanged = result else { Issue.record("Unchanged save should preserve the other candidate"); return }
    #expect(throws: StorageError.conflict) { try preview(service, f, input(f, start: 542), otherFlow: true) }
    #expect(throws: StorageError.conflict) { try preview(service, f, input(f), ref: other.commandID.rawValue.uuidString, otherFlow: true) }
    #expect(try f.repository.readSnapshot() == before && f.repository.command(other.commandID) == command)
}

@Test(arguments: [CommandStatus.failed, .uncertain]) @ItomaControlActor
func unactivatedFailedPreviewCanBeExplicitlyAbandoned(status: CommandStatus) throws {
    let f = try Fixture(); defer { f.remove() }
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts, makeCommandID: { id(500) })
    let (pending, _) = try requireCandidate(preview(service, f, input(f, start: 541)))
    try f.repository.write { tx in
        let saved = try tx.command(pending.commandID)
        let original = try #require(saved)
        _ = try tx.recordCommand(Command(id: original.id, kind: original.kind, status: status,
            expectedPolicyRevision: original.expectedPolicyRevision, candidatePolicyRevision: original.candidatePolicyRevision,
            attempt: original.attempt), expected: original)
    }
    let policy = try f.repository.readSnapshot().policy
    let result = try preview(service, f, input(f), previous: pending, ref: pending.commandID.rawValue.uuidString)
    guard case .unchanged = result else { Issue.record("Abandoning a failed preview should retain the active rule"); return }
    #expect(try f.repository.command(pending.commandID)?.status == .cancelled)
    #expect(try f.repository.readSnapshot().policy == policy)
    #expect(f.scheduler.requests.isEmpty && f.restriction.plans.isEmpty)
}

@Test @ItomaControlActor func aFreshRequestCanAbandonItsOwnStaleBasePreviewAfterAnotherPolicyCommits() async throws {
    let f = try Fixture(); defer { f.remove() }
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts, makeCommandID: { id(500) })
    let (pending, _) = try requireCandidate(preview(service, f, input(f, start: 541)))
    let other = RulePreviewService(repository: f.repository, contexts: f.contexts, makeCommandID: { id(600) })
    let (changed, confirmation) = try requireCandidate(preview(other, f, input(f, start: 542)))
    _ = try await f.service.executeAcceptedCandidate(commandID: changed.commandID, confirmation: confirmation)
    let before = try f.repository.readSnapshot()
    #expect(before.policy == changed.proposedPolicy)
    #expect(throws: StorageError.conflict) {
        try preview(service, f, input(f, revision: "0", start: 542), previous: pending, ref: pending.commandID.rawValue.uuidString)
    }
    #expect(try f.repository.command(pending.commandID)?.status == .pending)
    let result = try preview(service, f, input(f, start: 542), previous: pending, ref: pending.commandID.rawValue.uuidString)
    guard case .unchanged = result else { Issue.record("Fresh current input should keep the current policy"); return }
    #expect(try f.repository.command(pending.commandID)?.status == .cancelled)
    #expect(try f.repository.readSnapshot().policy == before.policy)
}

@Test @ItomaControlActor func assessmentFailurePreservesTheAcceptedRefForExplicitRepreviewOrDiscard() throws {
    let f = try Fixture(); defer { f.remove() }
    var commands = 0
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts,
        makeCommandID: { commands += 1; return id(500 + commands) })
    let (previous, _) = try requireCandidate(preview(service, f, input(f, start: 541)))
    #expect(throws: CommandServiceError.invalidState) {
        try service.preview(input(f, start: 542), confirmedSelections: [], previousCandidate: previous,
            previousRef: previous.commandID.rawValue.uuidString) { _ in throw CommandServiceError.invalidState }
    }
    let accepted = try #require(service.acceptedCandidate)
    #expect(accepted.commandID != previous.commandID)
    #expect(try f.repository.command(previous.commandID)?.status == .cancelled)
    #expect(try f.repository.command(accepted.commandID)?.status == .pending)
    let result = try preview(service, f, input(f), previous: accepted, ref: accepted.commandID.rawValue.uuidString)
    guard case .unchanged = result else { Issue.record("An assessment failure must leave an ownable intent"); return }
    #expect(commands == 2 && service.acceptedCandidate == nil)
    #expect(try f.repository.command(accepted.commandID)?.status == .cancelled)
    #expect(try f.repository.readSnapshot().policy.revision.rawValue == 0)
    #expect(f.scheduler.requests.isEmpty && f.restriction.plans.isEmpty)
}

@Test @ItomaControlActor func supersededCommandReleasesItsCompletedOwnershipForANewChangedPreview() async throws {
    let f = try Fixture(); defer { f.remove() }
    var commands = 0
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts,
        makeCommandID: { commands += 1; return id(500 + commands) })
    let (pending, originalConfirmation) = try requireCandidate(preview(service, f, input(f, start: 541)))
    let other = RulePreviewService(repository: f.repository, contexts: f.contexts, makeCommandID: { id(600) })
    let (changed, confirmation) = try requireCandidate(preview(other, f, input(f, start: 542)))
    _ = try await f.service.executeAcceptedCandidate(commandID: changed.commandID, confirmation: confirmation)
    _ = try await f.service.executeAcceptedCandidate(commandID: pending.commandID, confirmation: originalConfirmation)
    #expect(try f.repository.command(pending.commandID)?.status == .superseded)
    let before = try f.repository.readSnapshot()
    let releasable = try service.canReleaseOwnership(of: pending)
    #expect(releasable)
    // The production host uses this durable decision to release its completed local cache.
    let (next, _) = try requireCandidate(preview(service, f, input(f, start: 543), otherFlow: !releasable))
    #expect(next.expectedRevision == before.policy.revision)
    #expect(try f.repository.readSnapshot().policy == before.policy)
    #expect(try f.repository.command(pending.commandID)?.status == .superseded)
    #expect(try f.repository.command(next.commandID)?.status == .pending)
}

@Test(arguments: [CommandStatus.pending, .failed, .uncertain, .scheduling, .applying]) @ItomaControlActor
func liveOrUnactivatedCandidateOwnershipIsRetained(status: CommandStatus) throws {
    let f = try Fixture(); defer { f.remove() }
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts, makeCommandID: { id(500) })
    let (pending, _) = try requireCandidate(preview(service, f, input(f, start: 541)))
    if status != .pending {
        try f.repository.write { tx in
            let saved = try tx.command(pending.commandID), command = try #require(saved)
            _ = try tx.recordCommand(Command(id: command.id, kind: command.kind, status: status,
                expectedPolicyRevision: command.expectedPolicyRevision, candidatePolicyRevision: command.candidatePolicyRevision,
                attempt: command.attempt), expected: command)
        }
    }
    let before = try f.repository.readSnapshot(), command = try f.repository.command(pending.commandID)
    #expect(try !service.canReleaseOwnership(of: pending))
    #expect(try f.repository.readSnapshot() == before && f.repository.command(pending.commandID) == command)
    #expect(throws: StorageError.conflict) { try preview(service, f, input(f, start: 542), otherFlow: true) }
    #expect(f.scheduler.requests.isEmpty && f.restriction.plans.isEmpty)
}

@Test @ItomaControlActor func activatedFailureCanReleaseAnOldCacheWithoutDiscardingUnfinishedWork() async throws {
    let f = try Fixture(); defer { f.remove() }
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts, makeCommandID: { id(500) })
    let (pending, confirmation) = try requireCandidate(preview(service, f, input(f, start: 541)))
    f.restriction.response = .failed(.osOperationFailure)
    _ = try await f.service.executeAcceptedCandidate(commandID: pending.commandID, confirmation: confirmation)
    #expect(try f.repository.command(pending.commandID)?.status == .failed)
    let before = try f.repository.readSnapshot()
    #expect(try service.canReleaseOwnership(of: pending))
    #expect(try f.repository.readSnapshot() == before)
}

@Test(arguments: [AuthorizationStatus.denied, .unknown]) @ItomaControlActor
func noChangeRequiresCurrentAuthorizationWithoutCreatingAnIntent(status: AuthorizationStatus) throws {
    let f = try Fixture(); defer { f.remove() }
    f.contexts.authorization = status
    let before = try f.repository.readSnapshot()
    #expect(throws: CommandServiceError.authorizationRequired) {
        try preview(RulePreviewService(repository: f.repository, contexts: f.contexts), f, input(f))
    }
    #expect(try f.repository.readSnapshot() == before)
}

@Test @ItomaControlActor func reauthorizationRequiresFreshSelectionAndNeverResumesOnNoChange() async throws {
    let f = try Fixture(); defer { f.remove() }
    _ = try f.accept(); _ = try await f.service.executeAcceptedGrant(commandID: id(1))
    try f.service.recordAuthorizationDenial(observedAt: f.contexts.now)
    var before = try f.repository.readSnapshot()
    #expect(before.activation == .awaitingReauthorizationConfirmation)
    before = try f.repository.putSelection(StoredSelection(selection: Selection(ref: id(2), targets: [id(1), id(2)]),
        opaquePayload: Data([2])), expectedSequence: before.snapshotSequence)
    let grant = try f.repository.grant(id(1)), requests = f.scheduler.requests, plans = f.restriction.plans
    #expect(grant?.grant.status == .invalidated)
    let service = RulePreviewService(repository: f.repository, contexts: f.contexts)
    #expect(throws: RulePreviewError.invalidSelection) { try preview(service, f, input(f)) }
    #expect(throws: RulePreviewError.invalidSelection) { try preview(service, f, input(f, selection: 2), confirmed: [id(1)]) }
    let result = try preview(service, f, input(f, selection: 2), confirmed: [id(2)])
    guard case let .unchanged(selectionRef) = result else { Issue.record("Fresh reviewed selection should compare equal"); return }
    #expect(selectionRef == id(1)) // the host may transfer only this proved picker confirmation
    #expect(try f.repository.readSnapshot() == before)
    #expect(try f.repository.grant(id(1)) == grant)
    #expect(f.scheduler.requests == requests && f.restriction.plans == plans)
}
