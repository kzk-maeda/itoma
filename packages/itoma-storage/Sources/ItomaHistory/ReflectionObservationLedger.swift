import Foundation
import ItomaCore
import ItomaSQLite
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public enum ReflectionLedgerError: Error, Equatable, Sendable {
    case invalidInput, unavailable, missing, alreadyExists, corrupt, conflict, changed, busy, closed
    case unsupportedSchema(Int64)
}
public enum ReflectionObservationKind: String, Codable, Sendable {
    case policyObserved, ownStoreObserved, unlockRequested, unlockObserved, reblockObserved, stopped, authorizationObserved, contextObserved
}
public enum ReflectionObservationOutcome: String, Codable, Sendable { case pending, accepted, rejected, unknown }

/// A point observation, never a continuous OS restriction interval. No free text or native token.
public struct ReflectionObservation: Codable, Equatable, Sendable {
    public let eventID: UUID
    public let sourceID: UUID
    public let sequence: Int64
    public let observedAt: Instant
    public let kind: ReflectionObservationKind
    public let outcome: ReflectionObservationOutcome
    public let policyRevision: Int64
    public let scopeID: UUID
    public let timeZone: String
    public let scheduledUntil: Instant?

    public init(eventID: UUID, sourceID: UUID, sequence: Int64, observedAt: Instant,
                kind: ReflectionObservationKind, outcome: ReflectionObservationOutcome,
                policyRevision: Int64, scopeID: UUID, timeZone: String, scheduledUntil: Instant? = nil) throws {
        guard sequence > 0, policyRevision >= 0, timeZone.utf8.count <= 128,
              TimeZone(identifier: timeZone) != nil else { throw ReflectionLedgerError.invalidInput }
        self.eventID = eventID; self.sourceID = sourceID; self.sequence = sequence; self.observedAt = observedAt
        self.kind = kind; self.outcome = outcome; self.policyRevision = policyRevision
        self.scopeID = scopeID; self.timeZone = timeZone; self.scheduledUntil = scheduledUntil
    }
    enum CodingKeys: CodingKey { case eventID, sourceID, sequence, observedAt, kind, outcome, policyRevision, scopeID, timeZone, scheduledUntil }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(eventID: c.decode(UUID.self, forKey: .eventID), sourceID: c.decode(UUID.self, forKey: .sourceID),
            sequence: c.decode(Int64.self, forKey: .sequence), observedAt: c.decode(Instant.self, forKey: .observedAt),
            kind: c.decode(ReflectionObservationKind.self, forKey: .kind), outcome: c.decode(ReflectionObservationOutcome.self, forKey: .outcome),
            policyRevision: c.decode(Int64.self, forKey: .policyRevision), scopeID: c.decode(UUID.self, forKey: .scopeID),
            timeZone: c.decode(String.self, forKey: .timeZone), scheduledUntil: c.decodeIfPresent(Instant.self, forKey: .scheduledUntil))
    }
}

public struct ReflectionLedgerCapacity: Sendable {
    public let maximumPayloadBytes: Int64
    public let maximumObservations: Int
    public init(maximumPayloadBytes: Int64, maximumObservations: Int) throws {
        guard maximumPayloadBytes > 0, maximumObservations > 0 else { throw ReflectionLedgerError.invalidInput }
        self.maximumPayloadBytes = maximumPayloadBytes; self.maximumObservations = maximumObservations
    }
}
public enum ReflectionLedgerAppendResult: Equatable, Sendable { case stored, duplicate, deleted, capacityStopped }
public struct ReflectionLedgerPage: Sendable {
    public let revision: Int64
    public let incomplete: Bool
    public let deleted: Bool
    public let logicalPayloadBytes: Int64
    public let observationCount: Int64
    public let observations: [ReflectionObservation]
    public let nextCursor: Int64?
}

/// Isolated private SQLite prototype. Not opened by the app, Extension, or existing History DB.
/// The caller must explicitly choose a private protected container and capacity before integration.
public final class ReflectionObservationLedger {
    private let db: SQLiteDatabase
    private let capacity: ReflectionLedgerCapacity
    private let lock = NSLock()
    private static let applicationID: Int64 = 0x4954524c

