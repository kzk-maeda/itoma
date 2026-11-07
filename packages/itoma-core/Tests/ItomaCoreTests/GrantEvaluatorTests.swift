import Foundation
import Testing
import ItomaCore

private func gid<Kind>(_ number: Int) -> EntityID<Kind> {
    EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!)
}

private func at(_ clock: String) throws -> Instant {
    try Instant(#require(ISO8601DateFormatter().date(from: "2026-11-06T\(clock):00Z")))
}

private func context(
    _ clock: String = "12:00", zone: String = "UTC", authorization: AuthorizationStatus = .approved,
    activation: Activation = .enabled
) throws -> EvaluationContext {
    try EvaluationContext(now: at(clock), timeZone: TimeZoneID(zone),
                          authorization: AuthorizationObservation(status: authorization, observedAt: at(clock)),
                          activation: activation)
}

private func rule(
    _ number: Int = 1, start: Int = 540, end: Int = 1020, version: Int64 = 1,
    mode: UnlockMode = .reason, enabled: Bool = true
) throws -> Rule {
    try Rule(id: gid(number), version: RuleVersion(version), enabled: enabled, selectionRef: gid(number),
             schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: start,
                                      endMinute: end, endDayOffset: .sameDay), unlockMode: mode)
}

private func policy(_ rules: [Rule]? = nil, revision: Int64 = 1, duration: Int = 5, order: [Int]? = nil) throws -> PolicySnapshot {
    let rules = try rules ?? [rule()]
    return try PolicySnapshot(revision: PolicyRevision(revision), rules: rules,
                              priorityOrder: order?.map { gid($0) } ?? rules.map(\.id),
                              defaultUnlockDuration: UnlockDuration(minutes: duration))
}

private func selections(_ policy: PolicySnapshot) -> [Selection] {
    policy.rules.map { Selection(ref: $0.selectionRef, targets: [gid(1), gid(2)]) }
}

private func propose(
    _ policy: PolicySnapshot, clock: String = "12:00", grantID: Int = 1, commandID: Int = 1,
    target: Int = 1, existing: [TemporaryGrant] = [], condition: UnlockCondition? = nil,
    selected: [Selection]? = nil, requestContext: EvaluationContext? = nil
) throws -> GrantRequestResult {
    let ctx = try requestContext ?? context(clock)
    let selected = selected ?? selections(policy)
    let evaluated = try GrantEvaluator.evaluate(policy: policy, selections: selected, context: ctx, grants: [])
    let occurrence = try #require(evaluated.rules.targets[gid(target)]?.winner?.key)
    let request = try GrantRequest(grantID: gid(grantID), commandID: gid(commandID), targetRef: gid(target),
                                   expectedPolicyRevision: policy.revision, expectedOccurrence: occurrence,
                                   condition: condition ?? UnlockCondition.reason("目的を決めて使う"))
    return try GrantEvaluator.propose(request, policy: policy, selections: selected, context: ctx, existingGrants: existing)
}

private func pending(_ snapshot: PolicySnapshot? = nil, target: Int = 1, id: Int = 1) throws -> TemporaryGrant {
    let p = try snapshot ?? policy()
    guard case let .proposed(grant) = try propose(p, grantID: id, commandID: id, target: target) else {
        throw TestFailure.expectedProposal
    }
    return grant
}

private enum TestFailure: Error { case expectedProposal }

private func recording(_ grant: TemporaryGrant, status: GrantStatus) throws -> TemporaryGrant {
    try TemporaryGrant(id: grant.id, commandID: grant.commandID, targetRef: grant.targetRef,
                       occurrence: grant.occurrence, acceptedAt: grant.acceptedAt,
                       initialExpiresAt: grant.initialExpiresAt, effectiveExpiresAt: grant.effectiveExpiresAt, status: status)
}

private func evaluate(
    _ policy: PolicySnapshot, grants: [TemporaryGrant], ctx: EvaluationContext? = nil, selected: [Selection]? = nil
) throws -> GrantEvaluation {
    try GrantEvaluator.evaluate(policy: policy, selections: selected ?? selections(policy),
                                context: ctx ?? context(), grants: grants)
}

private func candidate(_ proposed: PolicySnapshot) throws -> PolicyCandidate {
    try PolicyCandidate(commandID: gid(100), expectedRevision: PolicyRevision(1), proposedPolicy: proposed)
}

