import Foundation
import ItomaCore
import ItomaSQLite

/// Committed control facts, not continuous evidence of OS blocking. No opaque token or reason.
public struct ReflectionControlFact: Codable, Equatable, Sendable {
    public let version: Int
    public let eventID: UUID
    public let sourceID: UUID
    public let sequence: Int64
    public let committedAt: Instant
    public let timeZone: String
    public let snapshotSequence: SnapshotSequence
    public let policy: PolicySnapshot
    public let activation: Activation
    public let selections: [ReflectionSelectionFact]
    public let grants: [ReflectionGrantFact]
    public let application: ReflectionApplicationFact?

    public func validate() throws {
        guard version == 1, sequence > 0, TimeZone(identifier: timeZone) != nil,
              timeZone.utf8.count <= 128, selections.count <= 1_000, grants.count <= 100,
              Set(selections.map(\.ref)).count == selections.count else { throw StorageError.corrupt }
        for item in selections {
            guard item.targets.count <= 50, Set(item.targets).count == item.targets.count else { throw StorageError.corrupt }
        }
        for grant in grants {
            guard grant.ruleVersion >= 0, TimeZone(identifier: grant.timeZone) != nil,
                  grant.acceptedAt < grant.expiresAt else { throw StorageError.corrupt }
        }
        if let application {
            guard TimeZone(identifier: application.timeZone) != nil,
                  application.policyRevision <= policy.revision,
                  application.evaluationSequence <= snapshotSequence,
                  application.desiredTargets.count <= 50,
                  Set(application.desiredTargets).count == application.desiredTargets.count,
                  application.status != .applied || application.evidence != nil else { throw StorageError.corrupt }
        }
    }
}
public struct ReflectionSelectionFact: Codable, Equatable, Sendable {
    public let ref: SelectionRef
    public let targets: [TargetRef]
}
public struct ReflectionGrantFact: Codable, Equatable, Sendable {
    public let id: GrantID
    public let target: TargetRef
    public let ruleID: RuleID
    public let ruleVersion: Int64
    public let occurrenceStart: Instant
    public let timeZone: String
    public let acceptedAt: Instant
    public let expiresAt: Instant
    public let status: GrantStatus
    public let ended: Bool
}
public struct ReflectionApplicationFact: Codable, Equatable, Sendable {
    public let evaluationID: EvaluationID
    public let policyRevision: PolicyRevision
    public let evaluationSequence: SnapshotSequence
    public let evaluatedAt: Instant
    public let observedAt: Instant
    public let timeZone: String
    public let desiredTargets: [TargetRef]
    public let status: ApplicationStatus
    public let evidence: ApplicationEvidence?
    public let failure: OperationFailure?
    public let scheduledValidUntil: Instant?
}
public struct ReflectionBoundary: Equatable, Sendable {
    public let sourceID: UUID
    public let highWatermark: Int64
    public let acknowledgedThrough: Int64
    public let incomplete: Bool
}
public struct ReflectionFactBatch: Sendable {
    public let boundary: ReflectionBoundary
    public let facts: [ReflectionControlFact]
}
public struct RecordsDeletionBoundary: Sendable {
    public let history: HistoryBoundary
    public let reflection: ReflectionBoundary?
}
public protocol ReflectionFactSink {
    /// Return only after a durable, all-or-nothing private commit. Capacity failure must throw.
    func commitReflectionBatch(_ batch: ReflectionFactBatch) throws
}

