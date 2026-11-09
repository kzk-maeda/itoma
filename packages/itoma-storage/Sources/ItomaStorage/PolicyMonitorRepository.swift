import Foundation
import ItomaCore
import ItomaSQLite
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Durable OS-registration intent/receipts, without tokens or private reason text.
/// Daily boundary monitors wake Core even on unselected weekdays; Core decides applicability.
public struct PolicyMonitorPlan: Equatable, Codable, Sendable {
    public let id: UUID
    public let policy: PolicySnapshot
    public let acceptedMinutes: Set<Int>
    public var boundaryMinutes: Set<Int> {
        Set(policy.rules.filter(\.enabled).flatMap { [$0.schedule.startMinute, $0.schedule.endMinute] })
    }
    public var isReady: Bool { acceptedMinutes == boundaryMinutes }
    public func activityName(minute: Int) -> String { "itoma.rule.\(id.uuidString.lowercased()).\(minute)" }
    public var activityNames: Set<String> { Set(boundaryMinutes.map(activityName)) }

    public init(id: UUID = UUID(), policy: PolicySnapshot, acceptedMinutes: Set<Int> = []) throws {
        self.id = id; self.policy = policy; self.acceptedMinutes = acceptedMinutes
        guard acceptedMinutes.isSubset(of: boundaryMinutes) else { throw StorageError.conflict }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(id: c.decode(UUID.self, forKey: .id), policy: c.decode(PolicySnapshot.self, forKey: .policy),
                      acceptedMinutes: c.decode(Set<Int>.self, forKey: .acceptedMinutes))
    }
}

/// Separate shared journal, schema1. Host is the only writer; Extension opens read-only flows.
/// Control schema6 and private history schema2 are unchanged. No recreate-on-error behavior.
public final class PolicyMonitorRepository {
    private let database: SQLiteDatabase
    private let lock = NSLock()
    private static let applicationID: Int64 = 0x4954504D

    private init(at url: URL) throws { database = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100) }

    public static func create(at url: URL) throws -> PolicyMonitorRepository {
        guard ControlRepository.validFileURL(url) else { throw StorageError.unavailable }
        #if canImport(Darwin)
        let descriptor = url.path.withCString { Darwin.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #else
        let descriptor = url.path.withCString { Glibc.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #endif
        guard descriptor >= 0 else { throw errno == EEXIST ? StorageError.alreadyExists : StorageError.unavailable }
        #if canImport(Darwin)
        Darwin.close(descriptor)
        #else
        Glibc.close(descriptor)
        #endif
        return try StorageError.translating {
            let repository = try PolicyMonitorRepository(at: url)
            guard try repository.database.rows("PRAGMA journal_mode=WAL") == [[.text("wal")]] else { throw StorageError.unavailable }
            try repository.database.execute("PRAGMA synchronous=FULL")
            try repository.database.transaction(writer: true) {
                try repository.database.execute("CREATE TABLE monitor_plans (id TEXT PRIMARY KEY NOT NULL, payload BLOB NOT NULL)")
                try repository.database.execute("PRAGMA application_id=\(applicationID)")
                try repository.database.execute("PRAGMA user_version=1")
            }
            return repository
        }
    }

    public static func open(at url: URL) throws -> PolicyMonitorRepository {
        guard ControlRepository.validFileURL(url), FileManager.default.fileExists(atPath: url.path) else { throw StorageError.missingDatabase }
        return try StorageError.translating {
            let repository = try PolicyMonitorRepository(at: url)
            guard try repository.database.rows("PRAGMA application_id") == [[.integer(applicationID)]],
                  try repository.database.rows("PRAGMA user_version") == [[.integer(1)]],
                  try repository.database.rows("PRAGMA quick_check(1)") == [[.text("ok")]],
                  try repository.database.rows("PRAGMA journal_mode") == [[.text("wal")]] else { throw StorageError.corrupt }
            _ = try repository.plans()
            return repository
        }
    }

    public func close() throws { lock.lock(); defer { lock.unlock() }; try StorageError.translating { try database.close() } }

    public func plans() throws -> [PolicyMonitorPlan] {
        lock.lock(); defer { lock.unlock() }
        return try StorageError.translating { try database.transaction(writer: false) { try load() } }
    }

    /// First prepare persists before calling OS. Receipt updates are monotonic and CAS guarded.
    public func record(_ plan: PolicyMonitorPlan, expected: PolicyMonitorPlan?) throws {
        lock.lock(); defer { lock.unlock() }
        try StorageError.translating { try database.transaction(writer: true) {
            let old = try load().first { $0.id == plan.id }
            guard old == expected else { throw StorageError.conflict }
            if let old {
                guard old.policy == plan.policy, old.acceptedMinutes.isSubset(of: plan.acceptedMinutes) else { throw StorageError.conflict }
                try database.execute("UPDATE monitor_plans SET payload=? WHERE id=?", [.blob(try JSONEncoder().encode(plan)), .text(plan.id.uuidString)])
            } else {
                guard plan.acceptedMinutes.isEmpty else { throw StorageError.conflict }
                try database.execute("INSERT INTO monitor_plans VALUES (?,?)", [.text(plan.id.uuidString), .blob(try JSONEncoder().encode(plan))])
            }
        } }
    }

    /// Only after this plan's OS activities have been stopped/observed absent.
    public func remove(_ plan: PolicyMonitorPlan) throws {
        lock.lock(); defer { lock.unlock() }
        try StorageError.translating { try database.transaction(writer: true) {
            guard try load().first(where: { $0.id == plan.id }) == plan else { throw StorageError.conflict }
            try database.execute("DELETE FROM monitor_plans WHERE id=?", [.text(plan.id.uuidString)])
        } }
    }

    private func load() throws -> [PolicyMonitorPlan] {
        try database.rows("SELECT id,payload FROM monitor_plans").map { row in
            guard row.count == 2, case let .text(id) = row[0], case let .blob(data) = row[1] else { throw StorageError.corrupt }
            let plan: PolicyMonitorPlan
            do { plan = try JSONDecoder().decode(PolicyMonitorPlan.self, from: data) } catch { throw StorageError.corrupt }
            guard plan.id.uuidString == id else { throw StorageError.corrupt }
            return plan
        }
    }
}