private func preview(_ proposed: PolicySnapshot, grants: [TemporaryGrant], clock: String = "12:01") throws -> PolicyEditAssessment {
    try GrantEditEvaluator.preview(candidate: candidate(proposed), activePolicy: policy(),
                                   selections: selections(proposed), context: context(clock),
                                   snapshotSequence: SnapshotSequence(10), grants: grants)
}

@Test func requestCreatesPendingDataAndOnlyTheChosenActiveTargetIsExempted() throws {
    let p = try policy(), grant = try pending(p)
    #expect(grant.status == .pending)
    #expect(grant.acceptedAt == (try at("12:00")))
    #expect(grant.initialExpiresAt == (try at("12:05")))
    #expect(grant.effectiveExpiresAt == grant.initialExpiresAt)
    let waiting = try evaluate(p, grants: [grant])
    #expect(waiting.desiredTargets == [gid(1), gid(2)])
    #expect(waiting.assessments.first?.remainingSeconds == 0)
    let active = try evaluate(p, grants: [recording(grant, status: .active)])
    #expect(active.desiredTargets == [gid(2)])
    #expect(active.assessments.first?.disposition == .effective)
    #expect(active.nextBoundary == grant.effectiveExpiresAt)
}

@Test func R05RequestIsCappedByFutureWinnerAndOccurrenceEnd() throws {
    let higher = try rule(2, start: 722, end: 780, mode: .unavailable)
    let p = try policy([rule(), higher], order: [2, 1])
    let grant = try pending(p)
    #expect(grant.initialExpiresAt == (try at("12:02")))
    let short = try pending(policy([rule(end: 721)]))
    #expect(short.initialExpiresAt == (try at("12:01")))
}

@Test(arguments: ["", " \n\t\r", "　\u{00a0}\n"])
func R08BlankReasonsAreRejectedWithoutRetainingTheirBody(text: String) {
    #expect(throws: GrantEvaluationError.emptyReason) { try UnlockCondition.reason(text) }
}

@Test func R08DummySelectionCancellationUnavailableModeAndDurationValidation() throws {
    #expect(throws: GrantEvaluationError.cancelledDummyPayment) { try UnlockCondition.dummyPayment(selectionConfirmed: false) }
    #expect(throws: ModelError.invalidUnlockDuration) { try UnlockDuration(minutes: 31) }
    let dummy = try policy([rule(mode: .dummyPayment)])
    #expect(throws: GrantEvaluationError.conditionMismatch) { try propose(dummy) }
    guard case .proposed = try propose(dummy, condition: UnlockCondition.dummyPayment(selectionConfirmed: true)) else {
        throw TestFailure.expectedProposal
    }
    #expect(throws: GrantEvaluationError.unlockUnavailable) { try propose(policy([rule(mode: .unavailable)])) }
    #expect(try UnlockCondition.reason(" \n目的のある利用\n ").mode == .reason)
}

@Test(arguments: [GrantStatus.pending, .scheduling, .applying, .active, .uncertain, .failed, .reblockPending])
func D03D11D12RepeatedRequestsKeepTheExistingRecordAndDeadline(status: GrantStatus) throws {
    let p = try policy(), grant = try recording(pending(p), status: status)
    let changedDefault = try policy(revision: 2, duration: 10)
    #expect(try propose(changedDefault, clock: "12:02", existing: [grant]) == .existing(grant))
    #expect(try propose(changedDefault, clock: "12:02", grantID: 2, commandID: 2, existing: [grant]) == .existing(grant))
    #expect(grant.effectiveExpiresAt == (try at("12:05")))
}

@Test func D04ElapsedTimeDoesNotRestartTheCountdown() throws {
    let p = try policy(), grant = try recording(pending(p), status: .active)
    let result = try evaluate(p, grants: [grant], ctx: context("12:02"))
    #expect(result.assessments.first?.remainingSeconds == 180)
    #expect(result.assessments.first?.grant == grant)
    #expect(result.nextBoundary == (try at("12:05")))
}

