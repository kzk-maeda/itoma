import Foundation
import ItomaCore
import ItomaSQLite
import ItomaStorage

extension HistoryRepository: ControlHistorySink {
    func createPrivateHistoryTables() throws {
        try database.execute("""
            CREATE TABLE dummy_selections (
                command_id TEXT COLLATE NOCASE PRIMARY KEY NOT NULL,prepared_at BLOB NOT NULL,payload BLOB,
                payload_bytes INTEGER NOT NULL CHECK(payload_bytes>=0),
                CHECK((payload IS NULL AND payload_bytes=0) OR (payload IS NOT NULL AND length(payload)=payload_bytes)))
            """)
        try database.execute("""
            CREATE TABLE history_sources (
                source_id TEXT COLLATE NOCASE PRIMARY KEY NOT NULL,
                observed_through INTEGER NOT NULL CHECK(observed_through>=0),
                deleted_through INTEGER NOT NULL CHECK(deleted_through>=0 AND deleted_through<=observed_through),
                history_incomplete INTEGER NOT NULL CHECK(history_incomplete IN (0,1)))
            """)
        try database.execute("""
            CREATE TABLE history_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT COLLATE NOCASE UNIQUE NOT NULL,
                source_id TEXT COLLATE NOCASE REFERENCES history_sources(source_id),sequence INTEGER,
                record BLOB,payload_bytes INTEGER NOT NULL CHECK(payload_bytes>=0),
                UNIQUE(source_id,sequence),
                CHECK((source_id IS NULL AND sequence IS NULL) OR (source_id IS NOT NULL AND sequence>0)),
                CHECK((record IS NULL AND payload_bytes=0) OR (record IS NOT NULL AND length(record)=payload_bytes)))
            """)
    }

    public static func migrate(
        at url: URL, capacity: HistoryCapacityPolicy, busyTimeoutMilliseconds: Int32 = 100
    ) throws -> HistoryRepository {
        guard validFileURL(url) else { throw HistoryError.unavailable }
        guard FileManager.default.fileExists(atPath: url.path) else { throw HistoryError.missingDatabase }
        return try HistoryError.translating {
            let repository = try HistoryRepository(url: url, capacity: capacity, busyTimeoutMilliseconds: busyTimeoutMilliseconds)
            try repository.database.transaction(writer: true) {
                guard case let .integer(version) = try repository.database.rows("PRAGMA user_version").first?.first else { throw HistoryError.corrupt }
                guard [Int64(1), 2, Self.schemaVersion].contains(version) else { throw HistoryError.unsupportedSchema(version) }
                try repository.validateSchema(expected: version)
                guard try repository.database.rows("PRAGMA quick_check(1)") == [[.text("ok")]],
                      try repository.database.rows("PRAGMA journal_mode") == [[.text("wal")]] else { throw HistoryError.corrupt }
                try repository.validateReasons()
                if version == 1 { try repository.createPrivateHistoryTables() }
                if version < 3 { try repository.createReadIndex(); try repository.backfillReadIndex() }
                try repository.database.execute("PRAGMA user_version=\(Self.schemaVersion)")
                try repository.validatePrivateHistory()
            }
            return repository
        }
    }

    public func prepareDummySelection(
        commandID: CommandID, choice: DummyChoice, selectionConfirmed: Bool, at: Instant
    ) throws -> DummySelectionRecord {
        guard selectionConfirmed else { throw HistoryError.invalidDummySelection }
        return try transaction(writer: true) {
            guard try loadReasons(filter: "WHERE command_id=?", bindings: [.text(commandID.rawValue.uuidString)]).isEmpty else { throw HistoryError.conflict }
            if let existing = try loadDummy(commandID) {
                guard let stored = existing.choice else { throw HistoryError.deleted }
                guard stored == choice else { throw HistoryError.conflict }
                return existing
            }
            let payload = try JSONEncoder().encode(choice)
            try checkCapacity(adding: payload.count)
            try database.execute("INSERT INTO dummy_selections VALUES (?,?,?,?)", [
                .text(commandID.rawValue.uuidString), .blob(try JSONEncoder().encode(at)), .blob(payload), .integer(Int64(payload.count))
            ])
            try advanceReadRevision()
            return DummySelectionRecord(commandID: commandID, preparedAt: at, choice: choice)
        }
    }

    public func dummySelection(for commandID: CommandID) throws -> DummySelectionRecord? {
        try transaction(writer: false) { try loadDummy(commandID) }
    }

