import Foundation
import ItomaSQLite
import ItomaCore

public struct CommandAcceptance: Equatable, Sendable {
    public let command: Command
    public let alreadyAccepted: Bool
    public let snapshot: ControlSnapshot
}

/// Scope-limited synchronous writer. A controller may perform only short synchronous final OS
/// operations here; registration, prompts and every await belong outside the transaction.
public final class ControlTransaction {
    let repository: ControlRepository
    private var active = true
    private var rollbackOnly = false
    var registrationsCreatedHere: Set<RegistrationID> = []
    var receiptsWrittenHere: Set<RegistrationID> = []
    init(repository: ControlRepository) { self.repository = repository }
    func finish() { active = false }
    private func checkScope() throws {
        guard active else { throw StorageError.transactionExpired }
        guard !rollbackOnly else { throw StorageError.rollbackRequired }
    }
    func validateCommit() throws { try checkScope() }
    func checked<T>(_ body: () throws -> T) throws -> T {
        try checkScope()
        do { return try StorageError.translating(body) }
        catch { rollbackOnly = true; throw error }
    }

    public func snapshot() throws -> ControlSnapshot {
        try checked { try repository.loadSnapshot() }
    }

    public func command(_ id: CommandID) throws -> Command? {
        try checked { try repository.loadCommand(id)?.command }
    }

    /// Lifecycle recovery only. The controller decides whether a live request owns an operation.
    public func commandsRequiringRecovery() throws -> [Command] {
        try checked {
            try repository.database.rows("SELECT command_id FROM commands ORDER BY command_id").compactMap { row in
                guard case let .text(raw) = row[0], let uuid = UUID(uuidString: raw), uuid.uuidString == raw,
                      let command = try repository.loadCommand(CommandID(uuid))?.command else { throw StorageError.corrupt }
                return [.scheduling, .applying].contains(command.status) ? command : nil
            }
        }
    }

    public func candidate(commandID: CommandID) throws -> PolicyCandidate? {
        try checked { try repository.loadCandidate(commandID) }
    }

    public func acceptCandidate(
        command: Command, candidate: PolicyCandidate, expectedSequence: SnapshotSequence
    ) throws -> CommandAcceptance {
        return try checked {
            let current = try repository.loadSnapshot()
            let intent = CommandIntent(command: command, policy: candidate.proposedPolicy)
            guard command.kind == .commitPolicy, command.id == candidate.commandID,
                  command.expectedPolicyRevision == candidate.expectedRevision,
                  command.candidatePolicyRevision == candidate.proposedPolicy.revision else { throw StorageError.invalidCommand }
            if let existing = try repository.loadCommand(command.id) {
                guard existing.intent == intent else { throw StorageError.conflict }
                guard try repository.loadCandidate(command.id) == candidate else { throw StorageError.corrupt }
                return CommandAcceptance(command: existing.command, alreadyAccepted: true, snapshot: current)
            }
            guard command.status == .pending, command.attempt.rawValue == 0 else { throw StorageError.invalidCommand }
            guard current.snapshotSequence == expectedSequence else { throw StorageError.conflict }
            try repository.validateCandidate(candidate, against: current.policy)
            let refs = Set(current.selections.map(\.selection.ref))
            guard candidate.proposedPolicy.rules.filter(\.enabled).allSatisfy({ refs.contains($0.selectionRef) }) else {
                throw StorageError.invalidSelection
            }
            try repository.insertCommand(command, intent: intent)
            try repository.database.execute("INSERT INTO policy_candidates(command_id,base_revision,proposed_policy) VALUES (?,?,?)", [
                .text(command.id.rawValue.uuidString), .integer(candidate.expectedRevision.rawValue),
                .blob(try JSONEncoder().encode(candidate.proposedPolicy))
            ])
            try repository.advanceSequence()
            return CommandAcceptance(command: command, alreadyAccepted: false, snapshot: try repository.loadSnapshot())
        }
    }