@Test(arguments: [GrantStatus.pending, .applying, .active, .uncertain])
func D05ExpiryPreventsLateApplicationAndOldCallbackRevival(status: GrantStatus) throws {
    let p = try policy(), grant = try recording(pending(p), status: status)
    let expired = try evaluate(p, grants: [grant], ctx: context("12:05"))
    let stored = try #require(expired.assessments.first?.grant)
    #expect(stored.status == .expired)
    #expect(expired.desiredTargets == [gid(1), gid(2)])
    let rolledBack = try evaluate(p, grants: [stored], ctx: context("12:04"))
    #expect(rolledBack.assessments.first?.disposition == .expired)
    #expect(rolledBack.desiredTargets == [gid(1), gid(2)])
    #expect(try propose(p, clock: "12:06", existing: [stored]) == .existing(stored)) // same command stays the same
    guard case let .proposed(new) = try propose(p, clock: "12:06", grantID: 2, commandID: 2, existing: [stored]) else {
        throw TestFailure.expectedProposal
    }
    #expect(new.acceptedAt == (try at("12:06"))) // a separate, explicit request
}

@Test func R04D07WinnerChangeInvalidatesLowerGrantAndNeverRestoresIt() throws {
    let original = try policy(), grant = try recording(pending(original), status: .active)
    let edited = try policy([rule(), rule(2, start: 722, end: 723, mode: .unavailable)], revision: 2, order: [2, 1])
    let result = try evaluate(edited, grants: [grant], ctx: context("12:02"))
    let assessment = try #require(result.assessments.first)
    #expect(assessment.reason == .winnerChanged)
    #expect(assessment.grant.status == .invalidated)
    #expect(result.desiredTargets == [gid(1), gid(2)])
    let returned = try evaluate(edited, grants: [assessment.grant], ctx: context("12:03"))
    #expect(returned.assessments.first?.disposition == .invalidated)
    #expect(returned.desiredTargets == [gid(1), gid(2)])
}

@Test(arguments: [AuthorizationStatus.unknown, .denied])
func authorizationLossPersistsInvalidationAcrossReauthorization(status: AuthorizationStatus) throws {
    let p = try policy(), grant = try recording(pending(p), status: .active)
    #expect(throws: GrantEvaluationError.authorizationRequired) { try propose(p, requestContext: context(authorization: status)) }
    let invalid = try #require(evaluate(p, grants: [grant], ctx: context(authorization: status)).assessments.first?.grant)
    #expect(invalid.status == .invalidated)
    let restored = try evaluate(p, grants: [invalid])
    #expect(restored.desiredTargets == [gid(1), gid(2)])
}

@Test(arguments: [Activation.paused, .awaitingReauthorizationConfirmation])
func noNewGrantOrAutomaticGrantResumeWithoutActivation(value: Activation) throws {
    let p = try policy(), grant = try recording(pending(p), status: .active)
    #expect(throws: GrantEvaluationError.activationRequired) { try propose(p, requestContext: context(activation: value)) }
    let result = try evaluate(p, grants: [grant], ctx: context(activation: value))
    #expect(result.assessments.first?.grant.status == .invalidated)
    #expect(result.desiredTargets.isEmpty) // gate only; not an instruction to remove OS settings
}

@Test func R10TimezoneAndClockChangesCannotExtendOrReviveGrants() throws {
    let p = try policy(), grant = try recording(pending(p), status: .active)
    let changedZone = try evaluate(p, grants: [grant], ctx: context(zone: "Etc/GMT-1"))
    let invalid = try #require(changedZone.assessments.first?.grant)
    #expect(changedZone.assessments.first?.reason == .occurrenceChanged)
    #expect(try evaluate(p, grants: [invalid]).desiredTargets == [gid(1), gid(2)])
    let backwards = try evaluate(p, grants: [grant], ctx: context("11:59"))
    let uncertain = try #require(backwards.assessments.first?.grant)
    #expect(uncertain.status == .uncertain)
    #expect(backwards.assessments.first?.reason == .clockMovedBackwards)
    #expect(backwards.assessments.first?.remainingSeconds == 0)
    let forward = try evaluate(p, grants: [uncertain], ctx: context("12:01"))
    #expect(forward.assessments.first?.disposition == .waiting)
    #expect(forward.desiredTargets == [gid(1), gid(2)])
    #expect(uncertain.initialExpiresAt == grant.initialExpiresAt)
}