    /// Private commit completes before the shared writer starts. Failure there leaves Prepared only.
    public func acceptReasonGrant(
        in control: ControlRepository, command: Command, request: GrantRequest, body: String,
        context: EvaluationContext, expectedSequence: SnapshotSequence
    ) throws -> GrantAcceptance {
        guard command.kind == .requestTemporaryGrant, command.id == request.commandID,
              request.condition.mode == .reason, let ref = command.reasonRef else { throw HistoryError.conflict }
        try control.requireOutsideTransaction()
        _ = try prepareReason(reasonRef: ref, commandID: command.id, body: body, at: context.now)
        return try control.write { try $0.acceptGrant(command: command, request: request, context: context, expectedSequence: expectedSequence) }
    }

    public func reconcileReason(for commandID: CommandID, in control: ControlRepository) throws -> ReasonReconciliation {
        guard let reason = try reason(for: commandID) else { return .missing }
        if reason.isDeleted { return .deleted }
        guard let command = try control.command(commandID) else { return .preparedOnly }
        guard command.kind == .requestTemporaryGrant, command.reasonRef == reason.reasonRef else { throw HistoryError.conflict }
        return .sharedAccepted(command.status)
    }

    public func commitHistoryBatch(_ batch: HistoryOutboxBatch) throws -> HistoryImportResult {
        try transaction(writer: true) {
            let before = try database.rows("SELECT observed_through,history_incomplete FROM history_sources WHERE source_id=?", [.text(batch.boundary.sourceID.rawValue.uuidString)])
            try observe(batch.boundary)
            let cutoff = try sourceState(batch.boundary.sourceID).deleted
            var imported = 0, existing = 0, deleted = 0
            var previous: Int64 = 0
            for entry in batch.entries {
                guard entry.sequence.rawValue > previous, entry.sequence <= batch.boundary.highWatermark else { throw HistoryError.corrupt }
                previous = entry.sequence.rawValue
                let rows = try eventRows(entry.event.id)
                if let row = rows.first {
                    _ = try validateEventRow(row)
                    guard row[2] == .text(batch.boundary.sourceID.rawValue.uuidString), row[3] == .integer(entry.sequence.rawValue) else { throw HistoryError.conflict }
                    if case let .blob(data) = row[4] {
                        guard try decodeRecord(data) == .control(entry.event) else { throw HistoryError.conflict }
                    } else if row[4] != .null { throw HistoryError.corrupt }
                    existing += 1
                    continue
                }
                let removed = entry.sequence.rawValue <= cutoff
                let payload = removed ? nil : try JSONEncoder().encode(PrivateHistoryRecord.control(entry.event))
                if let payload { try checkCapacity(adding: payload.count) }
                try database.execute("INSERT INTO history_events(event_id,source_id,sequence,record,payload_bytes) VALUES (?,?,?,?,?)", [
                    .text(entry.event.id.rawValue.uuidString), .text(batch.boundary.sourceID.rawValue.uuidString),
                    .integer(entry.sequence.rawValue), payload.map(SQLValue.blob) ?? .null, .integer(Int64(payload?.count ?? 0))
                ])
                if !removed { try indexRecord(kind: "event", key: entry.event.id.rawValue.uuidString, at: entry.event.occurredAt) }
                if removed { deleted += 1 } else { imported += 1 }
            }
            let after = try database.rows("SELECT observed_through,history_incomplete FROM history_sources WHERE source_id=?", [.text(batch.boundary.sourceID.rawValue.uuidString)])
            if imported > 0 || before != after { try advanceReadRevision() }
            return HistoryImportResult(imported: imported, alreadyPresent: existing, skippedByDeletion: deleted)
        }
    }

    public func recordCancellation(eventID: EventID, at: Instant) throws {
        try transaction(writer: true) {
            let record = PrivateHistoryRecord.cancelled(id: eventID, at: at)
            if let row = try eventRows(eventID).first {
                _ = try validateEventRow(row)
                guard row[2] == .null, row[3] == .null else { throw HistoryError.conflict }
                if case let .blob(data) = row[4] {
                    guard try decodeRecord(data) == record else { throw HistoryError.conflict }
                } else if row[4] != .null { throw HistoryError.corrupt }
                return
            }
            let payload = try JSONEncoder().encode(record)
            try checkCapacity(adding: payload.count)
            try database.execute("INSERT INTO history_events(event_id,source_id,sequence,record,payload_bytes) VALUES (?,NULL,NULL,?,?)", [
                .text(eventID.rawValue.uuidString), .blob(payload), .integer(Int64(payload.count))
            ])
            try indexRecord(kind: "event", key: eventID.rawValue.uuidString, at: at)
            try advanceReadRevision()
        }
    }

