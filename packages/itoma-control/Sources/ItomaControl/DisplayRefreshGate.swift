import ItomaCore
import ItomaStorage

/// Process-local reuse of a completed host refresh, never new application evidence. A new
/// process/lifecycle generation and every control write still take the ordinary recovery path.
public struct DisplayRefreshGate: Sendable {
    private struct Stamp: Equatable, Sendable {
        let sequence: SnapshotSequence
        let revision: PolicyRevision
        let activation: Activation
        let evaluationID: EvaluationID
        let authorization: AuthorizationStatus
        let authorizationEpoch: Int
        let lifecycleGeneration: Int
    }
    private var stamp: Stamp?
    private var lastWall: Instant?
    private var lastUptime: Double?
    public init() {}
    public mutating func invalidate() { stamp = nil; lastWall = nil; lastUptime = nil }

    public mutating func remember(_ snapshot: ControlSnapshot, context: EvaluationContext,
                                  authorizationEpoch: Int, lifecycleGeneration: Int, uptime: Double) {
        invalidate()
        guard let value = validStamp(snapshot, context: context, authorizationEpoch: authorizationEpoch,
                                     lifecycleGeneration: lifecycleGeneration), uptime.isFinite else { return }
        stamp = value; lastWall = context.now; lastUptime = uptime
    }
    public mutating func canReuse(_ snapshot: ControlSnapshot, context: EvaluationContext,
                                 authorizationEpoch: Int, lifecycleGeneration: Int, uptime: Double) -> Bool {
        guard let stamp, let lastWall, let lastUptime,
              validStamp(snapshot, context: context, authorizationEpoch: authorizationEpoch,
                         lifecycleGeneration: lifecycleGeneration) == stamp,
              uptime.isFinite, uptime >= lastUptime, context.now >= lastWall,
              abs((context.now.secondsSince1970 - lastWall.secondsSince1970) - (uptime - lastUptime)) < 2 else {
            invalidate(); return false
        }
        self.lastWall = context.now; self.lastUptime = uptime
        return true
    }
    private func validStamp(_ snapshot: ControlSnapshot, context: EvaluationContext,
                            authorizationEpoch: Int, lifecycleGeneration: Int) -> Stamp? {
        guard let application = snapshot.application, application.observation.status == .applied,
              application.observation.evaluationID == application.evaluation.id,
              application.observation.evidence != nil, application.observation.error == nil,
              application.evaluation.policyRevision == snapshot.policy.revision,
              context.activation == snapshot.activation, context.authorization.status == .approved,
              application.evaluation.timeZone == context.timeZone,
              application.evaluation.evaluatedAt <= context.now, application.observation.observedAt <= context.now,
              let end = application.observation.validUntil, context.now < end else { return nil }
        return Stamp(sequence: snapshot.snapshotSequence, revision: snapshot.policy.revision,
                     activation: snapshot.activation, evaluationID: application.evaluation.id,
                     authorization: context.authorization.status, authorizationEpoch: authorizationEpoch,
                     lifecycleGeneration: lifecycleGeneration)
    }
}
