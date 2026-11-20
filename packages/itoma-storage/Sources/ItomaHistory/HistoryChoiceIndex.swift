import Foundation
import ItomaCore
import ItomaSQLite

extension HistoryRepository {
    /// Derived metadata only. Immutable events remain available through history().
    func createChoiceIndex() throws {
        try database.execute("""
            CREATE TABLE history_choice_index (
                group_key TEXT PRIMARY KEY NOT NULL,
                record_key TEXT COLLATE NOCASE UNIQUE NOT NULL,
                occurred_at REAL NOT NULL,
                source_id TEXT,
                first_sequence INTEGER NOT NULL,
                latest_key TEXT COLLATE NOCASE UNIQUE NOT NULL,
                latest_sequence INTEGER NOT NULL,
                CHECK(first_sequence>=0 AND latest_sequence>=first_sequence))
            """)
        try database.execute("CREATE INDEX history_choice_order ON history_choice_index(occurred_at DESC,record_key DESC)")
    }

    func indexChoice(_ record: PrivateHistoryRecord, source: SQLValue, sequence: Int64) throws {
        let key = record.id.rawValue.uuidString
        let group = record.choiceGroup(source: source)
        if let existing = try database.rows("SELECT source_id FROM history_choice_index WHERE group_key=?", [.text(group)]).first {
            // One command belongs to one control installation. Never merge unrelated sources.
            guard existing[0] == source else { throw HistoryError.conflict }
        }
        try database.execute("""
            INSERT INTO history_choice_index VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(group_key) DO UPDATE SET
                record_key=CASE WHEN excluded.first_sequence<first_sequence THEN excluded.record_key ELSE record_key END,
                occurred_at=CASE WHEN excluded.first_sequence<first_sequence THEN excluded.occurred_at ELSE occurred_at END,
                first_sequence=min(first_sequence,excluded.first_sequence),
                latest_key=CASE WHEN excluded.latest_sequence>latest_sequence THEN excluded.latest_key ELSE latest_key END,
                latest_sequence=max(latest_sequence,excluded.latest_sequence)
            """, [.text(group), .text(key), .real(record.readTime.secondsSince1970), source,
                  .integer(sequence), .text(key), .integer(sequence)])
    }

    func backfillChoiceIndex() throws {
        var cursor: Int64 = 0
        while true {
            let rows = try database.rows("SELECT cursor,event_id,source_id,sequence,record,payload_bytes FROM history_events WHERE cursor>? AND record IS NOT NULL ORDER BY cursor LIMIT 100", [.integer(cursor)])
            if rows.isEmpty { break }
            for row in rows {
                guard case let .integer(next) = row[0], let record = try validateEventRow(row) else { throw HistoryError.corrupt }
                let sequence: Int64
                switch row[3] {
                case let .integer(value): sequence = value
                case .null: sequence = 0
                default: throw HistoryError.corrupt
                }
                try indexChoice(record, source: row[2], sequence: sequence)
                cursor = next
            }
        }
    }

    func choiceRecord(key: String, at: Instant) throws -> PrivateHistoryRecord {
        guard let keyID = UUID(uuidString: key), key == keyID.uuidString,
              let index = try database.rows("SELECT group_key,source_id,first_sequence,latest_key,latest_sequence FROM history_choice_index WHERE record_key=?", [.text(key)]).first,
              case let .text(group) = index[0], case let .integer(firstSequence) = index[2],
              case let .text(latest) = index[3], let latestID = UUID(uuidString: latest), latest == latestID.uuidString,
              case let .integer(latestSequence) = index[4],
              let first = try eventRows(EventID(keyID)).first,
              let firstRecord = try validateEventRow(first), firstRecord.readTime == at, firstRecord.choiceGroup(source: first[2]) == group,
              let last = try eventRows(EventID(latestID)).first,
              let record = try validateEventRow(last), record.choiceGroup(source: last[2]) == group,
              first[2] == index[1], last[2] == index[1],
              first[3] == (firstSequence == 0 ? .null : .integer(firstSequence)),
              last[3] == (latestSequence == 0 ? .null : .integer(latestSequence)) else { throw HistoryError.corrupt }
        return record
    }

    func validateChoiceMembership(_ record: PrivateHistoryRecord, source: SQLValue, sequence: SQLValue) throws {
        let number: Int64
        switch sequence {
        case let .integer(value): number = value
        case .null: number = 0
        default: throw HistoryError.corrupt
        }
        guard let row = try database.rows("SELECT source_id,first_sequence,latest_sequence FROM history_choice_index WHERE group_key=?", [.text(record.choiceGroup(source: source))]).first,
              row[0] == source, case let .integer(first) = row[1], case let .integer(last) = row[2],
              first <= number, number <= last else { throw HistoryError.corrupt }
    }

    func validateChoiceIndex() throws {
        var cursor = ""
        while true {
            let rows = try database.rows("SELECT record_key,occurred_at FROM history_choice_index WHERE record_key>? ORDER BY record_key LIMIT 100", [.text(cursor)])
            if rows.isEmpty { break }
            for row in rows {
                guard case let .text(key) = row[0], let id = UUID(uuidString: key), key == id.uuidString,
                      case let .real(seconds) = row[1] else { throw HistoryError.corrupt }
                _ = try choiceRecord(key: key, at: Instant(secondsSince1970: seconds))
                cursor = key
            }
        }
    }
}

extension PrivateHistoryRecord {
    func choiceGroup(source: SQLValue) -> String {
        switch self {
        case let .control(event):
            if case let .text(id) = source { return "command:\(id):\(event.command.id.rawValue.uuidString)" }
            return "invalid"
        case let .cancelled(id, _): return "cancelled:\(id.rawValue.uuidString)"
        }
    }
}
