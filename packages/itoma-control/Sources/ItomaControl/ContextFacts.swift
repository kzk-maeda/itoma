import ItomaCore
import ItomaStorage

private struct CapturedContextFacts {
    let context: EvaluationContext
    let grants: Set<GrantID>
    let applicationID: EvaluationID?
}

extension CommandService {
    func refreshCurrentFacts() throws -> EvaluationContext {
        try repository.requireOutsideTransaction()
        return try observedTransaction { tx, capture in
            let snapshot = try tx.snapshot(), context = capture(snapshot.activation)
            return try recordCurrentFacts(context: context, transaction: tx)
        }
    }

    func rebinding(_ context: EvaluationContext, activation: Activation) -> EvaluationContext {
        EvaluationContext(now: context.now, timeZone: context.timeZone, authorization: context.authorization, activation: activation)
    }

    /// Current-policy facts only. Never evaluate the unactivated candidate here. Reuse the same
    /// captured OS context for confirmation so a second observation cannot disappear on rollback.
    func recordCurrentFacts(
        context: EvaluationContext, including: Set<GrantID>? = nil, updateObservation: Bool = true, transaction tx: ControlTransaction
    ) throws -> EvaluationContext {
        let before = try tx.unfinishedGrants().filter { including?.contains($0.grant.id) ?? true }.map(\.grant)
        try recordDenied(context: context, transaction: tx)
        let snapshot = try tx.snapshot(), captured = rebinding(context, activation: snapshot.activation)
        let normalized = try protectedGrants(context: captured, including: including, transaction: tx)
        if updateObservation && (before != normalized || captured.authorization.status != .approved
            || (snapshot.application?.evaluation.timeZone != nil && snapshot.application?.evaluation.timeZone != captured.timeZone)) {
            try markObservationUncertain(at: captured.now,
                failure: captured.authorization.status == .approved ? .interrupted : .authorizationRequired, transaction: tx)
        }
        return captured
    }

    /// An OS observation is not a candidate effect. If result storage rolls back, retain the
    /// observed contexts and retry their current-policy negative facts in independent transactions.
    /// Restrict timezone/clock facts to grants that existed at observation, never future grants.
    func observedTransaction<T>(
        _ body: @ItomaControlActor (ControlTransaction, @ItomaControlActor (Activation) -> EvaluationContext) throws -> T
    ) throws -> T {
        var captured: [CapturedContextFacts] = []
        do {
            return try repository.write { tx in
                let snapshot = try tx.snapshot(), grants = Set(try tx.unfinishedGrants().map(\.grant.id))
                let capture: @ItomaControlActor (Activation) -> EvaluationContext = { activation in
                    let context = self.contexts.context(activation: activation)
                    captured.append(CapturedContextFacts(context: context, grants: grants, applicationID: snapshot.application?.evaluation.id))
                    return context
                }
                return try body(tx, capture)
            }
        } catch {
            let original = error
            for fact in captured {
                // Observation metadata can fail independently of grant/Activation storage. Commit
                // the logical negative facts first, then try to mark the observation uncertain.
                var changed = false
                do {
                    changed = try repository.write { tx in
                        let sequence = try tx.snapshot().snapshotSequence
                        _ = try recordCurrentFacts(context: fact.context, including: fact.grants, updateObservation: false, transaction: tx)
                        return try tx.snapshot().snapshotSequence != sequence
                    }
                } catch { /* The caller still returns Uncertain, never a successful OS rollback. */ }
                do {
                    try repository.write { tx in
                        let snapshot = try tx.snapshot()
                        // Preserve a newer controller's Applied evidence when no model fact changed.
                        let same = snapshot.application?.evaluation.id == fact.applicationID
                        let stale = fact.context.authorization.status != .approved
                            || snapshot.application?.evaluation.timeZone != fact.context.timeZone
                            || fact.context.now < (snapshot.application?.evaluation.evaluatedAt ?? fact.context.now)
                        guard changed || (same && (snapshot.application?.observation.status == .applying || stale)) else { return }
                        try markObservationUncertain(at: fact.context.now, failure: .interrupted, transaction: tx)
                    }
                } catch { /* Durable Applying/no-validUntil still prevents a fresh success claim. */ }
            }
            throw original
        }
    }
}