    public func recordCommand(_ updated: Command, expected: Command) throws -> Command {
        return try checked {
            guard let stored = try repository.loadCommand(updated.id), stored.command == expected,
                  stored.intent.matches(updated) else { throw StorageError.conflict }
            if updated == expected { return updated }
            guard ![CommandStatus.succeeded, .superseded, .expired, .cancelled].contains(expected.status) else { throw StorageError.conflict }
            if updated.attempt != expected.attempt {
                guard updated.attempt == (try expected.attempt.next()),
                      [.failed, .uncertain].contains(expected.status), updated.status == .pending else {
                    throw StorageError.invalidCommand
                }
            } else if [.failed, .uncertain].contains(expected.status) && [.pending, .scheduling, .applying].contains(updated.status) {
                throw StorageError.invalidCommand
            }
            try repository.database.execute("UPDATE commands SET record=? WHERE command_id=?", [
                .blob(try JSONEncoder().encode(CommandDTO(updated))), .text(updated.id.rawValue.uuidString)
            ])
            try repository.storeAttempt(updated)
            try repository.advanceSequence()
            return updated
        }
    }

    /// Final CAS plus grant/registration checks. UI approval and actual OS effects remain external.
    public func activateCandidate(
        commandID: CommandID, expectedSequence: SnapshotSequence, context: EvaluationContext? = nil,
        confirmation: PolicyEditAssessment? = nil, grantChanges: [RegisteredGrantChange] = []
    ) throws -> ControlSnapshot {
        return try checked {
            let current = try repository.loadSnapshot()
            guard current.snapshotSequence == expectedSequence,
                  let command = try repository.loadCommand(commandID)?.command, command.status == .applying,
                  let candidate = try repository.loadCandidate(commandID) else { throw StorageError.conflict }
            try repository.validateCandidate(candidate, against: current.policy)
            try repository.applyCandidateGrantChanges(candidate: candidate, current: current, context: context,
                                                       confirmation: confirmation, changes: grantChanges,
                                                       uncommittedReceipts: receiptsWrittenHere)
            try repository.database.execute("""
                UPDATE control_state SET last_valid_policy=policy,policy=?,policy_revision=?,snapshot_sequence=? WHERE singleton=1
                """, [.blob(try JSONEncoder().encode(candidate.proposedPolicy)), .integer(candidate.proposedPolicy.revision.rawValue),
                      .integer(try current.snapshotSequence.next().rawValue)])
            try repository.database.execute("UPDATE policy_candidates SET activated_revision=? WHERE command_id=?", [
                .integer(candidate.proposedPolicy.revision.rawValue), .text(commandID.rawValue.uuidString)
            ])
            return try repository.loadSnapshot()
        }
    }
}

extension ControlRepository {
    public func write<T>(_ body: (ControlTransaction) throws -> T) throws -> T {
        try serialized {
            try database.transaction(writer: true) {
                _ = try loadSnapshot()
                let transaction = ControlTransaction(repository: self)
                defer { transaction.finish() }
                let result = try body(transaction)
                try transaction.validateCommit()
                return result
            }
        }
    }

    public func command(_ id: CommandID) throws -> Command? {
        try serialized { try database.transaction(writer: false) {
            _ = try loadSnapshot()
            return try loadCommand(id)?.command
        } }
    }

    public func candidate(commandID: CommandID) throws -> PolicyCandidate? {
        try serialized { try database.transaction(writer: false) {
            _ = try loadSnapshot()
            return try loadCandidate(commandID)
        } }
    }

    public func attempts(commandID: CommandID) throws -> [Command] {
        try serialized { try database.transaction(writer: false) {
            _ = try loadSnapshot()
            return try database.rows("SELECT attempt,record FROM command_attempts WHERE command_id=? ORDER BY attempt", [
                .text(commandID.rawValue.uuidString)
            ]).map { row in
                guard case let .integer(attempt) = row[0], case let .blob(data) = row[1] else { throw StorageError.corrupt }
                let command = try decodeCommand(data)
                guard command.id == commandID, command.attempt.rawValue == attempt else { throw StorageError.corrupt }
                return command
            }
        } }
    }