extension ControlRepository {
    /// Both streams are sampled from one SQLite read snapshot, without any private writer.
    public func recordsDeletionBoundary() throws -> RecordsDeletionBoundary {
        try serialized { try database.transaction(writer: false) {
            let snapshot = try loadSnapshot()
            return try RecordsDeletionBoundary(history: loadHistoryBoundary(), reflection: sampledReflectionBoundary(snapshot))
        } }
    }
    /// Fresh point baseline after explicit deletion; never reapplies policy/grants or OS settings.
    public func recordReflectionBaseline() throws {
        try serialized { try database.transaction(writer: true) {
            let before = try loadSnapshot()
            try captureReflection(before: before.snapshotSequence, force: true)
        } }
    }
    /// Optional auxiliary schema. Main schema 6 remains readable by an Extension before host upgrade.
    /// Only the host installs it. Existing settings/commands/grants and OS schedules are untouched.
    public func installReflectionCapture(capacity: HistoryOutboxCapacity) throws {
        try serialized { try database.transaction(writer: true) {
            let snapshot = try loadSnapshot()
            if try !hasReflectionCapture() {
                try database.execute("""
                    CREATE TABLE reflection_capture_state(
                      singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version=1),
                      source_id TEXT NOT NULL,last_sequence INTEGER NOT NULL CHECK(last_sequence>=0),
                      acknowledged_through INTEGER NOT NULL CHECK(acknowledged_through>=0 AND acknowledged_through<=last_sequence),
                      incomplete INTEGER NOT NULL CHECK(incomplete IN (0,1)),
                      last_snapshot_sequence INTEGER NOT NULL CHECK(last_snapshot_sequence>=0),
                      maximum_pending INTEGER NOT NULL CHECK(maximum_pending>0))
                    """)
                try database.execute("INSERT INTO reflection_capture_state VALUES(1,1,?,0,0,0,?,?)",
                    [.text(UUID().uuidString), .integer(snapshot.snapshotSequence.rawValue), .integer(Int64(capacity.maximumPendingEvents))])
                try database.execute("""
                    CREATE TABLE reflection_outbox(
                      sequence INTEGER PRIMARY KEY CHECK(sequence>0),event_id TEXT UNIQUE NOT NULL,
                      record BLOB NOT NULL CHECK(length(record)>0))
                    """)
                // Conservative prefilter over our compact JSON. Typed decoding remains authority.
                // Nonstandard encodings are included, never assumed reconciled. SQLite maintains
                // this optional index for old schema6 writers without requiring JSON1.
                try database.execute("""
                    CREATE INDEX reflection_unreconciled_grants ON grants(grant_id)
                    WHERE instr(CAST(record AS TEXT),'"status":"reconciled"')=0
                    """)
                // Legacy schema6 writers also honor the combined cap through their existing
                // optional-history savepoint failure path.
                try database.execute("""
                    CREATE TRIGGER reflection_combined_history_capacity BEFORE INSERT ON history_outbox
                    WHEN (SELECT count(*) FROM history_outbox)+(SELECT count(*) FROM reflection_outbox)
                      >=(SELECT maximum_pending FROM reflection_capture_state WHERE singleton=1 AND version=1)
                    BEGIN SELECT RAISE(ABORT,'optional history capacity'); END
                    """)
                try captureReflection(before: snapshot.snapshotSequence, force: true)
            } else {
                _ = try loadReflectionBoundary()
                try database.execute("UPDATE reflection_capture_state SET maximum_pending=? WHERE singleton=1",
                    [.integer(Int64(capacity.maximumPendingEvents))])
            }
        } }
    }

    public func reflectionBatch(limit: Int = 100) throws -> ReflectionFactBatch? {
        guard (1...100).contains(limit) else { throw StorageError.invalidPage }
        return try serialized { try database.transaction(writer: false) {
            let snapshot = try loadSnapshot()
            guard let boundary = try sampledReflectionBoundary(snapshot) else { return nil }
            let facts = try database.rows("SELECT sequence,event_id,record FROM reflection_outbox ORDER BY sequence LIMIT ?",
                [.integer(Int64(limit))]).map { row in try decodeReflection(row, boundary: boundary) }
            return ReflectionFactBatch(boundary: boundary, facts: facts)
        } }
    }

    public func transferReflection(to sink: any ReflectionFactSink, limit: Int = 100) throws {
        guard let batch = try reflectionBatch(limit: limit) else { return }
        try sink.commitReflectionBatch(batch) // No shared writer or lock while the private sink runs.
        try serialized { try database.transaction(writer: true) {
            let current = try loadReflectionBoundary()
            guard current.sourceID == batch.boundary.sourceID else { throw StorageError.conflict }
            for fact in batch.facts {
                if fact.sequence <= current.acknowledgedThrough { continue }
                let row = try database.rows("SELECT sequence,event_id,record FROM reflection_outbox WHERE sequence=?",
                    [.integer(fact.sequence)])
                guard row.count == 1, try decodeReflection(row[0], boundary: current) == fact else { throw StorageError.conflict }
                try database.execute("DELETE FROM reflection_outbox WHERE sequence=?", [.integer(fact.sequence)])
            }
            if let last = batch.facts.last {
                try database.execute("UPDATE reflection_capture_state SET acknowledged_through=max(acknowledged_through,?) WHERE singleton=1",
                    [.integer(last.sequence)])
            }
        } }
    }

