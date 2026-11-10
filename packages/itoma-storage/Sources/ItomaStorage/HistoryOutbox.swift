import Foundation
import ItomaCore
import ItomaSQLite

public struct HistoryOutboxCapacity: Equatable, Sendable {
    public let maximumPendingEvents: Int
    public init(maximumPendingEvents: Int) throws {
        guard maximumPendingEvents > 0 else { throw StorageError.invalidHistoryCapacity }
        self.maximumPendingEvents = maximumPendingEvents
    }
}

public enum HistoryFactKind: String, Codable, Sendable { case command, grant }

/// Immutable operational metadata only, with no body, amount, token, app name, or raw error.
/// It records repository facts, never independently proves an OS restriction succeeded.
public struct ControlHistoryEvent: Equatable, Sendable, Codable {
    public let id: EventID
    public let occurredAt: Instant
    public let kind: HistoryFactKind
    public let command: Command
    public let grant: TemporaryGrant?

    init(id: EventID, occurredAt: Instant, kind: HistoryFactKind, command: Command, grant: TemporaryGrant?) {
        self.id = id; self.occurredAt = occurredAt; self.kind = kind; self.command = command; self.grant = grant
    }

    public init(from decoder: any Decoder) throws {
        let record = try EventDTO(from: decoder)
        guard record.version == 1 else { throw StorageError.corrupt }
        let command = try record.command.model()
        let grant = try record.grant?.model()
        if record.kind == .grant {
            guard let grant, grant.commandID == command.id else { throw StorageError.corrupt }
        }
        self.init(id: record.id, occurredAt: record.occurredAt, kind: record.kind, command: command, grant: grant)
    }

    public func encode(to encoder: any Encoder) throws { try EventDTO(self).encode(to: encoder) }
}

private struct EventDTO: Codable {
    var version = 1
    let id: EventID
    let occurredAt: Instant
    let kind: HistoryFactKind
    let command: CommandDTO
    let grant: GrantDTO?
    init(_ event: ControlHistoryEvent) {
        id = event.id; occurredAt = event.occurredAt; kind = event.kind
        command = CommandDTO(event.command); grant = event.grant.map(GrantDTO.init)
    }
}

public struct HistoryBoundary: Equatable, Sendable {
    public let sourceID: HistorySourceID
    public let highWatermark: HistorySequence
    public let historyIncomplete: Bool
}

public struct SequencedHistoryEvent: Equatable, Sendable {
    public let sequence: HistorySequence
    public let event: ControlHistoryEvent
}

public struct HistoryOutboxBatch: Equatable, Sendable {
    public let boundary: HistoryBoundary
    public let entries: [SequencedHistoryEvent]
}

public enum HistoryEnqueueResult: Equatable, Sendable {
    case enqueued(HistorySequence), alreadyPending(HistorySequence), alreadyAcknowledged(HistorySequence)
    case gap
}

public struct HistoryImportResult: Equatable, Sendable {
    public let imported: Int
    public let alreadyPresent: Int
    public let skippedByDeletion: Int
    public init(imported: Int, alreadyPresent: Int, skippedByDeletion: Int) {
        self.imported = imported; self.alreadyPresent = alreadyPresent; self.skippedByDeletion = skippedByDeletion
    }
}

/// Implementations must durably commit before returning. Transfer calls this outside control locks.
public protocol ControlHistorySink {
    func commitHistoryBatch(_ batch: HistoryOutboxBatch) throws -> HistoryImportResult
}

extension ControlTransaction {
    public func enqueueCommandHistory(
        eventID: EventID, commandID: CommandID, at: Instant, capacity: HistoryOutboxCapacity
    ) throws -> HistoryEnqueueResult {
        try checked {
            guard let command = try repository.loadCommand(commandID)?.command else { throw StorageError.invalidCommand }
            let grant = try repository.loadGrantForCommand(commandID)?.grant
            return try repository.enqueueHistory(ControlHistoryEvent(id: eventID, occurredAt: at, kind: .command,
                                                                     command: command, grant: grant), capacity: capacity)
        }
    }