@Test func R11CurrentWinnerCanStayTheSameWhileAnEditShortensItsFutureExpiry() throws {
    let p = try policy(), grant = try recording(pending(p), status: .active)
    let proposed = try policy([rule(), rule(2, start: 723, end: 780)], revision: 2, order: [2, 1])
    let assessment = try preview(proposed, grants: [grant])
    let impact = try #require(assessment.impacts.first)
    #expect(assessment.requiresConfirmation)
    #expect(assessment.requiredDeadlineUpdates == [impact])
    #expect(impact.kind == .shorten && impact.reason == .nextWinnerChange)
    #expect(impact.oldExpiresAt == (try at("12:05")))
    #expect(impact.proposedExpiresAt == (try at("12:03")))
    // Computing/discarding a preview (including cancelled/failed preparation) changes no active input.
    #expect(grant.effectiveExpiresAt == (try at("12:05")))
    #expect(try evaluate(p, grants: [grant], ctx: context("12:01")).assessments.first?.remainingSeconds == 240)
    let unprepared = try evaluate(proposed, grants: [grant], ctx: context("12:01"))
    #expect(unprepared.assessments.first?.disposition == .shorteningRequired)
    #expect(unprepared.assessments.first?.grant == grant)
    #expect(unprepared.assessments.first?.remainingSeconds == 0) // do not advertise a new confirmed expiry
    #expect(unprepared.desiredTargets == [gid(1), gid(2)])
}

@Test func clockRollbackCannotScheduleARefreshBeyondTheWeeklySearchCoverage() throws {
    let p = try policy(), grant = try recording(pending(p), status: .active)
    let result = try evaluate(p, grants: [grant], ctx: context("08:00"))
    #expect(result.assessments.first?.disposition == .uncertain)
    #expect(result.rules.evaluatedThrough == (try at("08:30")))
    #expect(result.nextBoundary == nil)
    #expect(result.nextEvaluationAt == (try at("08:30")))
    let refreshed = try evaluate(p, grants: [result.assessments[0].grant], ctx: context("08:30"))
    #expect(refreshed.nextBoundary == (try at("09:00")))
    #expect(refreshed.nextEvaluationAt <= refreshed.rules.evaluatedThrough)
}

@Test func R13ShorteningPreservesInitialCapAndCannotBeUndoneByDeletingTheSwitch() throws {
    let p = try policy(), grant = try recording(pending(p), status: .active)
    let shortened = try grant.shortened(to: at("12:03")) // value for the controller's prepared final commit
    #expect(shortened.initialExpiresAt == (try at("12:05")))
    #expect(shortened.id == grant.id && shortened.commandID == grant.commandID && shortened.acceptedAt == grant.acceptedAt)
    #expect(shortened.occurrence == grant.occurrence && shortened.status == grant.status)
    #expect(throws: GrantEvaluationError.expiryExtension) { try shortened.shortened(to: at("12:05")) }
    let removed = try policy(revision: 3, duration: 10)
    let result = try evaluate(removed, grants: [shortened], ctx: context("12:02"))
    #expect(result.assessments.first?.grant.effectiveExpiresAt == (try at("12:03")))
    #expect(result.assessments.first?.remainingSeconds == 60)
    let delayed = try policy([rule(), rule(2, start: 730, end: 780)], revision: 2, order: [2, 1])
    #expect(try preview(delayed, grants: [shortened]).impacts.first?.proposedExpiresAt == (try at("12:03")))
}

@Test func R07DefaultDurationChangeOnlyAffectsNewRequests() throws {
    let grant = try recording(pending(), status: .active)
    let changed = try policy(revision: 2, duration: 10)
    let assessment = try preview(changed, grants: [grant])
    #expect(!assessment.requiresConfirmation && assessment.requiredDeadlineUpdates.isEmpty)
    #expect(assessment.impacts.first?.kind == .unchanged)
    #expect(assessment.impacts.first?.proposedExpiresAt == grant.effectiveExpiresAt)
    guard case let .proposed(new) = try propose(changed, grantID: 2, commandID: 2, target: 2, existing: [grant]) else {
        throw TestFailure.expectedProposal
    }
    #expect(new.initialExpiresAt == (try at("12:10")))
}

