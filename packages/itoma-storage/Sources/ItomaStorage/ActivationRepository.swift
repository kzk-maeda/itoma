import Foundation
import ItomaCore
import ItomaSQLite

extension ControlTransaction {
    /// Records explicit user intent only. A controller still must apply/observe its own store.
    /// Stop needs no authorization; resume requires a fresh supplied Approved observation.
    public func acceptActivationCommand(command: Command, context: EvaluationContext,
                                         expectedSequence: SnapshotSequence) throws -> CommandAcceptance {
        try checked {
            let current = try repository.loadSnapshot()
            guard [.stop, .resumeAfterAuthorization].contains(command.kind), command.reasonRef == nil,
                  command.candidatePolicyRevision == nil else { throw StorageError.invalidCommand }
            let intent = CommandIntent(command: command, policy: nil)
            if let existing = try repository.loadCommand(command.id) {
                guard existing.intent == intent else { throw StorageError.conflict }
                return CommandAcceptance(command: existing.command, alreadyAccepted: true, snapshot: current)
            }
            guard command.status == .pending, command.attempt.rawValue == 0 else { throw StorageError.invalidCommand }
            guard current.snapshotSequence == expectedSequence, current.activation == context.activation,
                  current.policy.revision == command.expectedPolicyRevision else { throw StorageError.conflict }
            if command.kind == .resumeAfterAuthorization {
                guard context.authorization.status == .approved, current.activation != .enabled else { throw StorageError.invalidCommand }
            }
            try repository.insertCommand(command, intent: intent)
            _ = try repository.updateActivation(command.kind == .stop ? .paused : .enabled,
                                                expectedSequence: current.snapshotSequence)
            try repository.database.execute("UPDATE activation_state SET command_id=? WHERE singleton=1", [.text(command.id.rawValue.uuidString)])
            try repository.advanceSequence()
            return CommandAcceptance(command: command, alreadyAccepted: false, snapshot: try repository.loadSnapshot())
        }
    }
}

extension ControlRepository {
    func createActivationTable() throws {
        try database.execute("""
            CREATE TABLE activation_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
              command_id TEXT REFERENCES commands(command_id))
            """)
        try database.execute("INSERT INTO activation_state VALUES (1,NULL)")
    }

    func loadActivationCommandID() throws -> CommandID? {
        let rows = try database.rows("SELECT command_id FROM activation_state WHERE singleton=1")
        guard rows.count == 1, rows[0].count == 1 else { throw StorageError.corrupt }
        if rows[0][0] == .null { return nil }
        guard case let .text(raw) = rows[0][0], let uuid = UUID(uuidString: raw), uuid.uuidString == raw,
              let command = try loadCommand(CommandID(uuid))?.command,
              [.stop, .resumeAfterAuthorization].contains(command.kind) else { throw StorageError.corrupt }
        return command.id
    }
}
