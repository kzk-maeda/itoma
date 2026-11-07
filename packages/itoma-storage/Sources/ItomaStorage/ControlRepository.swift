import Foundation
import ItomaSQLite
import ItomaCore
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// The adapter supplies token identity/normalization. Opaque bytes are never names or hashes.
public struct StoredSelection: Equatable, Sendable {
    public let selection: Selection
    public let opaquePayload: Data

    public init(selection: Selection, opaquePayload: Data) {
        self.selection = selection
        self.opaquePayload = opaquePayload
    }
}

public struct ControlSnapshot: Equatable, Sendable {
    public let policy: PolicySnapshot
    public let lastValidPolicy: PolicySnapshot
    public let snapshotSequence: SnapshotSequence
    public let activation: Activation
    public let selections: [StoredSelection]
    public let application: StoredApplication?
    public let activationCommandID: CommandID?
}

/// A connection is serialized locally; separate processes coordinate with SQLite transactions.
/// This class is deliberately not Sendable. A controller owns it on one isolation domain.
public final class ControlRepository {
    static let schemaVersion: Int64 = 6
    static let applicationID: Int64 = 0x49544F4D
    let database: SQLiteDatabase
    private let lock = NSRecursiveLock()

    public static func create(
        at url: URL, initialPolicy: PolicySnapshot, selections: [StoredSelection] = [],
        activation: Activation, busyTimeoutMilliseconds: Int32 = 100
    ) throws -> ControlRepository {
        guard Self.validFileURL(url) else { throw StorageError.unavailable }
        guard busyTimeoutMilliseconds >= 0 else { throw StorageError.databaseFailure }
        try validateSelections(selections, policy: initialPolicy)
        // SQLite CREATE must never turn a missing/corrupt/locked existing DB into empty settings.
        // Claim a new file exclusively before opening it without SQLITE_OPEN_CREATE.
        #if canImport(Darwin)
        let descriptor = url.path.withCString { Darwin.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #else
        let descriptor = url.path.withCString { Glibc.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #endif
        guard descriptor >= 0 else {
            throw errno == EEXIST ? StorageError.alreadyExists : StorageError.unavailable
        }
        #if canImport(Darwin)
        Darwin.close(descriptor)
        #else
        Glibc.close(descriptor)
        #endif
        return try StorageError.translating {
            let repository = try ControlRepository(url: url, busyTimeoutMilliseconds: busyTimeoutMilliseconds)
            guard try repository.database.rows("PRAGMA journal_mode=WAL") == [[.text("wal")]] else {
                throw StorageError.unavailable
            }
            try repository.database.execute("PRAGMA synchronous=FULL")
            try repository.database.transaction(writer: true) {
                try repository.database.execute("""
                    CREATE TABLE control_state (
                        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                        policy BLOB NOT NULL, last_valid_policy BLOB NOT NULL,
                        policy_revision INTEGER NOT NULL CHECK(policy_revision>=0),
                        snapshot_sequence INTEGER NOT NULL CHECK(snapshot_sequence>=0),
                        activation TEXT NOT NULL CHECK(activation IN ('enabled','paused','awaitingReauthorizationConfirmation'))
                    )
                    """)
                try repository.database.execute("CREATE TABLE selections (ref TEXT PRIMARY KEY NOT NULL, targets BLOB NOT NULL, opaque_payload BLOB NOT NULL)")
                try repository.createCommandTables()
                try repository.createGrantTables()
                try repository.createHistoryTables()
                try repository.createApplicationTable()
                try repository.createActivationTable()
                try repository.database.execute("PRAGMA application_id=0x49544F4D")
                try repository.database.execute("PRAGMA user_version=\(Self.schemaVersion)")
                let data = try JSONEncoder().encode(initialPolicy)
                try repository.database.execute("INSERT INTO control_state VALUES (1,?,?,?,?,?)", [
                    .blob(data), .blob(data), .integer(initialPolicy.revision.rawValue), .integer(0), .text(activation.rawValue)
                ])
                for item in selections { try repository.insertSelection(item) }
            }
            return repository
        }
    }

    public static func open(at url: URL, busyTimeoutMilliseconds: Int32 = 100) throws -> ControlRepository {
        guard Self.validFileURL(url) else { throw StorageError.unavailable }
        guard FileManager.default.fileExists(atPath: url.path) else { throw StorageError.missingDatabase }
        return try StorageError.translating {
            let repository = try ControlRepository(url: url, busyTimeoutMilliseconds: busyTimeoutMilliseconds)
            guard try repository.database.rows("PRAGMA user_version") == [[.integer(schemaVersion)]] else {
                let version = try repository.database.rows("PRAGMA user_version")
                if case let .integer(number) = version.first?.first { throw StorageError.unsupportedSchema(number) }
                throw StorageError.corrupt
            }
            guard try repository.database.rows("PRAGMA application_id") == [[.integer(applicationID)]] else {
                throw StorageError.wrongDatabase
            }
            guard try repository.database.rows("PRAGMA quick_check(1)") == [[.text("ok")]],
                  try repository.database.rows("PRAGMA journal_mode") == [[.text("wal")]] else { throw StorageError.corrupt }
            do { _ = try repository.readSnapshot() }
            catch StorageError.databaseFailure { throw StorageError.corrupt }
            return repository
        }
    }

    init(url: URL, busyTimeoutMilliseconds: Int32) throws {
        database = try StorageError.translating { try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: busyTimeoutMilliseconds) }
    }

    static func validFileURL(_ url: URL) -> Bool {
        // URL.path can preserve "%00" instead of decoding it; validate the decoded component.
        guard url.isFileURL, let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return !components.path.utf8.contains(0)
    }

    public func close() throws { try serialized { try database.close() } }

    /// Guard before starting private writes or external I/O on this connection's controller flow.
    /// Other processes/connections may still hold their own transactions; this is not a file lease.
    public func requireOutsideTransaction() throws {
        try serialized {
            guard !database.hasActiveTransaction else { throw StorageError.nestedTransaction }
        }
    }

    public func readSnapshot() throws -> ControlSnapshot {
        try serialized { try database.transaction(writer: false) { try loadSnapshot() } }
    }

    /// State intent only; this does not apply or verify any OS restrictions.
    public func setActivation(_ activation: Activation, expectedSequence: SnapshotSequence) throws -> ControlSnapshot {
        try serialized {
            try database.transaction(writer: true) {
                try updateActivation(activation, expectedSequence: expectedSequence)
            }
        }
    }

    /// Selection references are immutable: edits prepare a new ref before activating a new rule version.
    public func putSelection(_ selection: StoredSelection, expectedSequence: SnapshotSequence) throws -> ControlSnapshot {
        try serialized {
            try database.transaction(writer: true) {
                let current = try loadSnapshot()
                guard current.snapshotSequence == expectedSequence else { throw StorageError.conflict }
                if let stored = current.selections.first(where: { $0.selection.ref == selection.selection.ref }) {
                    guard stored == selection else { throw StorageError.conflict }
                } else {
                    try insertSelection(selection)
                    try database.execute("UPDATE control_state SET snapshot_sequence=? WHERE singleton=1", [
                        .integer(try current.snapshotSequence.next().rawValue)
                    ])
                }
                return try loadSnapshot()
            }
        }
    }

    func serialized<T>(_ body: () throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        return try StorageError.translating(body)
    }

    func loadSnapshot(expectedSchema: Int64 = ControlRepository.schemaVersion) throws -> ControlSnapshot {
        // Recheck inside every transaction: another process may migrate the DB after open().
        try validateSchema(expectedSchema)
        let state = try database.rows("SELECT policy,last_valid_policy,policy_revision,snapshot_sequence,activation FROM control_state WHERE singleton=1")
        guard state.count == 1, state[0].count == 5,
              case let .blob(policyData) = state[0][0], case let .blob(lastData) = state[0][1],
              case let .integer(revision) = state[0][2], case let .integer(sequence) = state[0][3],
              case let .text(rawActivation) = state[0][4], let activation = Activation(rawValue: rawActivation)
        else { throw StorageError.corrupt }
        do {
            let policy = try JSONDecoder().decode(PolicySnapshot.self, from: policyData)
            let last = try JSONDecoder().decode(PolicySnapshot.self, from: lastData)
            guard policy.revision.rawValue == revision else { throw StorageError.corrupt }
            let rows = try database.rows("SELECT ref,targets,opaque_payload FROM selections ORDER BY ref")
            let selections: [StoredSelection] = try rows.map { row in
                guard row.count == 3, case let .text(id) = row[0], let uuid = UUID(uuidString: id),
                      case let .blob(targetData) = row[1], case let .blob(opaque) = row[2] else { throw StorageError.corrupt }
                let targets = try JSONDecoder().decode([TargetRef].self, from: targetData)
                guard Set(targets).count == targets.count else { throw StorageError.corrupt }
                return StoredSelection(selection: Selection(ref: SelectionRef(uuid), targets: Set(targets)), opaquePayload: opaque)
            }
            do { try Self.validateSelections(selections, policy: policy) }
            catch { throw StorageError.corrupt }
            let application = expectedSchema >= 5 ? try loadApplication() : nil
            if let application {
                guard application.evaluation.policyRevision <= policy.revision,
                      application.evaluation.snapshotSequence.rawValue <= sequence else { throw StorageError.corrupt }
            }
            return ControlSnapshot(policy: policy, lastValidPolicy: last, snapshotSequence: try SnapshotSequence(sequence),
                                   activation: activation, selections: selections, application: application,
                                   activationCommandID: expectedSchema >= 6 ? try loadActivationCommandID() : nil)
        } catch let error as StorageError { throw error }
        catch let error as SQLiteFailure { return try StorageError.translating { throw error } }
        catch { throw StorageError.corrupt }
    }

    private func validateSchema(_ expected: Int64) throws {
        let rows = try database.rows("PRAGMA user_version")
        guard case let .integer(version) = rows.first?.first else { throw StorageError.corrupt }
        guard version == expected else { throw StorageError.unsupportedSchema(version) }
        guard try database.rows("PRAGMA application_id") == [[.integer(Self.applicationID)]] else {
            throw StorageError.wrongDatabase
        }
        if expected >= 2 {
            do {
                try database.execute("SELECT command_id,kind,expected_revision,record,intent FROM commands LIMIT 0")
                try database.execute("SELECT command_id,attempt,record FROM command_attempts LIMIT 0")
                try database.execute("SELECT command_id,base_revision,proposed_policy FROM policy_candidates LIMIT 0")
            } catch SQLiteFailure.failure { throw StorageError.corrupt }
        }
        if expected >= 3 {
            do {
                try database.execute("SELECT grant_id,command_id,target_ref,reserved,retired,record FROM grants LIMIT 0")
                try database.execute("SELECT registration_id,grant_id,command_id,generation,record FROM registrations LIMIT 0")
                try database.execute("SELECT command_id,grant_id FROM command_grant_results LIMIT 0")
                try database.execute("SELECT activated_revision FROM policy_candidates LIMIT 0")
                guard try database.rows("SELECT name FROM sqlite_master WHERE type='index' AND name='grants_one_reserved_target'") == [[.text("grants_one_reserved_target")]] else { throw StorageError.corrupt }
            } catch SQLiteFailure.failure { throw StorageError.corrupt }
        }
        if expected >= 4 {
            do {
                try database.execute("SELECT singleton,source_id,last_sequence,history_incomplete FROM history_state LIMIT 0")
                try database.execute("SELECT event_id,sequence FROM history_event_ids LIMIT 0")
                try database.execute("SELECT event_id,record FROM history_outbox LIMIT 0")
            } catch SQLiteFailure.failure { throw StorageError.corrupt }
            _ = try loadHistoryBoundary()
        }
        if expected >= 5 {
            do { try database.execute("SELECT singleton,record FROM application_state LIMIT 0") }
            catch SQLiteFailure.failure { throw StorageError.corrupt }
        }
        if expected >= 6 {
            do { try database.execute("SELECT singleton,command_id FROM activation_state LIMIT 0") }
            catch SQLiteFailure.failure { throw StorageError.corrupt }
        }
    }

    private func insertSelection(_ item: StoredSelection) throws {
        let targets = item.selection.targets.sorted { $0.rawValue.uuidString < $1.rawValue.uuidString }
        try database.execute("INSERT INTO selections VALUES (?,?,?)", [
            .text(item.selection.ref.rawValue.uuidString), .blob(try JSONEncoder().encode(targets)), .blob(item.opaquePayload)
        ])
    }

    private static func validateSelections(_ selections: [StoredSelection], policy: PolicySnapshot) throws {
        let refs = Set(selections.map(\.selection.ref))
        guard refs.count == selections.count,
              policy.rules.filter(\.enabled).allSatisfy({ refs.contains($0.selectionRef) }) else { throw StorageError.invalidSelection }
    }
}