    /// Only the main app calls explicit migration; Extension opens never migrate implicitly.
    public static func migrate(at url: URL, busyTimeoutMilliseconds: Int32 = 100) throws -> ControlRepository {
        guard validFileURL(url) else { throw StorageError.unavailable }
        guard FileManager.default.fileExists(atPath: url.path) else { throw StorageError.missingDatabase }
        return try StorageError.translating {
            let repository = try ControlRepository(url: url, busyTimeoutMilliseconds: busyTimeoutMilliseconds)
            try repository.database.transaction(writer: true) {
                let rows = try repository.database.rows("PRAGMA user_version")
                guard case let .integer(version) = rows.first?.first else { throw StorageError.corrupt }
                guard [Int64(1), 2, 3, 4, 5, Self.schemaVersion].contains(version) else { throw StorageError.unsupportedSchema(version) }
                _ = try repository.loadSnapshot(expectedSchema: version)
                guard try repository.database.rows("PRAGMA quick_check(1)") == [[.text("ok")]],
                      try repository.database.rows("PRAGMA journal_mode") == [[.text("wal")]] else { throw StorageError.corrupt }
                if version == 1 {
                    try repository.createCommandTables()
                }
                if version < 3 { try repository.createGrantTables() }
                if version < 4 { try repository.createHistoryTables() }
                if version < 5 { try repository.createApplicationTable() }
                if version < 6 { try repository.createActivationTable() }
                try repository.database.execute("PRAGMA user_version=\(Self.schemaVersion)")
            }
            return repository
        }
    }

    func createCommandTables() throws {
        try database.execute("""
            CREATE TABLE commands (
                command_id TEXT PRIMARY KEY NOT NULL,kind TEXT NOT NULL,expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
                record BLOB NOT NULL,intent BLOB NOT NULL)
            """)
        try database.execute("""
            CREATE TABLE command_attempts (command_id TEXT NOT NULL REFERENCES commands(command_id),attempt INTEGER NOT NULL CHECK(attempt>=0),
                record BLOB NOT NULL,PRIMARY KEY(command_id,attempt))
            """)
        try database.execute("""
            CREATE TABLE policy_candidates (command_id TEXT PRIMARY KEY NOT NULL REFERENCES commands(command_id),
                base_revision INTEGER NOT NULL CHECK(base_revision>=0),proposed_policy BLOB NOT NULL)
            """)
    }

    func advanceSequence() throws {
        let sequence = try loadSnapshot().snapshotSequence.next()
        try database.execute("UPDATE control_state SET snapshot_sequence=? WHERE singleton=1", [.integer(sequence.rawValue)])
    }

    func validateCandidate(_ candidate: PolicyCandidate, against policy: PolicySnapshot) throws {
        do { try candidate.validate(against: policy) }
        catch ModelError.stalePolicyRevision { throw StorageError.conflict }
        catch ModelError.invalidRuleVersion { throw StorageError.invalidCommand }
    }

    func storeAttempt(_ command: Command) throws {
        try database.execute("""
            INSERT INTO command_attempts VALUES (?,?,?) ON CONFLICT(command_id,attempt) DO UPDATE SET record=excluded.record
            """, [.text(command.id.rawValue.uuidString), .integer(command.attempt.rawValue),
                  .blob(try JSONEncoder().encode(CommandDTO(command)))])
    }

    func insertCommand(_ command: Command, intent: CommandIntent) throws {
        try database.execute("INSERT INTO commands VALUES (?,?,?,?,?)", [
            .text(command.id.rawValue.uuidString), .text(command.kind.rawValue),
            .integer(command.expectedPolicyRevision.rawValue), .blob(try JSONEncoder().encode(CommandDTO(command))),
            .blob(try JSONEncoder().encode(intent))
        ])
        try storeAttempt(command)
    }

