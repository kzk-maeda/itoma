import Foundation
import ItomaSQLite
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public enum RuleDetailsError: Error { case invalidInput, changed, corrupt, unavailable }

/// Personal text belongs to the host's private store, never the shared control policy.
public struct RuleDetails: Equatable, Sendable {
    public let title: String
    public let goal: String
    public init(title: String, goal: String) throws {
        guard title.utf16.count <= 80, goal.utf16.count <= 1000,
              !title.utf8.contains(0), !goal.utf8.contains(0) else { throw RuleDetailsError.invalidInput }
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        self.goal = goal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : goal
    }
}
public struct RuleDetailsSnapshot: Sendable {
    public let revision: UInt64
    public let rules: [UUID: RuleDetails]
    public init(revision: UInt64 = 0, rules: [UUID: RuleDetails] = [:]) { self.revision = revision; self.rules = rules }
}

/// Small independent SQLite DB. Host-only writer, CAS updates, no history/OS side effects.
public final class RuleDetailsRepository {
    let database: SQLiteDatabase
    let lock = NSLock()
    private static let applicationID: Int64 = 0x49545244
    private init(at url: URL) throws { database = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100) }
    public static func create(at url: URL) throws -> RuleDetailsRepository {
        guard HistoryRepository.validFileURL(url) else { throw RuleDetailsError.unavailable }
        #if canImport(Darwin)
        let fd = url.path.withCString { Darwin.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #else
        let fd = url.path.withCString { Glibc.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #endif
        guard fd >= 0 else { throw RuleDetailsError.unavailable }
        #if canImport(Darwin)
        Darwin.close(fd)
        #else
        Glibc.close(fd)
        #endif
        let store = try RuleDetailsRepository(at: url)
        guard try store.database.rows("PRAGMA journal_mode=WAL") == [[.text("wal")]] else { throw RuleDetailsError.unavailable }
        try store.database.execute("PRAGMA synchronous=FULL")
        try store.database.transaction(writer: true) {
            try store.database.execute("CREATE TABLE rule_details (rule_id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL)")
            try store.database.execute("CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL)")
            try store.database.execute("INSERT INTO metadata VALUES (1,'0')")
            try store.database.execute("PRAGMA application_id=\(applicationID)")
            try store.database.execute("PRAGMA user_version=1")
        }
        return store
    }
    public static func open(at url: URL) throws -> RuleDetailsRepository {
        guard HistoryRepository.validFileURL(url), FileManager.default.fileExists(atPath: url.path) else { throw RuleDetailsError.unavailable }
        let store = try RuleDetailsRepository(at: url)
        guard try store.database.rows("PRAGMA application_id") == [[.integer(applicationID)]],
              try store.database.rows("PRAGMA user_version") == [[.integer(1)]],
              try store.database.rows("PRAGMA quick_check(1)") == [[.text("ok")]],
              try store.database.rows("PRAGMA journal_mode") == [[.text("wal")]] else { throw RuleDetailsError.corrupt }
        _ = try store.read()
        return store
    }
    public func close() throws { lock.lock(); defer { lock.unlock() }; try database.close() }
    public func read() throws -> RuleDetailsSnapshot {
        lock.lock(); defer { lock.unlock() }
        return try database.transaction(writer: false) { try load() }
    }
    public func save(ruleID: UUID, details: RuleDetails, expectedRevision: UInt64, activeRuleIDs: Set<UUID>) throws {
        lock.lock(); defer { lock.unlock() }
        try database.transaction(writer: true) {
            let before = try load()
            guard before.revision == expectedRevision, activeRuleIDs.contains(ruleID), before.revision < UInt64.max else { throw RuleDetailsError.changed }
            try removeInactive(before, keeping: activeRuleIDs)
            if details.title.isEmpty && details.goal.isEmpty {
                try database.execute("DELETE FROM rule_details WHERE rule_id=?", [.text(ruleID.uuidString)])
            } else {
                try database.execute("INSERT INTO rule_details VALUES (?,?,?) ON CONFLICT(rule_id) DO UPDATE SET title=excluded.title,goal=excluded.goal",
                    [.text(ruleID.uuidString), .text(details.title), .text(details.goal)])
            }
            try database.execute("UPDATE metadata SET revision=? WHERE id=1", [.text(String(before.revision + 1))])
        }
    }
    /// Retry deletion cleanup on the next host read; never change shared rules/grants.
    public func prune(activeRuleIDs: Set<UUID>) throws {
        lock.lock(); defer { lock.unlock() }
        try database.transaction(writer: true) {
            let before = try load()
            guard !Set(before.rules.keys).isSubset(of: activeRuleIDs) else { return }
            guard before.revision < UInt64.max else { throw RuleDetailsError.changed }
            try removeInactive(before, keeping: activeRuleIDs)
            try database.execute("UPDATE metadata SET revision=? WHERE id=1", [.text(String(before.revision + 1))])
        }
    }
    private func removeInactive(_ snapshot: RuleDetailsSnapshot, keeping ids: Set<UUID>) throws {
        for id in snapshot.rules.keys where !ids.contains(id) { try database.execute("DELETE FROM rule_details WHERE rule_id=?", [.text(id.uuidString)]) }
    }
    func load() throws -> RuleDetailsSnapshot {
        let rows = try database.rows("SELECT revision FROM metadata WHERE id=1")
        guard rows.count == 1, rows[0].count == 1, case let .text(text) = rows[0][0],
              let revision = UInt64(text), String(revision) == text else { throw RuleDetailsError.corrupt }
        var rules: [UUID: RuleDetails] = [:]
        for row in try database.rows("SELECT rule_id,title,goal FROM rule_details") {
            guard row.count == 3, case let .text(id) = row[0], let uuid = UUID(uuidString: id),
                  case let .text(title) = row[1], case let .text(goal) = row[2], rules[uuid] == nil else { throw RuleDetailsError.corrupt }
            let details = try RuleDetails(title: title, goal: goal)
            guard title == details.title, goal == details.goal else { throw RuleDetailsError.corrupt }
            rules[uuid] = details
        }
        return RuleDetailsSnapshot(revision: revision, rules: rules)
    }
}
