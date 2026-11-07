import Foundation
import ItomaCore
import ItomaSQLite
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Only the main app imports this product. The adapter chooses a private container and applies
/// iOS protection/backup attributes to the DB and sidecars; this portable layer cannot verify them.
/// Non-Sendable, synchronous, and locally serialized. No public callback can hold its writer open.
public final class HistoryRepository {
    static let schemaVersion: Int64 = 2
    static let applicationID: Int64 = 0x49544849
    let database: SQLiteDatabase
    let capacityPolicy: HistoryCapacityPolicy
    let url: URL
    private let lock = NSLock()

    public static func create(
        at url: URL, capacity: HistoryCapacityPolicy, busyTimeoutMilliseconds: Int32 = 100
    ) throws -> HistoryRepository {
        guard validFileURL(url) else { throw HistoryError.unavailable }
        guard busyTimeoutMilliseconds >= 0 else { throw HistoryError.databaseFailure }
        #if canImport(Darwin)
        let descriptor = url.path.withCString { Darwin.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #else
        let descriptor = url.path.withCString { Glibc.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #endif
        guard descriptor >= 0 else { throw errno == EEXIST ? HistoryError.alreadyExists : HistoryError.unavailable }
        #if canImport(Darwin)
        Darwin.close(descriptor)
        #else
        Glibc.close(descriptor)
        #endif
        return try HistoryError.translating {
            let repository = try HistoryRepository(url: url, capacity: capacity, busyTimeoutMilliseconds: busyTimeoutMilliseconds)
            guard try repository.database.rows("PRAGMA journal_mode=WAL") == [[.text("wal")]] else { throw HistoryError.unavailable }
            try repository.database.execute("PRAGMA synchronous=FULL")
            try repository.database.transaction(writer: true) {
                try repository.database.execute("""
                    CREATE TABLE reasons (
                        reason_ref TEXT COLLATE NOCASE PRIMARY KEY NOT NULL,
                        command_id TEXT COLLATE NOCASE UNIQUE NOT NULL,
                        prepared_at BLOB NOT NULL,
                        body BLOB,
                        payload_bytes INTEGER NOT NULL CHECK(payload_bytes>=0),
                        CHECK((body IS NULL AND payload_bytes=0) OR (body IS NOT NULL AND length(body)=payload_bytes))
                    )
                    """)
                try repository.createPrivateHistoryTables()
                try repository.database.execute("PRAGMA application_id=0x49544849")
                try repository.database.execute("PRAGMA user_version=\(Self.schemaVersion)")
            }
            return repository
        }
    }

    public static func open(
        at url: URL, capacity: HistoryCapacityPolicy, busyTimeoutMilliseconds: Int32 = 100
    ) throws -> HistoryRepository {
        guard validFileURL(url) else { throw HistoryError.unavailable }
        guard FileManager.default.fileExists(atPath: url.path) else { throw HistoryError.missingDatabase }
        return try HistoryError.translating {
            let repository = try HistoryRepository(url: url, capacity: capacity, busyTimeoutMilliseconds: busyTimeoutMilliseconds)
            try repository.transaction(writer: false) {
                guard try repository.database.rows("PRAGMA quick_check(1)") == [[.text("ok")]],
                      try repository.database.rows("PRAGMA journal_mode") == [[.text("wal")]] else { throw HistoryError.corrupt }
                _ = try repository.loadReasons()
                try repository.validatePrivateHistory()
            }
            return repository
        }
    }

    init(url: URL, capacity: HistoryCapacityPolicy, busyTimeoutMilliseconds: Int32) throws {
        self.url = url
        capacityPolicy = capacity
        database = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: busyTimeoutMilliseconds)
    }

    static func validFileURL(_ url: URL) -> Bool {
        guard url.isFileURL, let parts = URLComponents(url: url, resolvingAgainstBaseURL: true) else { return false }
        // Decoded accessors can retain %00 on Apple Foundation; do not recursively decode %2500.
        return !url.path.utf8.contains(0) && !parts.path.utf8.contains(0)
            && !parts.percentEncodedPath.contains("%00")
    }

    public func close() throws {
        lock.lock(); defer { lock.unlock() }
        try HistoryError.translating { try database.close() }
    }

    /// Call only after the user's confirmation. Preserve original UTF-8 after nonblank validation.
    /// A retry returns the first commit's time. Reusing either identity with another body conflicts.
    /// Deleted identities are never recreated, even when the caller resends the original body.
    public func prepareReason(
        reasonRef: ReasonRef, commandID: CommandID, body: String, at: Instant
    ) throws -> ReasonRecord {
        do { _ = try UnlockCondition.reason(body) }
        catch { throw HistoryError.invalidReason }
        let bytes = Data(body.utf8)
        return try transaction(writer: true) {
            guard try loadDummy(commandID) == nil else { throw HistoryError.conflict }
            let records = try loadReasons(filter: "WHERE command_id=? OR reason_ref=?", bindings: [
                .text(commandID.rawValue.uuidString), .text(reasonRef.rawValue.uuidString)
            ])
            if let existing = records.first(where: { $0.commandID == commandID || $0.reasonRef == reasonRef }) {
                guard existing.commandID == commandID, existing.reasonRef == reasonRef else { throw HistoryError.conflict }
                guard let original = existing.body else { throw HistoryError.deleted }
                guard Data(original.utf8) == bytes else { throw HistoryError.conflict }
                return existing
            }
            let used = try logicalBytes()
            guard Int64(bytes.count) <= capacityPolicy.maximumBytes - used else { throw HistoryError.capacityExceeded }
            try database.execute("INSERT INTO reasons VALUES (?,?,?,?,?)", [
                .text(reasonRef.rawValue.uuidString), .text(commandID.rawValue.uuidString),
                .blob(try JSONEncoder().encode(at)), .blob(bytes), .integer(Int64(bytes.count))
            ])
            return ReasonRecord(reasonRef: reasonRef, commandID: commandID, preparedAt: at, body: body)
        }
    }

    public func reason(for commandID: CommandID) throws -> ReasonRecord? {
        try transaction(writer: false) {
            try loadReasons(filter: "WHERE command_id=?", bindings: [.text(commandID.rawValue.uuidString)]).first
        }
    }

    public func reasons(limit: Int = 100, after reasonRef: ReasonRef? = nil) throws -> [ReasonRecord] {
        guard (1...500).contains(limit) else { throw HistoryError.invalidPage }
        return try transaction(writer: false) {
            try loadReasons(filter: "WHERE reason_ref>?", bindings: [.text(reasonRef?.rawValue.uuidString ?? "")], limit: limit)
        }
    }

    /// Logical deletion, not forensic erasure from SQLite pages/WAL/backups. Never changes control.
    /// This deletes reasons only. Use deleteHistory(from:) for history payloads and source cutoffs.
    public func deleteReasons() throws {
        try transaction(writer: true) {
            _ = try loadReasons()
            try database.execute("UPDATE reasons SET body=NULL,payload_bytes=0")
        }
    }

    public func capacity() throws -> HistoryCapacity {
        try transaction(writer: false) {
            let bytes = try logicalBytes()
            return HistoryCapacity(logicalPayloadBytes: bytes, warningReached: bytes >= capacityPolicy.warningBytes,
                                   limitReached: bytes >= capacityPolicy.maximumBytes)
        }
    }

    public func fileUsage() -> HistoryFileUsage {
        lock.lock(); defer { lock.unlock() }
        func size(_ path: String) -> Int64? {
            do {
                let attributes = try FileManager.default.attributesOfItem(atPath: path)
                return (attributes[.size] as? NSNumber)?.int64Value
            } catch let error as CocoaError where error.code == .fileReadNoSuchFile { return 0 }
            catch { return nil }
        }
        return HistoryFileUsage(databaseBytes: size(url.path), walBytes: size(url.path + "-wal"),
                                sharedMemoryBytes: size(url.path + "-shm"))
    }

    func transaction<T>(writer: Bool, _ body: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        return try HistoryError.translating {
            try database.transaction(writer: writer) {
                try validateSchema()
                return try body()
            }
        }
    }

    func validateSchema(expected: Int64 = HistoryRepository.schemaVersion) throws {
        guard case let .integer(version) = try database.rows("PRAGMA user_version").first?.first else { throw HistoryError.corrupt }
        guard version == expected else { throw HistoryError.unsupportedSchema(version) }
        guard try database.rows("PRAGMA application_id") == [[.integer(Self.applicationID)]] else { throw HistoryError.wrongDatabase }
        do { try database.execute("SELECT reason_ref,command_id,prepared_at,body,payload_bytes FROM reasons LIMIT 0") }
        catch SQLiteFailure.failure { throw HistoryError.corrupt }
        if expected >= 2 {
            do {
                try database.execute("SELECT command_id,prepared_at,payload,payload_bytes FROM dummy_selections LIMIT 0")
                try database.execute("SELECT source_id,observed_through,deleted_through,history_incomplete FROM history_sources LIMIT 0")
                try database.execute("SELECT cursor,event_id,source_id,sequence,record,payload_bytes FROM history_events LIMIT 0")
            } catch SQLiteFailure.failure { throw HistoryError.corrupt }
        }
    }

    func logicalBytes() throws -> Int64 {
        // Do not load every body for each new reason or capacity refresh. Validate lengths in SQL;
        // individual reads and open() validate UTF-8 and the Core input contract as well.
        var total: Int64 = 0
        for (table, column) in [("reasons", "body"), ("dummy_selections", "payload"), ("history_events", "record")] {
            let invalid = try database.rows("SELECT 1 FROM \(table) WHERE payload_bytes<0 OR (\(column) IS NULL AND payload_bytes!=0) OR (\(column) IS NOT NULL AND (typeof(\(column))!='blob' OR length(\(column))!=payload_bytes)) LIMIT 1")
            guard invalid.isEmpty, case let .integer(bytes) = try database.rows("SELECT coalesce(sum(payload_bytes),0) FROM \(table)").first?.first,
                  bytes >= 0 else { throw HistoryError.corrupt }
            let (next, overflow) = total.addingReportingOverflow(bytes)
            guard !overflow else { throw HistoryError.corrupt }
            total = next
        }
        return total
    }

    func loadReasons(filter: String = "", bindings: [SQLValue] = [], limit: Int? = nil) throws -> [ReasonRecord] {
        // filter is repository-owned SQL only, never caller text. Page size is validated publicly.
        let suffix = limit == nil ? "" : " LIMIT ?"
        let values = bindings + (limit.map { [.integer(Int64($0))] } ?? [])
        return try database.rows("SELECT reason_ref,command_id,prepared_at,body,payload_bytes FROM reasons \(filter) ORDER BY reason_ref\(suffix)", values).map { row in
            guard row.count == 5, case let .text(rawRef) = row[0], let ref = UUID(uuidString: rawRef), rawRef == ref.uuidString,
                  case let .text(rawCommand) = row[1], let command = UUID(uuidString: rawCommand), rawCommand == command.uuidString,
                  case let .blob(timeData) = row[2], case let .integer(bytes) = row[4], bytes >= 0 else { throw HistoryError.corrupt }
            let time: Instant
            do { time = try JSONDecoder().decode(Instant.self, from: timeData) }
            catch { throw HistoryError.corrupt }
            let body: String?
            switch row[3] {
            case let .blob(data):
                guard let text = String(data: data, encoding: .utf8), bytes == Int64(data.count) else { throw HistoryError.corrupt }
                do { _ = try UnlockCondition.reason(text) }
                catch { throw HistoryError.corrupt }
                body = text
            case .null:
                guard bytes == 0 else { throw HistoryError.corrupt }
                body = nil
            default: throw HistoryError.corrupt
            }
            return ReasonRecord(reasonRef: ReasonRef(ref), commandID: CommandID(command), preparedAt: time, body: body)
        }
    }
}