    private init(url: URL, capacity: ReflectionLedgerCapacity) throws {
        db = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100); self.capacity = capacity
        try db.execute("PRAGMA synchronous=FULL")
    }
    public static func create(at url: URL, capacity: ReflectionLedgerCapacity) throws -> ReflectionObservationLedger {
        guard HistoryRepository.validFileURL(url) else { throw ReflectionLedgerError.invalidInput }
        #if canImport(Darwin)
        let fd = url.path.withCString { Darwin.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #else
        let fd = url.path.withCString { Glibc.open($0, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600)) }
        #endif
        guard fd >= 0 else { throw errno == EEXIST ? ReflectionLedgerError.alreadyExists : ReflectionLedgerError.unavailable }
        #if canImport(Darwin)
        Darwin.close(fd)
        #else
        Glibc.close(fd)
        #endif
        return try translate {
            let ledger = try Self(url: url, capacity: capacity)
            guard try ledger.db.rows("PRAGMA journal_mode=WAL") == [[.text("wal")]] else { throw ReflectionLedgerError.unavailable }
            try ledger.db.transaction(writer: true) {
                try ledger.db.execute("CREATE TABLE ledger_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0),incomplete INTEGER NOT NULL CHECK(incomplete IN (0,1)),deleted INTEGER NOT NULL CHECK(deleted IN (0,1)))")
                try ledger.db.execute("INSERT INTO ledger_state VALUES(1,0,0,0)")
                try ledger.db.execute("CREATE TABLE ledger_sources(source_id TEXT PRIMARY KEY NOT NULL,high_water INTEGER NOT NULL CHECK(high_water>=0),deleted_through INTEGER NOT NULL CHECK(deleted_through>=0 AND deleted_through<=high_water))")
                try ledger.db.execute("CREATE TABLE ledger_ids(event_id TEXT PRIMARY KEY NOT NULL,source_id TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(sequence>0),UNIQUE(source_id,sequence))")
                try ledger.db.execute("CREATE TABLE ledger_points(cursor INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL REFERENCES ledger_ids(event_id),payload BLOB NOT NULL,payload_bytes INTEGER NOT NULL CHECK(payload_bytes>0 AND payload_bytes=length(payload)))")
                try ledger.db.execute("PRAGMA application_id=\(applicationID)"); try ledger.db.execute("PRAGMA user_version=1")
            }
            return ledger
        }
    }
    public static func open(at url: URL, capacity: ReflectionLedgerCapacity) throws -> ReflectionObservationLedger {
        guard HistoryRepository.validFileURL(url) else { throw ReflectionLedgerError.invalidInput }
        guard FileManager.default.fileExists(atPath: url.path) else { throw ReflectionLedgerError.missing }
        return try translate {
            let ledger = try Self(url: url, capacity: capacity)
            try ledger.transaction(writer: false) {
                guard try ledger.db.rows("PRAGMA quick_check(1)") == [[.text("ok")]],
                      try ledger.db.rows("PRAGMA journal_mode") == [[.text("wal")]] else { throw ReflectionLedgerError.corrupt }
                _ = try ledger.state(); _ = try ledger.totals()
                guard try ledger.db.rows("SELECT 1 FROM ledger_sources WHERE typeof(source_id)!='text' OR length(source_id)!=36 LIMIT 1").isEmpty,
                      try ledger.db.rows("SELECT 1 FROM ledger_ids WHERE typeof(event_id)!='text' OR length(event_id)!=36 LIMIT 1").isEmpty else { throw ReflectionLedgerError.corrupt }
                var lastSource = ""
                while true {
                    let rows = try ledger.db.rows("SELECT source_id,high_water,deleted_through FROM ledger_sources WHERE source_id>? ORDER BY source_id LIMIT 100", [.text(lastSource)])
                    if rows.isEmpty { break }
                    for row in rows {
                        guard case let .text(source) = row[0], let id = UUID(uuidString: source), id.uuidString == source,
                              try Self.integer(row[2]) <= Self.integer(row[1]) else { throw ReflectionLedgerError.corrupt }
                        lastSource = source
                    }
                }
                var lastID = ""
                while true {
                    let rows = try ledger.db.rows("SELECT event_id,source_id,sequence FROM ledger_ids WHERE event_id>? ORDER BY event_id LIMIT 100", [.text(lastID)])
                    if rows.isEmpty { break }
                    for row in rows {
                        guard case let .text(id) = row[0], let uuid = UUID(uuidString: id), uuid.uuidString == id,
                              case let .text(source) = row[1], let sourceID = UUID(uuidString: source), sourceID.uuidString == source,
                              try Self.integer(row[2]) > 0 else { throw ReflectionLedgerError.corrupt }
                        lastID = id
                    }
                }
                guard try ledger.db.rows("SELECT 1 FROM ledger_ids i LEFT JOIN ledger_sources s ON i.source_id=s.source_id WHERE s.source_id IS NULL OR i.sequence>s.high_water LIMIT 1").isEmpty,
                      try ledger.db.rows("SELECT 1 FROM ledger_ids i JOIN ledger_sources s ON i.source_id=s.source_id LEFT JOIN ledger_points p ON p.event_id=i.event_id WHERE p.event_id IS NULL AND i.sequence>s.deleted_through LIMIT 1").isEmpty,
                      try ledger.db.rows("SELECT 1 FROM ledger_points p JOIN ledger_ids i ON p.event_id=i.event_id JOIN ledger_sources s ON i.source_id=s.source_id WHERE i.sequence<=s.deleted_through LIMIT 1").isEmpty else { throw ReflectionLedgerError.corrupt }
                var cursor: Int64 = 0
                while true {
                    let rows = try ledger.db.rows("SELECT p.cursor,p.event_id,p.payload,i.source_id,i.sequence FROM ledger_points p JOIN ledger_ids i ON p.event_id=i.event_id WHERE p.cursor>? ORDER BY p.cursor LIMIT 100", [.integer(cursor)])
                    if rows.isEmpty { break }
                    for row in rows { _ = try ledger.decode(row); cursor = try Self.integer(row[0]) }
                }
                guard try ledger.db.rows("SELECT 1 FROM ledger_points p LEFT JOIN ledger_ids i ON p.event_id=i.event_id WHERE i.event_id IS NULL LIMIT 1").isEmpty,
                      try ledger.db.rows("PRAGMA foreign_key_check").isEmpty else { throw ReflectionLedgerError.corrupt }
            }
            return ledger
        }
    }
    public func close() throws { lock.lock(); defer { lock.unlock() }; try Self.translate { try db.close() } }

    public func append(_ observation: ReflectionObservation) throws -> ReflectionLedgerAppendResult {
        let payload = try Self.encode(observation)
        return try transaction(writer: true) {
            let source = observation.sourceID.uuidString, id = observation.eventID.uuidString
            let existing = try db.rows("SELECT i.event_id,i.source_id,i.sequence,p.payload,s.deleted_through FROM ledger_ids i LEFT JOIN ledger_points p ON i.event_id=p.event_id LEFT JOIN ledger_sources s ON i.source_id=s.source_id WHERE i.event_id=? OR (i.source_id=? AND i.sequence=?)", [.text(id), .text(source), .integer(observation.sequence)])
            if let row = existing.first {
                guard row[0] == .text(id), row[1] == .text(source), row[2] == .integer(observation.sequence) else { throw ReflectionLedgerError.conflict }
                if row[3] == .null {
                    guard try Self.integer(row[4]) >= observation.sequence else { throw ReflectionLedgerError.corrupt }
                    return .deleted
                }
                guard row[3] == .blob(payload) else { throw ReflectionLedgerError.conflict }
                return .duplicate
            }
            let sourceRows = try db.rows("SELECT high_water,deleted_through FROM ledger_sources WHERE source_id=?", [.text(source)])
            let high = try sourceRows.first.map { try Self.integer($0[0]) } ?? 0
            let cutoff = try sourceRows.first.map { try Self.integer($0[1]) } ?? 0
            if observation.sequence <= cutoff { return .deleted }
            let totals = try totals()
            if sourceRows.isEmpty { try db.execute("INSERT INTO ledger_sources VALUES(?,0,0)", [.text(source)]) }
            if Int64(payload.count) > capacity.maximumPayloadBytes - totals.bytes || totals.count >= capacity.maximumObservations {
                try db.execute("UPDATE ledger_sources SET high_water=max(high_water,?) WHERE source_id=?", [.integer(observation.sequence), .text(source)])
                let wasIncomplete = try state().incomplete
                if observation.sequence > high || !wasIncomplete { try advance(incomplete: true) }
                return .capacityStopped
            }
            let gap = high == Int64.max || observation.sequence != high + 1
            try db.execute("INSERT INTO ledger_ids VALUES(?,?,?)", [.text(id), .text(source), .integer(observation.sequence)])
            try db.execute("INSERT INTO ledger_points(event_id,payload,payload_bytes) VALUES(?,?,?)", [.text(id), .blob(payload), .integer(Int64(payload.count))])
            try db.execute("UPDATE ledger_sources SET high_water=max(high_water,?) WHERE source_id=?", [.integer(observation.sequence), .text(source)])
            try advance(incomplete: gap)
            try db.execute("UPDATE ledger_state SET deleted=0 WHERE singleton=1")
            return .stored
        }
    }

    public func page(limit: Int = 40, after cursor: Int64 = 0, expectedRevision: Int64? = nil) throws -> ReflectionLedgerPage {
        guard (1...100).contains(limit), cursor >= 0 else { throw ReflectionLedgerError.invalidInput }
        return try transaction(writer: false) {
            try validateRelations()
            let state = try state()
            if let expectedRevision, state.revision != expectedRevision { throw ReflectionLedgerError.changed }
            let rows = try db.rows("SELECT p.cursor,p.event_id,p.payload,i.source_id,i.sequence FROM ledger_points p JOIN ledger_ids i ON p.event_id=i.event_id WHERE p.cursor>? ORDER BY p.cursor LIMIT ?", [.integer(cursor), .integer(Int64(limit + 1))])
            let visible = Array(rows.prefix(limit)), totals = try totals()
            return ReflectionLedgerPage(revision: state.revision, incomplete: state.incomplete, deleted: state.deleted,
                logicalPayloadBytes: totals.bytes, observationCount: totals.count,
                observations: try visible.map(decode), nextCursor: rows.count > limit ? try visible.last.map { try Self.integer($0[0]) } : nil)
        }
    }

    /// Caller supplies the known source high-water boundary. Payload deletion retains identity metadata.
    public func delete(sourceID: UUID, through sequence: Int64) throws {
        guard sequence >= 0 else { throw ReflectionLedgerError.invalidInput }
        try transaction(writer: true) {
            let source = sourceID.uuidString
            guard let row = try db.rows("SELECT high_water,deleted_through FROM ledger_sources WHERE source_id=?", [.text(source)]).first,
                  sequence <= (try Self.integer(row[0])) else { throw ReflectionLedgerError.invalidInput }
            try db.execute("DELETE FROM ledger_points WHERE event_id IN (SELECT event_id FROM ledger_ids WHERE source_id=? AND sequence<=?)", [.text(source), .integer(sequence)])
            try db.execute("UPDATE ledger_sources SET deleted_through=max(deleted_through,?) WHERE source_id=?", [.integer(sequence), .text(source)])
            try advance(incomplete: false)
            if try totals().count == 0 { try db.execute("UPDATE ledger_state SET deleted=1 WHERE singleton=1") }
        }
    }

    private func transaction<T>(writer: Bool, _ body: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        return try Self.translate {
            try db.transaction(writer: writer) {
                guard try db.rows("PRAGMA application_id") == [[.integer(Self.applicationID)]] else { throw ReflectionLedgerError.corrupt }
                guard let version = try db.rows("PRAGMA user_version").first?.first else { throw ReflectionLedgerError.corrupt }
                guard version == .integer(1) else { throw ReflectionLedgerError.unsupportedSchema(try Self.integer(version)) }
                return try body()
            }
        }
    }
    private func state() throws -> (revision: Int64, incomplete: Bool, deleted: Bool) {
        guard let row = try db.rows("SELECT revision,incomplete,deleted FROM ledger_state WHERE singleton=1").first,
              row.count == 3, case let .integer(revision) = row[0], revision >= 0,
              [.integer(0), .integer(1)].contains(row[1]), [.integer(0), .integer(1)].contains(row[2]) else { throw ReflectionLedgerError.corrupt }
        return (revision, row[1] == .integer(1), row[2] == .integer(1))
    }
    private func advance(incomplete: Bool) throws {
        let current = try state().revision
        guard current < Int64.max else { throw ReflectionLedgerError.corrupt }
        try db.execute("UPDATE ledger_state SET revision=?,incomplete=max(incomplete,?) WHERE singleton=1", [.integer(current + 1), .integer(incomplete ? 1 : 0)])
    }
    private func totals() throws -> (bytes: Int64, count: Int64) {
        guard try db.rows("SELECT 1 FROM ledger_points WHERE typeof(payload)!='blob' OR payload_bytes!=length(payload) LIMIT 1").isEmpty,
              let row = try db.rows("SELECT coalesce(sum(payload_bytes),0),count(*) FROM ledger_points").first else { throw ReflectionLedgerError.corrupt }
        return (try Self.integer(row[0]), try Self.integer(row[1]))
    }
    private func validateRelations() throws {
        guard try db.rows("SELECT 1 FROM ledger_ids i LEFT JOIN ledger_sources s ON i.source_id=s.source_id LEFT JOIN ledger_points p ON p.event_id=i.event_id WHERE s.source_id IS NULL OR i.sequence>s.high_water OR (p.event_id IS NULL AND i.sequence>s.deleted_through) LIMIT 1").isEmpty,
              try db.rows("SELECT 1 FROM ledger_points p LEFT JOIN ledger_ids i ON p.event_id=i.event_id LEFT JOIN ledger_sources s ON i.source_id=s.source_id WHERE i.event_id IS NULL OR s.source_id IS NULL OR i.sequence<=s.deleted_through LIMIT 1").isEmpty else { throw ReflectionLedgerError.corrupt }
    }
    private func decode(_ row: [SQLValue]) throws -> ReflectionObservation {
        guard row.count == 5, try Self.integer(row[0]) > 0, case let .text(id) = row[1], case let .blob(payload) = row[2],
              case let .text(source) = row[3] else { throw ReflectionLedgerError.corrupt }
        let value: ReflectionObservation
        do { value = try JSONDecoder().decode(ReflectionObservation.self, from: payload) }
        catch { throw ReflectionLedgerError.corrupt }
        guard value.eventID.uuidString == id, value.sourceID.uuidString == source,
              value.sequence == (try Self.integer(row[4])), try Self.encode(value) == payload else { throw ReflectionLedgerError.corrupt }
        return value
    }
    private static func encode(_ value: ReflectionObservation) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }
    private static func integer(_ value: SQLValue) throws -> Int64 {
        guard case let .integer(number) = value, number >= 0 else { throw ReflectionLedgerError.corrupt }; return number
    }
    private static func translate<T>(_ body: () throws -> T) throws -> T {
        do { return try body() }
        catch let e as ReflectionLedgerError { throw e }
        catch SQLiteFailure.busy { throw ReflectionLedgerError.busy }
        catch SQLiteFailure.closed { throw ReflectionLedgerError.closed }
        catch SQLiteFailure.corrupt { throw ReflectionLedgerError.corrupt }
        catch { throw ReflectionLedgerError.unavailable }
    }
}