    func loadCommand(_ id: CommandID) throws -> StoredCommandRow? {
        let rows = try database.rows("SELECT kind,expected_revision,record,intent FROM commands WHERE command_id=?", [.text(id.rawValue.uuidString)])
        guard let row = rows.first else { return nil }
        guard rows.count == 1, case let .text(kind) = row[0], case let .integer(base) = row[1],
              case let .blob(data) = row[2], case let .blob(intentData) = row[3] else { throw StorageError.corrupt }
        let command = try decodeCommand(data)
        do {
            let intent = try JSONDecoder().decode(CommandIntent.self, from: intentData)
            guard command.id == id, command.kind.rawValue == kind, command.expectedPolicyRevision.rawValue == base,
                  intent.schemaVersion == 1, intent.matches(command) else { throw StorageError.corrupt }
            switch command.kind {
            case .commitPolicy:
                guard let policy = intent.policy, intent.grant == nil,
                      policy.revision == command.candidatePolicyRevision else { throw StorageError.corrupt }
                _ = try PolicyCandidate(commandID: id, expectedRevision: command.expectedPolicyRevision, proposedPolicy: policy)
            case .requestTemporaryGrant:
                guard let grant = intent.grant, intent.policy == nil, command.candidatePolicyRevision == nil,
                      grant.mode != .unavailable, grant.mode != .reason || command.reasonRef != nil,
                      try loadGrantResultID(id) != nil else { throw StorageError.corrupt }
                _ = try grant.occurrence.model()
            case .stop, .resumeAfterAuthorization:
                guard intent.policy == nil, intent.grant == nil, command.candidatePolicyRevision == nil,
                      command.reasonRef == nil else { throw StorageError.corrupt }
            default: throw StorageError.corrupt
            }
            return StoredCommandRow(command: command, intent: intent)
        } catch { throw StorageError.corrupt }
    }

    func loadCandidate(_ id: CommandID) throws -> PolicyCandidate? {
        let rows = try database.rows("SELECT base_revision,proposed_policy FROM policy_candidates WHERE command_id=?", [.text(id.rawValue.uuidString)])
        guard let row = rows.first else {
            if try loadCommand(id)?.command.kind == .commitPolicy { throw StorageError.corrupt }
            return nil
        }
        guard rows.count == 1, case let .integer(base) = row[0], case let .blob(data) = row[1],
              let command = try loadCommand(id) else { throw StorageError.corrupt }
        do {
            let policy = try JSONDecoder().decode(PolicySnapshot.self, from: data)
            guard command.command.expectedPolicyRevision.rawValue == base, policy == command.intent.policy else { throw StorageError.corrupt }
            return try PolicyCandidate(commandID: id, expectedRevision: PolicyRevision(base), proposedPolicy: policy)
        } catch { throw StorageError.corrupt }
    }

    private func decodeCommand(_ data: Data) throws -> Command {
        do { return try JSONDecoder().decode(CommandDTO.self, from: data).model() }
        catch { throw StorageError.corrupt }
    }
}

struct StoredCommandRow { let command: Command; let intent: CommandIntent }

/// Compare decoded structural fields, never JSON byte order or a hash of the reason body.
struct CommandIntent: Equatable, Codable {
    var schemaVersion = 1
    let id: CommandID
    let kind: CommandKind
    let expectedRevision: PolicyRevision
    let candidateRevision: PolicyRevision?
    let reasonRef: ReasonRef?
    let policy: PolicySnapshot?
    let grant: GrantRequestIntent?

    init(command: Command, policy: PolicySnapshot?) {
        id = command.id; kind = command.kind; expectedRevision = command.expectedPolicyRevision
        candidateRevision = command.candidatePolicyRevision; reasonRef = command.reasonRef; self.policy = policy; grant = nil
    }
    init(command: Command, request: GrantRequest) {
        id = command.id; kind = command.kind; expectedRevision = command.expectedPolicyRevision
        candidateRevision = command.candidatePolicyRevision; reasonRef = command.reasonRef; policy = nil; grant = GrantRequestIntent(request)
    }
    func matches(_ command: Command) -> Bool {
        id == command.id && kind == command.kind && expectedRevision == command.expectedPolicyRevision
            && candidateRevision == command.candidatePolicyRevision && reasonRef == command.reasonRef
    }
}

struct CommandDTO: Codable {
    var schemaVersion = 1
    let id: CommandID
    let kind: CommandKind
    let expectedRevision: PolicyRevision
    let candidateRevision: PolicyRevision?
    let status: CommandStatus
    let attempt: AttemptNumber
    let reasonRef: ReasonRef?

    init(_ command: Command) {
        id = command.id; kind = command.kind; expectedRevision = command.expectedPolicyRevision
        candidateRevision = command.candidatePolicyRevision; status = command.status; attempt = command.attempt; reasonRef = command.reasonRef
    }
    func model() throws -> Command {
        guard schemaVersion == 1 else { throw StorageError.corrupt }
        return try Command(id: id, kind: kind, status: status, expectedPolicyRevision: expectedRevision,
                           candidatePolicyRevision: candidateRevision, attempt: attempt, reasonRef: reasonRef)
    }
}
