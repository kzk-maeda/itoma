public enum GrantEditKind: Sendable { case unchanged, shorten, invalidate, expire, uncertain }

public struct GrantEditImpact: Equatable, Sendable {
    public let grantID: GrantID
    public let targetRef: TargetRef
    public let kind: GrantEditKind
    public let oldExpiresAt: Instant
    public let proposedExpiresAt: Instant?
    public let reason: GrantAssessmentReason?
    /// Explain the restriction that remains, including its mode and occurrence boundary.
    public let proposedWinner: RuleOccurrence?
}

/// An immutable preview for caller-owned confirmation. Not a receipt or an activated policy.
public struct PolicyEditAssessment: Equatable, Sendable {
    public let candidate: PolicyCandidate
    public let snapshotSequence: SnapshotSequence
    public let context: EvaluationContext
    public let impacts: [GrantEditImpact]
    public var requiresConfirmation: Bool { impacts.contains { $0.kind == .shorten || $0.kind == .invalidate } }
    public var requiredDeadlineUpdates: [GrantEditImpact] { impacts.filter { $0.kind == .shorten } }
    // Preserve all confirmation inputs, including records not currently granting an exemption.
    let activePolicy: PolicySnapshot
    let selections: [Selection]
    let grants: [TemporaryGrant]
}

public enum GrantEditEvaluator {
    public static func preview(
        candidate: PolicyCandidate, activePolicy: PolicySnapshot, selections: [Selection],
        context: EvaluationContext, snapshotSequence: SnapshotSequence, grants: [TemporaryGrant]
    ) throws -> PolicyEditAssessment {
        do { try candidate.validate(against: activePolicy) }
        catch ModelError.stalePolicyRevision { throw GrantEvaluationError.stalePolicy }
        catch ModelError.invalidRuleVersion { throw GrantEvaluationError.invalidRuleVersion }
        let evaluation = try GrantEvaluator.evaluate(policy: candidate.proposedPolicy, selections: selections,
                                                     context: context, grants: grants)
        let original = Dictionary(uniqueKeysWithValues: grants.map { ($0.id, $0) })
        let impacts: [GrantEditImpact] = evaluation.assessments.compactMap { assessment in
            let grant = original[assessment.grant.id]!
            guard grant.occupiesTarget, grant.status != .reblockPending else { return nil }
            let kind: GrantEditKind
            switch assessment.disposition {
            case .effective, .waiting: kind = .unchanged
            case .shorteningRequired: kind = .shorten
            case .expired: kind = .expire
            case .invalidated: kind = .invalidate
            case .uncertain: kind = .uncertain
            case .terminal: return nil
            }
            let expiry = kind == .shorten ? assessment.proposedExpiresAt : (kind == .unchanged ? grant.effectiveExpiresAt : nil)
            return GrantEditImpact(grantID: grant.id, targetRef: grant.targetRef, kind: kind,
                                   oldExpiresAt: grant.effectiveExpiresAt, proposedExpiresAt: expiry,
                                   reason: assessment.reason,
                                   proposedWinner: evaluation.rules.targets[grant.targetRef]?.winner)
        }
        return PolicyEditAssessment(candidate: candidate, snapshotSequence: snapshotSequence, context: context,
                                    impacts: impacts, activePolicy: activePolicy,
                                    selections: ordered(selections), grants: GrantEvaluator.ordered(grants))
    }

    /// Recheck inside the controller's final transaction. UI acknowledgement and matching scheduler
    /// receipts are additional prerequisites; passing this function alone activates nothing.
    @discardableResult
    public static func checkConfirmation(
        _ confirmed: PolicyEditAssessment, candidate: PolicyCandidate, activePolicy: PolicySnapshot,
        selections: [Selection], context: EvaluationContext,
        snapshotSequence: SnapshotSequence, grants: [TemporaryGrant]
    ) throws -> PolicyEditAssessment {
        guard confirmed.candidate == candidate, confirmed.activePolicy == activePolicy,
              confirmed.snapshotSequence <= snapshotSequence,
              confirmed.selections == ordered(selections), confirmed.grants == GrantEvaluator.ordered(grants),
              context.now >= confirmed.context.now, context.timeZone == confirmed.context.timeZone,
              context.authorization.status == confirmed.context.authorization.status,
              context.activation == confirmed.context.activation else {
            throw GrantEvaluationError.confirmationChanged
        }
        let fresh = try preview(candidate: candidate, activePolicy: activePolicy, selections: selections,
                                context: context, snapshotSequence: snapshotSequence, grants: grants)
        guard fresh.impacts == confirmed.impacts else { throw GrantEvaluationError.confirmationChanged }
        return fresh
    }

    private static func ordered(_ selections: [Selection]) -> [Selection] {
        selections.sorted { $0.ref.rawValue.uuidString < $1.ref.rawValue.uuidString }
    }
}