@Test func R14ConfirmationRechecksSequenceInputsAndExpiryAtTheFinalInstant() throws {
    let active = try policy(), grant = try recording(pending(active), status: .active)
    let proposed = try policy([rule(), rule(2, start: 723, end: 780)], revision: 2, order: [2, 1])
    let assessment = try preview(proposed, grants: [grant])
    func check(_ clock: String, sequence: Int64 = 10, grants: [TemporaryGrant]? = nil,
               ctx: EvaluationContext? = nil, other: PolicyCandidate? = nil) throws {
        try GrantEditEvaluator.checkConfirmation(assessment, candidate: other ?? candidate(proposed), activePolicy: active,
                                                 selections: selections(proposed), context: ctx ?? context(clock),
                                                 snapshotSequence: SnapshotSequence(sequence), grants: grants ?? [grant])
    }
    try check("12:02")
    #expect(throws: GrantEvaluationError.confirmationChanged) { try check("12:03") }
    try check("12:02", sequence: 11) // recompute harmless sequence updates without asking again
    #expect(throws: GrantEvaluationError.confirmationChanged) { try check("12:02", sequence: 9) }
    #expect(throws: GrantEvaluationError.confirmationChanged) { try check("12:02", grants: [recording(grant, status: .uncertain)]) }
    #expect(throws: GrantEvaluationError.confirmationChanged) { try check("12:00") }
    #expect(throws: GrantEvaluationError.confirmationChanged) { try check("12:02", ctx: context("12:02", zone: "Etc/GMT-1")) }
    #expect(throws: GrantEvaluationError.confirmationChanged) { try check("12:02", ctx: context("12:02", authorization: .denied)) }
    let altered = try candidate(policy([rule(), rule(2, start: 724, end: 780)], revision: 2, order: [2, 1]))
    #expect(throws: GrantEvaluationError.confirmationChanged) { try check("12:02", other: altered) }
}

@Test func confirmationIncludesTheRemainingWinnerEvenWhenBothResultsInvalidateTheGrant() throws {
    let active = try policy(), grant = try recording(pending(active), status: .active)
    let proposed = try policy([rule(), rule(2, start: 720, end: 722, mode: .unavailable),
                               rule(3, start: 722, end: 780, mode: .dummyPayment)], revision: 2, order: [2, 3, 1])
    let assessment = try preview(proposed, grants: [grant])
    #expect(assessment.impacts.first?.reason == .winnerChanged)
    #expect(assessment.impacts.first?.proposedWinner?.rule.id == gid(2))
    #expect(assessment.impacts.first?.proposedWinner?.rule.unlockMode == .unavailable)
    let fresh = try GrantEditEvaluator.checkConfirmation(
        assessment, candidate: candidate(proposed), activePolicy: active, selections: selections(proposed),
        context: context("12:01"), snapshotSequence: SnapshotSequence(11), grants: [grant])
    #expect(fresh.snapshotSequence.rawValue == 11)
    #expect(throws: GrantEvaluationError.confirmationChanged) {
        try GrantEditEvaluator.checkConfirmation(
            assessment, candidate: candidate(proposed), activePolicy: active, selections: selections(proposed),
            context: context("12:02"), snapshotSequence: SnapshotSequence(11), grants: [grant])
    }
}

@Test func RuleVersionAndSelectionChangesInvalidateBindingsWithoutUsingAnotherRulesGrant() throws {
    let original = try policy(), grant = try recording(pending(original), status: .active)
    let modified = try policy([rule(version: 2)], revision: 2)
    let preview = try preview(modified, grants: [grant])
    #expect(preview.requiresConfirmation && preview.impacts.first?.kind == .invalidate)
    #expect(preview.impacts.first?.reason == .ruleChanged)
    let removedTarget = [Selection(ref: gid(1), targets: [gid(2)])]
    let removed = try evaluate(original, grants: [grant], selected: removedTarget)
    #expect(removed.assessments.first?.reason == .noWinningRule)
    #expect(removed.desiredTargets == [gid(2)])
    let stopped = try policy([rule(version: 2, enabled: false), rule(2)], revision: 2, order: [1, 2])
    let fallback = try evaluate(stopped, grants: [grant])
    #expect(fallback.assessments.first?.reason == .winnerChanged)
    #expect(fallback.desiredTargets == [gid(1), gid(2)])
    #expect(throws: GrantEvaluationError.invalidRuleVersion) {
        try GrantEditEvaluator.preview(candidate: candidate(policy([rule(end: 900)], revision: 2)),
                                       activePolicy: original, selections: selections(original), context: context(),
                                       snapshotSequence: SnapshotSequence(10), grants: [grant])
    }
}

