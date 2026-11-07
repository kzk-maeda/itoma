import Foundation

public enum GrantEvaluationError: Error, Equatable, Sendable {
    case emptyReason, cancelledDummyPayment, conditionMismatch
    case stalePolicy, staleOccurrence, authorizationRequired, activationRequired, unlockUnavailable
    case duplicateGrantID, duplicateCommandID, conflictingGrants, reusedIdentifier, invalidStoredDuration
    case invalidRuleVersion, confirmationChanged, expiryExtension
}

/// Input validation only; neither a UI confirmation receipt nor permission to operate the OS.
/// The reason body and dummy amount are never retained in shared models.
public struct UnlockCondition: Equatable, Sendable {
    public let mode: UnlockMode
    private init(_ mode: UnlockMode) { self.mode = mode }

    public static func reason(_ text: String) throws -> Self {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw GrantEvaluationError.emptyReason
        }
        return Self(.reason)
    }

    public static func dummyPayment(selectionConfirmed: Bool) throws -> Self {
        guard selectionConfirmed else { throw GrantEvaluationError.cancelledDummyPayment }
        return Self(.dummyPayment)
    }
}

public struct GrantRequest: Equatable, Sendable {
    public let grantID: GrantID
    public let commandID: CommandID
    public let targetRef: TargetRef
    public let expectedPolicyRevision: PolicyRevision
    public let expectedOccurrence: OccurrenceKey
    public let condition: UnlockCondition
    public let duration: UnlockDuration?

    public init(
        grantID: GrantID, commandID: CommandID, targetRef: TargetRef,
        expectedPolicyRevision: PolicyRevision, expectedOccurrence: OccurrenceKey,
        condition: UnlockCondition, duration: UnlockDuration? = nil
    ) {
        self.grantID = grantID
        self.commandID = commandID
        self.targetRef = targetRef
        self.expectedPolicyRevision = expectedPolicyRevision
        self.expectedOccurrence = expectedOccurrence
        self.condition = condition
        self.duration = duration
    }
}

public enum GrantRequestResult: Equatable, Sendable {
    case proposed(TemporaryGrant)
    case existing(TemporaryGrant)
}

public enum GrantDisposition: Sendable {
    case effective, waiting, shorteningRequired, expired, invalidated, uncertain, terminal
}

public enum GrantAssessmentReason: Sendable {
    case authorization, activation, noWinningRule, winnerChanged, ruleChanged, occurrenceChanged
    case unlockUnavailable, deadline, clockMovedBackwards, notActive, nextWinnerChange, occurrenceEnd
}

public struct GrantAssessment: Equatable, Sendable {
    /// Expiry/invalidation/clock inconsistency produces a new logical record for persistence.
    public let grant: TemporaryGrant
    public let disposition: GrantDisposition
    public let reason: GrantAssessmentReason?
    /// A proposal only. It has not been registered, confirmed, or activated.
    public let proposedExpiresAt: Instant?
    public let remainingSeconds: Double
}

public struct GrantEvaluation: Equatable, Sendable {
    public let rules: RuleEvaluation
    public let assessments: [GrantAssessment]
    /// Active, valid grants only. This plan is not evidence of OS success.
    public let desiredTargets: Set<TargetRef>
    public let nextBoundary: Instant?
    public var nextEvaluationAt: Instant { nextBoundary ?? rules.evaluatedThrough }
}

public enum GrantEvaluator {
    public static func evaluate(
        policy: PolicySnapshot, selections: [Selection], context: EvaluationContext, grants: [TemporaryGrant]
    ) throws -> GrantEvaluation {
        try validate(grants)
        let rules = try weekly(policy: policy, selections: selections, context: context)
        let assessments = try ordered(grants).map { try assess($0, rules: rules) }
        var desired = rules.desiredTargets
        for result in assessments where result.disposition == .effective { desired.remove(result.grant.targetRef) }
        // Pending/uncertain requests must also be reevaluated when their original deadline arrives.
        let deadlines = assessments.filter { $0.grant.occupiesTarget }.map(\.grant.effectiveExpiresAt)
            .filter { context.now < $0 }
        let next = (deadlines + [rules.nextBoundary].compactMap { $0 }).min()
        return GrantEvaluation(rules: rules, assessments: assessments, desiredTargets: desired, nextBoundary: next)
    }