    public func history(limit: Int = 100, after cursor: Int64 = 0) throws -> [StoredHistoryRecord] {
        guard (1...500).contains(limit), cursor >= 0 else { throw HistoryError.invalidPage }
        return try transaction(writer: false) {
            try database.rows("SELECT cursor,event_id,source_id,sequence,record,payload_bytes FROM history_events WHERE cursor>? AND record IS NOT NULL ORDER BY cursor LIMIT ?", [.integer(cursor), .integer(Int64(limit))]).map { row in
                let record = try validateEventRow(row)
                guard case let .integer(cursor) = row[0], let record else { throw HistoryError.corrupt }
                return StoredHistoryRecord(cursor: cursor, record: record)
            }
        }
    }

    /// Capture the shared boundary without a private writer; delete only events at/before it.
    /// Events imported concurrently after the captured boundary remain visible.
    public func deleteHistory(from control: ControlRepository) throws {
        let boundary = try control.historyBoundary()
        try deleteHistory(through: boundary)
    }

    func deleteHistory(through boundary: HistoryBoundary) throws {
        try transaction(writer: true) {
            try observe(boundary)
            for (source, observed) in try sourceStates() {
                let through = source == boundary.sourceID ? boundary.highWatermark.rawValue : observed
                try database.execute("UPDATE history_sources SET deleted_through=max(deleted_through,?) WHERE source_id=?", [
                    .integer(through), .text(source.rawValue.uuidString)
                ])
            }
            try database.execute("UPDATE history_events SET record=NULL,payload_bytes=0 WHERE source_id IS NULL OR sequence<=(SELECT deleted_through FROM history_sources WHERE history_sources.source_id=history_events.source_id)")
            try database.execute("UPDATE reasons SET body=NULL,payload_bytes=0")
            try database.execute("UPDATE dummy_selections SET payload=NULL,payload_bytes=0")
            try database.execute("DELETE FROM history_read_index WHERE kind='event' AND record_key IN (SELECT event_id FROM history_events WHERE record IS NULL)")
            try advanceReadRevision()
        }
    }

    public func historyIncomplete() throws -> Bool {
        try transaction(writer: false) {
            _ = try sourceStates()
            return try !database.rows("SELECT 1 FROM history_sources WHERE history_incomplete=1 LIMIT 1").isEmpty
        }
    }

    func checkCapacity(adding bytes: Int) throws {
        guard Int64(bytes) <= capacityPolicy.maximumBytes - (try logicalBytes()) else { throw HistoryError.capacityExceeded }
    }

    func loadDummy(_ commandID: CommandID) throws -> DummySelectionRecord? {
        let rows = try database.rows("SELECT command_id,prepared_at,payload,payload_bytes FROM dummy_selections WHERE command_id=?", [.text(commandID.rawValue.uuidString)])
        return try rows.first.map(decodeDummy)
    }

    func decodeDummy(_ row: [SQLValue]) throws -> DummySelectionRecord {
        guard row.count == 4, case let .text(rawID) = row[0], let id = UUID(uuidString: rawID), rawID == id.uuidString,
              case let .blob(time) = row[1], case let .integer(size) = row[3] else { throw HistoryError.corrupt }
        do {
            let choice: DummyChoice?
            if case let .blob(data) = row[2], Int64(data.count) == size { choice = try JSONDecoder().decode(DummyChoice.self, from: data) }
            else if row[2] == .null && size == 0 { choice = nil }
            else { throw HistoryError.corrupt }
            return DummySelectionRecord(commandID: CommandID(id), preparedAt: try JSONDecoder().decode(Instant.self, from: time), choice: choice)
        } catch { throw HistoryError.corrupt }
    }

    func observe(_ boundary: HistoryBoundary) throws {
        try database.execute("""
            INSERT INTO history_sources VALUES (?,?,0,?) ON CONFLICT(source_id) DO UPDATE SET
            observed_through=max(observed_through,excluded.observed_through),
            history_incomplete=max(history_incomplete,excluded.history_incomplete)
            """, [.text(boundary.sourceID.rawValue.uuidString), .integer(boundary.highWatermark.rawValue), .integer(boundary.historyIncomplete ? 1 : 0)])
    }