    func hasReflectionCapture() throws -> Bool {
        try !database.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='reflection_capture_state'").isEmpty
    }
    private func sampledReflectionBoundary(_ snapshot: ControlSnapshot) throws -> ReflectionBoundary? {
        guard try hasReflectionCapture() else { return nil }
        let stored = try loadReflectionBoundary()
        guard let row = try database.rows("SELECT last_snapshot_sequence FROM reflection_capture_state WHERE singleton=1").first,
              case let .integer(captured) = row[0] else { throw StorageError.corrupt }
        return ReflectionBoundary(sourceID: stored.sourceID, highWatermark: stored.highWatermark,
            acknowledgedThrough: stored.acknowledgedThrough,
            incomplete: stored.incomplete || snapshot.snapshotSequence.rawValue != captured)
    }

    func loadReflectionBoundary() throws -> ReflectionBoundary {
        let rows = try database.rows("SELECT version,source_id,last_sequence,acknowledged_through,incomplete FROM reflection_capture_state WHERE singleton=1")
        guard rows.count == 1, rows[0].count == 5, rows[0][0] == .integer(1),
              case let .text(raw) = rows[0][1], let source = UUID(uuidString: raw), source.uuidString == raw,
              case let .integer(high) = rows[0][2], high >= 0, case let .integer(ack) = rows[0][3], ack >= 0, ack <= high,
              [.integer(0), .integer(1)].contains(rows[0][4]),
              try database.rows("SELECT 1 FROM reflection_outbox WHERE sequence<=? OR sequence>? LIMIT 1",
                [.integer(ack), .integer(high)]).isEmpty else { throw StorageError.corrupt }
        if rows[0][4] == .integer(0) {
            guard try database.rows("SELECT count(*) FROM reflection_outbox") == [[.integer(high - ack)]] else { throw StorageError.corrupt }
        }
        return ReflectionBoundary(sourceID: source, highWatermark: high, acknowledgedThrough: ack, incomplete: rows[0][4] == .integer(1))
    }

    /// Runs inside the same short writer as the control state. Optional payload loss never changes
    /// control intent; its high water/loss marker is committed with the control operation.
    func captureReflection(before: SnapshotSequence, force: Bool = false) throws {
        do { try captureReflectionPayload(before: before, force: force) }
        catch SQLiteFailure.rollbackFailure { throw StorageError.rollbackRequired }
        catch StorageError.rollbackRequired { throw StorageError.rollbackRequired }
        catch {
            // Unknown/partial auxiliary schema must not disable stop or an existing Extension.
            // Reads still report capture failure; no successful duration is synthesized.
            try? database.execute("UPDATE reflection_capture_state SET incomplete=1 WHERE singleton=1")
        }
    }