    /// Creates only Pending data. Scheduler receipt + final transaction checks remain mandatory.
    /// The command layer must check exact payload identity before calling this duplicate guard.
    public static func propose(
        _ request: GrantRequest, policy: PolicySnapshot, selections: [Selection],
        context: EvaluationContext, existingGrants: [TemporaryGrant]
    ) throws -> GrantRequestResult {
        try validate(existingGrants)
        if let sameCommand = existingGrants.first(where: { $0.commandID == request.commandID }) {
            guard sameCommand.targetRef == request.targetRef else { throw GrantEvaluationError.reusedIdentifier }
            return .existing(sameCommand)
        }
        guard !existingGrants.contains(where: { $0.id == request.grantID }) else {
            throw GrantEvaluationError.reusedIdentifier
        }
        if let occupied = existingGrants.first(where: { $0.targetRef == request.targetRef && $0.occupiesTarget }) {
            return .existing(occupied)
        }
        guard request.expectedPolicyRevision == policy.revision else { throw GrantEvaluationError.stalePolicy }
        guard context.authorization.status == .approved else { throw GrantEvaluationError.authorizationRequired }
        guard context.activation == .enabled else { throw GrantEvaluationError.activationRequired }
        let rules = try weekly(policy: policy, selections: selections, context: context)
        guard let target = rules.targets[request.targetRef], let winner = target.winner,
              winner.key == request.expectedOccurrence else { throw GrantEvaluationError.staleOccurrence }
        guard winner.rule.unlockMode != .unavailable else { throw GrantEvaluationError.unlockUnavailable }
        guard winner.rule.unlockMode == request.condition.mode else { throw GrantEvaluationError.conditionMismatch }
        let duration = request.duration ?? policy.defaultUnlockDuration
        let requestedEnd = try Instant(secondsSince1970: context.now.secondsSince1970 + Double(duration.minutes * 60))
        let end = min(requestedEnd, winner.endsAt, target.nextWinnerChange ?? rules.evaluatedThrough)
        return .proposed(try TemporaryGrant(
            id: request.grantID, commandID: request.commandID, targetRef: request.targetRef,
            occurrence: winner.key, acceptedAt: context.now, initialExpiresAt: end,
            effectiveExpiresAt: end, status: .pending
        ))
    }

    static func ordered(_ grants: [TemporaryGrant]) -> [TemporaryGrant] {
        grants.sorted { $0.id.rawValue.uuidString < $1.id.rawValue.uuidString }
    }

    private static func validate(_ grants: [TemporaryGrant]) throws {
        guard Set(grants.map(\.id)).count == grants.count else { throw GrantEvaluationError.duplicateGrantID }
        guard Set(grants.map(\.commandID)).count == grants.count else { throw GrantEvaluationError.duplicateCommandID }
        let occupied = grants.filter(\.occupiesTarget).map(\.targetRef)
        guard Set(occupied).count == occupied.count else { throw GrantEvaluationError.conflictingGrants }
        guard grants.allSatisfy({ $0.initialExpiresAt.secondsSince1970 - $0.acceptedAt.secondsSince1970 <= 1800 }) else {
            throw GrantEvaluationError.invalidStoredDuration
        }
    }

    private static func weekly(
        policy: PolicySnapshot, selections: [Selection], context: EvaluationContext
    ) throws -> RuleEvaluation {
        // Every accepted grant is <=30 minutes; cover the complete possible expiry, never infer
        // "no change" from a shorter search window. Future acceptedAt is handled as clock uncertainty.
        let through = try Instant(secondsSince1970: context.now.secondsSince1970 + 1800)
        return try RuleEvaluator.evaluate(policy: policy, selections: selections, context: context, through: through)
    }