    public func enqueueGrantHistory(
        eventID: EventID, grantID: GrantID, at: Instant, capacity: HistoryOutboxCapacity
    ) throws -> HistoryEnqueueResult {
        try checked {
            guard let grant = try repository.loadGrant(grantID)?.grant,
                  let command = try repository.loadCommand(grant.commandID)?.command else { throw StorageError.invalidCommand }
            return try repository.enqueueHistory(ControlHistoryEvent(id: eventID, occurredAt: at, kind: .grant,
                                                                     command: command, grant: grant), capacity: capacity)
        }
    }
}

extension ControlRepository {
    func createHistoryTables() throws {
        try database.execute("""
            CREATE TABLE history_state (
                singleton INTEGER PRIMARY KEY CHECK(singleton=1),source_id TEXT NOT NULL,
                last_sequence INTEGER NOT NULL CHECK(last_sequence>=0),
                history_incomplete INTEGER NOT NULL CHECK(history_incomplete IN (0,1)))
            """)
        try database.execute("INSERT INTO history_state VALUES (1,?,0,0)", [.text(UUID().uuidString)])
        // Ack deletes outbox payload. Small ID tombstones retain enqueue idempotency across ack.
        try database.execute("""
            CREATE TABLE history_event_ids (
                event_id TEXT COLLATE NOCASE PRIMARY KEY NOT NULL,
                sequence INTEGER UNIQUE NOT NULL CHECK(sequence>0))
            """)
        try database.execute("""
            CREATE TABLE history_outbox (
                event_id TEXT COLLATE NOCASE PRIMARY KEY NOT NULL REFERENCES history_event_ids(event_id),record BLOB NOT NULL)
            """)
    }

    public func historyBoundary() throws -> HistoryBoundary {
        try serialized { try database.transaction(writer: false) { _ = try loadSnapshot(); return try loadHistoryBoundary() } }
    }

    public func historyBatch(limit: Int = 100) throws -> HistoryOutboxBatch {
        guard (1...500).contains(limit) else { throw StorageError.invalidPage }
        return try serialized { try database.transaction(writer: false) {
            _ = try loadSnapshot()
            let boundary = try loadHistoryBoundary()
            let rows = try database.rows("""
                SELECT ids.event_id,ids.sequence,outbox.record FROM history_event_ids ids
                JOIN history_outbox outbox ON outbox.event_id=ids.event_id ORDER BY ids.sequence LIMIT ?
                """, [.integer(Int64(limit))])
            let entries = try rows.map { row -> SequencedHistoryEvent in
                guard row.count == 3, case let .text(rawID) = row[0], let uuid = UUID(uuidString: rawID), rawID == uuid.uuidString,
                      case let .integer(sequence) = row[1], sequence > 0, sequence <= boundary.highWatermark.rawValue,
                      case let .blob(data) = row[2] else { throw StorageError.corrupt }
                let event = try decodeHistoryEvent(data)
                guard event.id.rawValue == uuid else { throw StorageError.corrupt }
                return SequencedHistoryEvent(sequence: try HistorySequence(sequence), event: event)
            }
            return HistoryOutboxBatch(boundary: boundary, entries: entries)
        } }
    }

    /// Read commit -> private sink commit -> ack commit. No lock is held while invoking the sink.
    /// Failure leaves the batch pending and marks a persistent, conservative completeness gap.
    public func transferHistory(to sink: any ControlHistorySink, limit: Int = 100) throws -> HistoryImportResult {
        let batch = try historyBatch(limit: limit)
        let result: HistoryImportResult
        do { result = try sink.commitHistoryBatch(batch) }
        catch {
            let original = error
            try markHistoryIncomplete()
            throw original
        }
        try acknowledgeHistory(batch)
        return result
    }

    public func markHistoryIncomplete() throws {
        try serialized { try database.transaction(writer: true) {
            _ = try loadSnapshot(); _ = try loadHistoryBoundary()
            try database.execute("UPDATE history_state SET history_incomplete=1 WHERE singleton=1")
        } }
    }

    func acknowledgeHistory(_ batch: HistoryOutboxBatch) throws {
        try serialized { try database.transaction(writer: true) {
            _ = try loadSnapshot()
            guard try loadHistoryBoundary().sourceID == batch.boundary.sourceID else { throw StorageError.conflict }
            for entry in batch.entries {
                let rows = try database.rows("""
                    SELECT ids.sequence,outbox.record FROM history_event_ids ids
                    LEFT JOIN history_outbox outbox ON outbox.event_id=ids.event_id WHERE ids.event_id=?
                    """, [.text(entry.event.id.rawValue.uuidString)])
                guard let row = rows.first, row[0] == .integer(entry.sequence.rawValue) else { throw StorageError.conflict }
                if case let .blob(data) = row[1] {
                    guard try decodeHistoryEvent(data) == entry.event else { throw StorageError.conflict }
                    try database.execute("DELETE FROM history_outbox WHERE event_id=?", [.text(entry.event.id.rawValue.uuidString)])
                } else if row[1] != .null { throw StorageError.corrupt }
            }
        } }
    }