    private func captureReflectionPayload(before: SnapshotSequence, force: Bool) throws {
        guard try hasReflectionCapture() else { return }
        let snapshot = try loadSnapshot(), boundary = try loadReflectionBoundary()
        guard force || snapshot.snapshotSequence != before else { return }
        let state = try database.rows("SELECT last_snapshot_sequence,maximum_pending FROM reflection_capture_state WHERE singleton=1")
        guard let row = state.first, case let .integer(previous) = row[0],
              case let .integer(maximum) = row[1], maximum > 0 else { throw StorageError.corrupt }
        guard boundary.highWatermark < Int64.max else {
            try database.execute("UPDATE reflection_capture_state SET incomplete=1 WHERE singleton=1"); return
        }
        let sequence = boundary.highWatermark + 1
        try database.execute("UPDATE reflection_capture_state SET last_sequence=?,last_snapshot_sequence=?,incomplete=max(incomplete,?) WHERE singleton=1",
            [.integer(sequence), .integer(snapshot.snapshotSequence.rawValue), .integer(previous == before.rawValue ? 0 : 1)])
        let pending = try pendingHistoryAndReflectionCount()
        guard pending < maximum else {
            try database.execute("UPDATE reflection_capture_state SET incomplete=1 WHERE singleton=1"); return
        }
        do {
            try database.savepoint {
                // Include ended/invalidated/expired records until reblock reconciliation is known.
                let grantRows = try database.rows("SELECT grant_id FROM grants WHERE reserved=1 ORDER BY grant_id LIMIT 101")
                    + database.rows("""
                        SELECT grant_id FROM grants WHERE instr(CAST(record AS TEXT),'"status":"reconciled"')=0
                        ORDER BY grant_id LIMIT 101
                        """)
                let ids = try Set(grantRows.map { row -> String in
                    guard case let .text(id) = row[0] else { throw StorageError.corrupt }; return id
                }).sorted()
                guard ids.count <= 100 else { throw StorageError.invalidPage }
                let grants = try ids.map { id -> ReflectionGrantFact in
                    guard let uuid = UUID(uuidString: id),
                          let stored = try loadGrant(GrantID(uuid)) else { throw StorageError.corrupt }
                    let g = stored.grant
                    return ReflectionGrantFact(id: g.id, target: g.targetRef, ruleID: g.ruleID, ruleVersion: g.ruleVersion.rawValue,
                        occurrenceStart: g.occurrence.resolvedStart, timeZone: g.occurrence.timeZone.identifier,
                        acceptedAt: g.acceptedAt, expiresAt: g.effectiveExpiresAt, status: g.status, ended: stored.hasEnded)
                }.filter { $0.status != .reconciled }
                let fact = ReflectionControlFact(version: 1, eventID: UUID(), sourceID: boundary.sourceID, sequence: sequence,
                    committedAt: try Instant(secondsSince1970: Date().timeIntervalSince1970), timeZone: TimeZone.current.identifier,
                    snapshotSequence: snapshot.snapshotSequence, policy: snapshot.policy, activation: snapshot.activation,
                    selections: snapshot.selections.filter { selection in
                        snapshot.policy.rules.contains { $0.selectionRef == selection.selection.ref }
                    }.map { ReflectionSelectionFact(ref: $0.selection.ref,
                        targets: $0.selection.targets.sorted { $0.rawValue.uuidString < $1.rawValue.uuidString }) },
                    grants: grants, application: snapshot.application.map {
                        ReflectionApplicationFact(evaluationID: $0.evaluation.id, policyRevision: $0.evaluation.policyRevision,
                            evaluationSequence: $0.evaluation.snapshotSequence, evaluatedAt: $0.evaluation.evaluatedAt,
                            observedAt: $0.observation.observedAt, timeZone: $0.evaluation.timeZone.identifier,
                            desiredTargets: $0.evaluation.desiredTargets.sorted { $0.rawValue.uuidString < $1.rawValue.uuidString },
                            status: $0.observation.status, evidence: $0.observation.evidence, failure: $0.observation.error,
                            scheduledValidUntil: $0.observation.validUntil)
                    })
                try fact.validate()
                let data = try Self.reflectionData(fact)
                guard data.count <= 65_536 else { throw StorageError.invalidPage }
                try database.execute("INSERT INTO reflection_outbox VALUES(?,?,?)",
                    [.integer(sequence), .text(fact.eventID.uuidString), .blob(data)])
            }
        } catch SQLiteFailure.rollbackFailure { throw StorageError.rollbackRequired }
        catch {
            try database.execute("UPDATE reflection_capture_state SET incomplete=1 WHERE singleton=1")
        }
    }

    func pendingHistoryAndReflectionCount() throws -> Int64 {
        guard case let .integer(history) = try database.rows("SELECT count(*) FROM history_outbox").first?.first else { throw StorageError.corrupt }
        guard try hasReflectionCapture() else { return history }
        guard let result = try? database.rows("SELECT count(*) FROM reflection_outbox"),
              case let .integer(reflection) = result.first?.first else {
            // Fail closed for optional history capacity, while retaining the safety operation.
            return Int64.max
        }
        let (sum, overflow) = history.addingReportingOverflow(reflection)
        guard !overflow else { throw StorageError.corrupt }; return sum
    }
    static func reflectionData(_ fact: ReflectionControlFact) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; return try encoder.encode(fact)
    }
    private func decodeReflection(_ row: [SQLValue], boundary: ReflectionBoundary) throws -> ReflectionControlFact {
        guard row.count == 3, case let .integer(sequence) = row[0], sequence > boundary.acknowledgedThrough,
              sequence <= boundary.highWatermark, case let .text(id) = row[1], case let .blob(data) = row[2],
              data.count <= 65_536 else { throw StorageError.corrupt }
        let fact: ReflectionControlFact
        do { fact = try JSONDecoder().decode(ReflectionControlFact.self, from: data); try fact.validate() }
        catch { throw StorageError.corrupt }
        guard fact.sequence == sequence, fact.sourceID == boundary.sourceID, fact.eventID.uuidString == id else { throw StorageError.corrupt }
        return fact
    }
}