    private static func assess(_ grant: TemporaryGrant, rules: RuleEvaluation) throws -> GrantAssessment {
        func result(_ disposition: GrantDisposition, _ reason: GrantAssessmentReason? = nil,
                    status: GrantStatus? = nil, proposed: Instant? = nil) throws -> GrantAssessment {
            let record = try status.map { try grant.recording(status: $0) } ?? grant
            return GrantAssessment(grant: record, disposition: disposition, reason: reason,
                                   proposedExpiresAt: proposed,
                                   remainingSeconds: disposition == .effective
                                    ? max(0, grant.effectiveExpiresAt.secondsSince1970 - rules.context.now.secondsSince1970) : 0)
        }
        // Terminal/reblock records never become an exemption again, even after clock rollback.
        switch grant.status {
        case .expired: return try result(.expired)
        case .invalidated: return try result(.invalidated)
        case .reconciled, .reblockPending: return try result(.terminal)
        default: break
        }
        guard rules.context.now >= grant.acceptedAt else {
            return try result(.uncertain, .clockMovedBackwards, status: .uncertain)
        }
        guard rules.context.now < grant.effectiveExpiresAt else {
            return try result(.expired, .deadline, status: .expired)
        }
        guard rules.context.authorization.status == .approved else {
            return try result(.invalidated, .authorization, status: .invalidated)
        }
        guard rules.context.activation == .enabled else {
            return try result(.invalidated, .activation, status: .invalidated)
        }
        guard let target = rules.targets[grant.targetRef], let winner = target.winner else {
            return try result(.invalidated, .noWinningRule, status: .invalidated)
        }
        guard winner.rule.id == grant.ruleID else {
            return try result(.invalidated, .winnerChanged, status: .invalidated)
        }
        guard winner.rule.version == grant.ruleVersion else {
            return try result(.invalidated, .ruleChanged, status: .invalidated)
        }
        guard winner.key == grant.occurrence else {
            return try result(.invalidated, .occurrenceChanged, status: .invalidated)
        }
        guard winner.rule.unlockMode != .unavailable else {
            return try result(.invalidated, .unlockUnavailable, status: .invalidated)
        }
        let cap = min(grant.effectiveExpiresAt, grant.initialExpiresAt, winner.endsAt,
                      target.nextWinnerChange ?? rules.evaluatedThrough)
        if cap < grant.effectiveExpiresAt {
            return try result(.shorteningRequired, cap == winner.endsAt ? .occurrenceEnd : .nextWinnerChange, proposed: cap)
        }
        return try result(grant.status == .active ? .effective : .waiting,
                          grant.status == .active ? nil : .notActive)
    }
}

extension TemporaryGrant {
    /// Failed/uncertain/in-flight work reserves the target until explicitly settled by the controller.
    var occupiesTarget: Bool {
        switch status {
        case .expired, .invalidated, .reconciled: false
        default: true
        }
    }

    func recording(status: GrantStatus) throws -> Self {
        try Self(id: id, commandID: commandID, targetRef: targetRef, occurrence: occurrence,
                 acceptedAt: acceptedAt, initialExpiresAt: initialExpiresAt,
                 effectiveExpiresAt: effectiveExpiresAt, status: status)
    }

    /// Pure value transformation for the final commit step; does not authorize that commit.
    public func shortened(to expiry: Instant) throws -> Self {
        guard expiry <= effectiveExpiresAt else { throw GrantEvaluationError.expiryExtension }
        return try Self(id: id, commandID: commandID, targetRef: targetRef, occurrence: occurrence,
                        acceptedAt: acceptedAt, initialExpiresAt: initialExpiresAt,
                        effectiveExpiresAt: expiry, status: status)
    }
}