@Test func editImpactKeepsOtherTargetsIndependent() throws {
    let active = try policy(), a = try recording(pending(active), status: .active)
    let b = try recording(pending(active, target: 2, id: 2), status: .active)
    let proposed = try policy([rule(), rule(2, start: 723, end: 780)], revision: 2, order: [2, 1])
    let selected = [Selection(ref: gid(1), targets: [gid(1), gid(2)]), Selection(ref: gid(2), targets: [gid(1)])]
    let result = try GrantEditEvaluator.preview(candidate: candidate(proposed), activePolicy: active,
                                               selections: selected, context: context("12:01"),
                                               snapshotSequence: SnapshotSequence(10), grants: [b, a])
    #expect(result.impacts.map(\.kind) == [.shorten, .unchanged])
    #expect(result.requiredDeadlineUpdates.count == 1)
    #expect(result.requiredDeadlineUpdates.first?.targetRef == gid(1))
}

@Test func corruptDuplicateRecordsAreErrorsRatherThanAnArbitraryExemption() throws {
    let p = try policy(), grant = try pending(p)
    #expect(throws: GrantEvaluationError.duplicateGrantID) { try evaluate(p, grants: [grant, grant]) }
    let conflict = try pending(p, id: 2)
    #expect(throws: GrantEvaluationError.conflictingGrants) { try evaluate(p, grants: [grant, conflict]) }
    let bad = try TemporaryGrant(id: gid(3), commandID: grant.commandID, targetRef: gid(2), occurrence: grant.occurrence,
                                 acceptedAt: grant.acceptedAt, initialExpiresAt: grant.initialExpiresAt,
                                 effectiveExpiresAt: grant.effectiveExpiresAt, status: .pending)
    #expect(throws: GrantEvaluationError.duplicateCommandID) { try evaluate(p, grants: [grant, bad]) }
    let tooLong = try TemporaryGrant(id: gid(4), commandID: gid(4), targetRef: gid(1), occurrence: grant.occurrence,
                                     acceptedAt: at("12:00"), initialExpiresAt: at("12:31"), effectiveExpiresAt: at("12:31"), status: .active)
    #expect(throws: GrantEvaluationError.invalidStoredDuration) { try evaluate(p, grants: [tooLong]) }
}

@Test func staleRequestsAreRejectedBeforeCreatingPendingData() throws {
    let p = try policy(), grant = try pending(p)
    func request(revision: Int64 = 1, occurrence: OccurrenceKey? = nil, command: Int = 2) throws -> GrantRequest {
        try GrantRequest(grantID: gid(2), commandID: gid(command), targetRef: gid(1),
                          expectedPolicyRevision: PolicyRevision(revision), expectedOccurrence: occurrence ?? grant.occurrence,
                          condition: UnlockCondition.reason("確認済みの利用目的"))
    }
    #expect(throws: GrantEvaluationError.stalePolicy) {
        try GrantEvaluator.propose(request(revision: 0), policy: p, selections: selections(p), context: context(), existingGrants: [])
    }
    #expect(throws: GrantEvaluationError.staleOccurrence) {
        try GrantEvaluator.propose(request(), policy: p, selections: selections(p), context: context("17:00"), existingGrants: [])
    }
    let priorDay = try OccurrenceKey(ruleID: grant.ruleID, ruleVersion: grant.ruleVersion,
                                     startDay: LocalDate(year: 2026, month: 11, day: 5), timeZone: TimeZoneID("UTC"),
                                     resolvedStart: Instant(secondsSince1970: grant.occurrence.resolvedStart.secondsSince1970 - 86400))
    #expect(throws: GrantEvaluationError.staleOccurrence) {
        try GrantEvaluator.propose(request(occurrence: priorDay), policy: p, selections: selections(p), context: context(), existingGrants: [])
    }
    #expect(throws: GrantEvaluationError.reusedIdentifier) {
        let reused = try GrantRequest(grantID: grant.id, commandID: gid(2), targetRef: gid(1),
                                      expectedPolicyRevision: p.revision, expectedOccurrence: grant.occurrence,
                                      condition: UnlockCondition.reason("目的"))
        _ = try GrantEvaluator.propose(reused, policy: p, selections: selections(p), context: context(),
                                       existingGrants: [recording(grant, status: .expired)])
    }
}
