import Foundation
import ItomaCore
import ItomaSQLite

public enum HistoryRecordKind: String, Sendable { case event, reason }

/// Stable descending keyset; the revision is required when moving to another page.
public struct HistoryPageKey: Equatable, Sendable {
    public let at: Instant
    public let key: String
    public init(at: Instant, key: String) { self.at = at; self.key = key }
}
public struct HistoryReadRow: Sendable {
    public let key: String
    public let occurredAt: Instant
    public let record: PrivateHistoryRecord?
    public let commandID: CommandID?
    public let reasonDeleted: Bool?
}
public struct HistoryReadPage: Sendable {
    public let revision: Int64
    public let rows: [HistoryReadRow]
    public let next: HistoryPageKey?
    public let capacity: HistoryCapacity
    public let incomplete: Bool
}

extension HistoryRepository {
    func createReadIndex() throws {
        try database.execute("CREATE TABLE history_read_index (kind TEXT NOT NULL CHECK(kind IN ('event','reason')),record_key TEXT COLLATE NOCASE NOT NULL,occurred_at REAL NOT NULL,PRIMARY KEY(kind,record_key))")
        try database.execute("CREATE INDEX history_read_order ON history_read_index(kind,occurred_at DESC,record_key DESC)")
        try database.execute("CREATE TABLE history_read_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0))")
        try database.execute("INSERT INTO history_read_state VALUES(1,0)")
    }
    func indexRecord(kind: String, key: String, at: Instant) throws {
        try database.execute("INSERT INTO history_read_index VALUES(?,?,?)", [.text(kind), .text(key), .real(at.secondsSince1970)])
    }
    func advanceReadRevision() throws {
        guard try readRevision() < Int64.max else { throw HistoryError.databaseFailure }
        try database.execute("UPDATE history_read_state SET revision=revision+1 WHERE singleton=1")
    }
    func readRevision() throws -> Int64 {
        guard let row = try database.rows("SELECT revision FROM history_read_state WHERE singleton=1").first,
              case let .integer(revision) = row[0], revision >= 0 else { throw HistoryError.corrupt }
        return revision
    }
    func backfillReadIndex() throws {
        // Migration runs in one atomic transaction. Process bounded batches; never reset old data.
        var cursor: Int64 = 0
        while true {
            let rows = try database.rows("SELECT cursor,event_id,source_id,sequence,record,payload_bytes FROM history_events WHERE cursor>? AND record IS NOT NULL ORDER BY cursor LIMIT 100", [.integer(cursor)])
            if rows.isEmpty { break }
            for row in rows {
                guard case let .integer(next) = row[0], let record = try validateEventRow(row) else { throw HistoryError.corrupt }
                try indexRecord(kind: "event", key: record.id.rawValue.uuidString, at: record.readTime)
                cursor = next
            }
        }
        var key = ""
        while true {
            let rows = try database.rows("SELECT reason_ref,prepared_at FROM reasons WHERE reason_ref>? ORDER BY reason_ref LIMIT 100", [.text(key)])
            if rows.isEmpty { break }
            for row in rows {
                guard case let .text(ref) = row[0], case let .blob(at) = row[1] else { throw HistoryError.corrupt }
                let instant: Instant
                do { instant = try JSONDecoder().decode(Instant.self, from: at) } catch { throw HistoryError.corrupt }
                try indexRecord(kind: "reason", key: ref, at: instant); key = ref
            }
        }
    }

    public func readPage(kind: HistoryRecordKind, limit: Int = 40, after: HistoryPageKey? = nil,
                         expectedRevision: Int64? = nil, from: Instant? = nil, until: Instant? = nil) throws -> HistoryReadPage {
        guard (1...40).contains(limit), (from == nil) == (until == nil),
              from == nil || from! < until!, after == nil || UUID(uuidString: after!.key) != nil else { throw HistoryError.invalidPage }
        return try transaction(writer: false) {
            let revision = try readRevision()
            if let expectedRevision, expectedRevision != revision { throw HistoryError.conflict }
            var predicate = "kind=?", values: [SQLValue] = [.text(kind.rawValue)]
            if let from, let until {
                predicate += " AND occurred_at>=CAST(? AS REAL) AND occurred_at<CAST(? AS REAL)"
                values += [.text(String(from.secondsSince1970)), .text(String(until.secondsSince1970))]
            }
            if let after {
                predicate += " AND (occurred_at<CAST(? AS REAL) OR (occurred_at=CAST(? AS REAL) AND record_key<?))"
                values += [.text(String(after.at.secondsSince1970)), .text(String(after.at.secondsSince1970)), .text(after.key.uppercased())]
            }
            values += [.integer(Int64(limit + 1))]
            let keys = try database.rows("SELECT record_key,occurred_at FROM history_read_index WHERE \(predicate) ORDER BY occurred_at DESC,record_key DESC LIMIT ?", values)
            var rows: [HistoryReadRow] = []
            for row in keys.prefix(limit) {
                guard case let .text(key) = row[0], let id = UUID(uuidString: key), key == id.uuidString else { throw HistoryError.corrupt }
                let at: Instant
                switch row[1] {
                case let .real(seconds): at = try Instant(secondsSince1970: seconds)
                case let .integer(seconds): at = try Instant(secondsSince1970: Double(seconds))
                default: throw HistoryError.corrupt
                }
                if kind == .event {
                    guard let stored = try eventRows(EventID(id)).first, let record = try validateEventRow(stored), record.readTime == at else { throw HistoryError.corrupt }
                    rows.append(HistoryReadRow(key: key, occurredAt: at, record: record, commandID: nil, reasonDeleted: nil))
                } else {
                    let stored = try database.rows("SELECT command_id,prepared_at,body IS NULL FROM reasons WHERE reason_ref=?", [.text(key)])
                    guard let reason = stored.first, case let .text(command) = reason[0], let uuid = UUID(uuidString: command),
                          command == uuid.uuidString, case let .blob(time) = reason[1], case let .integer(deleted) = reason[2],
                          [Int64(0),1].contains(deleted), (try? JSONDecoder().decode(Instant.self, from: time)) == at else { throw HistoryError.corrupt }
                    rows.append(HistoryReadRow(key: key, occurredAt: at, record: nil, commandID: CommandID(uuid), reasonDeleted: deleted == 1))
                }
            }
            let used = try logicalBytes()
            let incomplete = try !database.rows("SELECT 1 FROM history_sources WHERE history_incomplete=1 LIMIT 1").isEmpty
            return HistoryReadPage(revision: revision, rows: rows,
                next: keys.count > limit ? rows.last.map { HistoryPageKey(at: $0.occurredAt, key: $0.key) } : nil,
                capacity: HistoryCapacity(logicalPayloadBytes: used, warningReached: used >= capacityPolicy.warningBytes, limitReached: used >= capacityPolicy.maximumBytes), incomplete: incomplete)
        }
    }
}

extension PrivateHistoryRecord {
    public var readTime: Instant {
        switch self { case let .control(event): event.occurredAt; case let .cancelled(_, at): at }
    }
}