    func loadHistoryBoundary() throws -> HistoryBoundary {
        let rows = try database.rows("SELECT source_id,last_sequence,history_incomplete FROM history_state WHERE singleton=1")
        guard rows.count == 1, rows[0].count == 3, case let .text(rawID) = rows[0][0],
              let uuid = UUID(uuidString: rawID), rawID == uuid.uuidString, case let .integer(sequence) = rows[0][1], sequence >= 0,
              case let .integer(incomplete) = rows[0][2], [Int64(0),1].contains(incomplete) else { throw StorageError.corrupt }
        guard try database.rows("SELECT coalesce(max(sequence),0) FROM history_event_ids") == [[.integer(sequence)]],
              try database.rows("SELECT 1 FROM history_outbox LEFT JOIN history_event_ids USING(event_id) WHERE sequence IS NULL LIMIT 1").isEmpty
        else { throw StorageError.corrupt }
        return HistoryBoundary(sourceID: HistorySourceID(uuid), highWatermark: try HistorySequence(sequence), historyIncomplete: incomplete == 1)
    }

    func enqueueHistory(_ event: ControlHistoryEvent, capacity: HistoryOutboxCapacity) throws -> HistoryEnqueueResult {
        let boundary = try loadHistoryBoundary()
        let existing = try database.rows("""
            SELECT ids.sequence,outbox.record,ids.event_id FROM history_event_ids ids
            LEFT JOIN history_outbox outbox ON outbox.event_id=ids.event_id WHERE ids.event_id=?
            """, [.text(event.id.rawValue.uuidString)])
        if let row = existing.first {
            guard row[2] == .text(event.id.rawValue.uuidString), case let .integer(sequence) = row[0],
                  sequence > 0, sequence <= boundary.highWatermark.rawValue else { throw StorageError.corrupt }
            if row[1] == .null { return .alreadyAcknowledged(try HistorySequence(sequence)) }
            guard case let .blob(data) = row[1], try decodeHistoryEvent(data) == event else { throw StorageError.conflict }
            return .alreadyPending(try HistorySequence(sequence))
        }
        let count = try pendingHistoryAndReflectionCount()
        var maximum = Int64(capacity.maximumPendingEvents)
        if try hasReflectionCapture(),
           let configured = try? database.rows("SELECT maximum_pending FROM reflection_capture_state WHERE singleton=1"),
           case let .integer(limit) = configured.first?.first, limit > 0 { maximum = min(maximum, limit) }
        if count >= maximum || boundary.highWatermark.rawValue == Int64.max {
            try database.execute("UPDATE history_state SET history_incomplete=1 WHERE singleton=1")
            return .gap
        }
        let sequence = try boundary.highWatermark.next()
        let payload = try JSONEncoder().encode(event)
        do {
            return try database.savepoint {
                try database.execute("INSERT INTO history_event_ids VALUES (?,?)", [.text(event.id.rawValue.uuidString), .integer(sequence.rawValue)])
                try database.execute("INSERT INTO history_outbox VALUES (?,?)", [.text(event.id.rawValue.uuidString), .blob(payload)])
                try database.execute("UPDATE history_state SET last_sequence=? WHERE singleton=1", [.integer(sequence.rawValue)])
                return .enqueued(sequence)
            }
        } catch SQLiteFailure.rollbackFailure { throw StorageError.rollbackRequired }
        catch is SQLiteFailure {
            // Optional history failed, but the savepoint was rolled back and the outer writer is
            // still active. Preserve earlier safety metadata and persist the missing-history fact.
            try database.execute("UPDATE history_state SET history_incomplete=1 WHERE singleton=1")
            return .gap
        }
    }

    func decodeHistoryEvent(_ data: Data) throws -> ControlHistoryEvent {
        do { return try JSONDecoder().decode(ControlHistoryEvent.self, from: data) }
        catch { throw StorageError.corrupt }
    }
}