    func sourceState(_ id: HistorySourceID) throws -> (observed: Int64, deleted: Int64) {
        let rows = try database.rows("SELECT observed_through,deleted_through,source_id FROM history_sources WHERE source_id=?", [.text(id.rawValue.uuidString)])
        guard let row = rows.first, case let .integer(observed) = row[0], case let .integer(deleted) = row[1],
              row[2] == .text(id.rawValue.uuidString), observed >= deleted, deleted >= 0 else { throw HistoryError.corrupt }
        return (observed, deleted)
    }

    func sourceStates() throws -> [(HistorySourceID, Int64)] {
        try database.rows("SELECT source_id,observed_through,deleted_through,history_incomplete FROM history_sources").map { row in
            guard case let .text(rawID) = row[0], let id = UUID(uuidString: rawID), rawID == id.uuidString,
                  case let .integer(observed) = row[1], case let .integer(deleted) = row[2], observed >= deleted, deleted >= 0,
                  case let .integer(gap) = row[3], [Int64(0),1].contains(gap) else { throw HistoryError.corrupt }
            return (HistorySourceID(id), observed)
        }
    }

    func eventRows(_ id: EventID) throws -> [[SQLValue]] {
        try database.rows("SELECT cursor,event_id,source_id,sequence,record,payload_bytes FROM history_events WHERE event_id=?", [.text(id.rawValue.uuidString)])
    }

    func decodeRecord(_ data: Data) throws -> PrivateHistoryRecord {
        do { return try JSONDecoder().decode(PrivateHistoryRecord.self, from: data) }
        catch { throw HistoryError.corrupt }
    }

    func validateEventRow(_ row: [SQLValue]) throws -> PrivateHistoryRecord? {
        guard row.count == 6, case let .integer(cursor) = row[0], cursor > 0,
              case let .text(rawID) = row[1], let id = UUID(uuidString: rawID), rawID == id.uuidString,
              case let .integer(bytes) = row[5], bytes >= 0 else { throw HistoryError.corrupt }
        if case let .text(rawSource) = row[2] {
            guard let source = UUID(uuidString: rawSource), rawSource == source.uuidString,
                  case let .integer(sequence) = row[3], sequence > 0,
                  sequence <= (try sourceState(HistorySourceID(source))).observed else { throw HistoryError.corrupt }
        } else if row[2] != .null || row[3] != .null { throw HistoryError.corrupt }
        if row[4] == .null {
            guard bytes == 0 else { throw HistoryError.corrupt }
            return nil
        }
        guard case let .blob(data) = row[4], Int64(data.count) == bytes else { throw HistoryError.corrupt }
        let record = try decodeRecord(data)
        guard record.id.rawValue == id else { throw HistoryError.corrupt }
        switch record {
        case .control: guard row[2] != .null else { throw HistoryError.corrupt }
        case .cancelled: guard row[2] == .null else { throw HistoryError.corrupt }
        }
        return record
    }

    func validatePrivateHistory() throws {
        _ = try sourceStates()
        var key = ""
        while true {
            let rows = try database.rows("SELECT command_id,prepared_at,payload,payload_bytes FROM dummy_selections WHERE command_id>? ORDER BY command_id LIMIT 100", [.text(key)])
            guard !rows.isEmpty else { break }
            for row in rows { key = try decodeDummy(row).commandID.rawValue.uuidString }
        }
        var cursor: Int64 = 0
        while true {
            let rows = try database.rows("SELECT cursor,event_id,source_id,sequence,record,payload_bytes FROM history_events WHERE cursor>? ORDER BY cursor LIMIT 100", [.integer(cursor)])
            guard !rows.isEmpty else { break }
            for row in rows {
                _ = try validateEventRow(row)
                guard case let .integer(next) = row[0] else { throw HistoryError.corrupt }
                cursor = next
            }
        }
        _ = try logicalBytes()
        _ = try readRevision()
        for (kind, table, filter) in [("event", "history_events", "record IS NOT NULL"), ("reason", "reasons", "1=1")] {
            let indexed = try database.rows("SELECT count(*) FROM history_read_index WHERE kind=?", [.text(kind)])
            let actual = try database.rows("SELECT count(*) FROM \(table) WHERE \(filter)")
            guard indexed == actual else { throw HistoryError.corrupt }
        }
    }
}
