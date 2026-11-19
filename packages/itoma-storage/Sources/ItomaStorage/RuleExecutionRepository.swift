import Foundation
import ItomaCore
import ItomaSQLite

private struct RuleExecutionConfirmation: Codable {
    let policy: PolicySnapshot
    let activationCommandID: CommandID?
    let confirmedAt: Instant
}

extension ControlRepository {
    /// Host-only installation. An older/new Extension never creates or repairs this authority.
    /// Schema6 writers invalidate it through SQLite triggers, including stop -> resume ABA.
    public func installRuleExecutionAuthorization() throws {
        try serialized { try database.transaction(writer: true) {
            if try !hasRuleExecutionAuthorization() {
                try database.execute("""
                    CREATE TABLE rule_execution_authorization(
                      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                      version INTEGER NOT NULL CHECK(version=1), record BLOB,
                      evaluation_id TEXT, authorization TEXT CHECK(authorization IN ('approved','denied','unknown')))
                    """)
                try database.execute("INSERT INTO rule_execution_authorization VALUES(1,1,NULL,NULL,NULL)")
                try database.execute("""
                    CREATE TRIGGER rule_execution_policy_changed AFTER UPDATE OF policy,activation ON control_state
                    WHEN OLD.policy IS NOT NEW.policy OR OLD.activation IS NOT NEW.activation
                    BEGIN UPDATE rule_execution_authorization SET record=NULL; END
                    """)
                try database.execute("""
                    CREATE TRIGGER rule_execution_intent_changed AFTER UPDATE OF command_id ON activation_state
                    WHEN OLD.command_id IS NOT NEW.command_id
                    BEGIN UPDATE rule_execution_authorization SET record=NULL; END
                    """)
                // Referenced selections are immutable in the protocol. Fail closed for older or
                // external writers that change/delete one without activating a new revision.
                for operation in ["UPDATE", "DELETE"] {
                    try database.execute("""
                        CREATE TRIGGER rule_execution_selection_\(operation.lowercased()) AFTER \(operation) ON selections
                        BEGIN UPDATE rule_execution_authorization SET record=NULL; END
                        """)
                }
            }
            try validateRuleExecutionAuthorization()
        } }
    }

    private func hasRuleExecutionAuthorization() throws -> Bool {
        try !database.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='rule_execution_authorization'").isEmpty
    }

    private func validateRuleExecutionAuthorization() throws {
        do { try database.execute("SELECT record,evaluation_id,authorization FROM rule_execution_authorization LIMIT 0") }
        catch SQLiteFailure.failure { throw StorageError.corrupt }
        guard try database.rows("SELECT singleton,version FROM rule_execution_authorization") == [[.integer(1), .integer(1)]],
              try database.rows("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'rule_execution_%' ORDER BY name") == [
                [.text("rule_execution_intent_changed")], [.text("rule_execution_policy_changed")],
                [.text("rule_execution_selection_delete")], [.text("rule_execution_selection_update")]
              ] else { throw StorageError.corrupt }
    }

    /// Delegated execution is not a fresh OS authorization observation for duration metrics.
    /// Legacy installations retain their existing qualification; new records require a matching
    /// approved observation or an explicit native foreground checkpoint.
    func durationAuthorizationConfirmed(for evaluationID: EvaluationID?) throws -> Bool {
        guard try hasRuleExecutionAuthorization() else { return true }
        try validateRuleExecutionAuthorization()
        guard let evaluationID else { return false }
        return try database.rows("SELECT evaluation_id,authorization FROM rule_execution_authorization WHERE singleton=1")
            == [[.text(evaluationID.rawValue.uuidString), .text("approved")]]
    }

    fileprivate func recordRuleAuthorization(evaluationID: EvaluationID, authorization: AuthorizationStatus) throws {
        try optionalRuleExecutionWrite {
            guard try hasRuleExecutionAuthorization() else { return }
            try validateRuleExecutionAuthorization()
            try database.execute("UPDATE rule_execution_authorization SET evaluation_id=?,authorization=? WHERE singleton=1",
                [.text(evaluationID.rawValue.uuidString), .text(authorization.rawValue)])
        }
    }

    fileprivate func ruleExecutionRecord() throws -> Data? {
        guard try hasRuleExecutionAuthorization() else { return nil }
        try validateRuleExecutionAuthorization()
        let rows = try database.rows("SELECT record FROM rule_execution_authorization WHERE singleton=1")
        guard let row = rows.first, row.count == 1 else { throw StorageError.corrupt }
        if row[0] == .null { return nil }
        guard case let .blob(data) = row[0] else { throw StorageError.corrupt }
        return data
    }

    fileprivate func storeRuleExecutionRecord(_ data: Data?) throws {
        try optionalRuleExecutionWrite {
            guard try hasRuleExecutionAuthorization() else { return }
            try validateRuleExecutionAuthorization()
            try database.execute("UPDATE rule_execution_authorization SET record=? WHERE singleton=1", [data.map(SQLValue.blob) ?? .null])
        }
    }

    /// Isolate auxiliary failures without poisoning ControlTransaction. A failed savepoint
    /// rollback still aborts the whole writer; callers must never swallow that failure.
    private func optionalRuleExecutionWrite(_ body: () throws -> Void) throws {
        do { try database.savepoint(body) }
        catch SQLiteFailure.rollbackFailure { throw StorageError.rollbackRequired }
        catch { /* No new authority/qualification was stored. Reads remain fail closed. */ }
    }

}

extension ControlTransaction {
    /// Only a live Approved host observation can issue this proof, inside the same current-state
    /// writer. It proves user intent/host confirmation, never the Extension's raw OS status.
    public func confirmRuleExecution(context: EvaluationContext) throws {
        try checked {
            let snapshot = try repository.loadSnapshot()
            guard context.authorization.status == .approved, context.activation == .enabled,
                  snapshot.activation == .enabled, context.authorization.observedAt <= context.now else {
                throw StorageError.invalidCommand
            }
            let record = RuleExecutionConfirmation(policy: snapshot.policy,
                activationCommandID: snapshot.activationCommandID, confirmedAt: context.now)
            try repository.storeRuleExecutionRecord(JSONEncoder().encode(record))
        }
    }

    public func recordRuleAuthorizationObservation(evaluationID: EvaluationID, authorization: AuthorizationStatus) throws {
        try checked { try repository.recordRuleAuthorization(evaluationID: evaluationID, authorization: authorization) }
    }

    public func revokeRuleExecutionConfirmation() throws {
        try checked { try repository.storeRuleExecutionRecord(nil) }
    }

    public func hasCurrentRuleExecutionConfirmation(at now: Instant) throws -> Bool {
        try checked {
            guard let data = try repository.ruleExecutionRecord() else { return false }
            let record: RuleExecutionConfirmation
            do { record = try JSONDecoder().decode(RuleExecutionConfirmation.self, from: data) }
            catch { throw StorageError.corrupt }
            let snapshot = try repository.loadSnapshot()
            return snapshot.activation == .enabled && snapshot.policy == record.policy
                && snapshot.activationCommandID == record.activationCommandID && now >= record.confirmedAt
        }
    }
}
