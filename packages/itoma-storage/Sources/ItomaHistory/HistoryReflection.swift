import Foundation
import ItomaCore
import ItomaSQLite
import ItomaStorage

public struct ReflectionReadSnapshot: Encodable, Sendable {
    public let version = 1
    public let metricVersion: String
    public let proofScope: String
    public let token: String
    public let historyRevision: String
    public let timeZone: String
    public let asOf: Double
    public let observationCount: Int64
    public let lastObservedAt: Double?
    public let incomplete: Bool
    public let total: ReflectionPrototypeBucket
    public let trend: [ReflectionPrototypeBucket]
    public let landscape: ReflectionLandscape?
    public let inspectionWeek: ReflectionInspectionWeek?
    public let period: ReflectionPrototypePeriod
    public let anchor: String
    public let previousAnchor: String?
    public let nextAnchor: String?
    public let selected: ReflectionPrototypeBucket
    public let buckets: [ReflectionPrototypeBucket]
}
public struct ReflectionWeekRead: Encodable, Sendable {
    public let token: String
    public let week: ReflectionInspectionWeek
}
private struct ReflectionReadToken: Codable {
    let datasetID: UUID
    let ledgerRevision: Int64
    let historyRevision: Int64
    let asOf: Instant
    let timeZone: String
    var metricVersion: String? = nil
    func string() throws -> String { "reflection-v1:" + (try JSONEncoder().encode(self)).base64EncodedString() }
    static func parse(_ string: String) throws -> Self {
        let prefix = "reflection-v1:"
        guard string.utf8.count <= 1_024, string.hasPrefix(prefix),
              let data = Data(base64Encoded: String(string.dropFirst(prefix.count))) else { throw HistoryError.conflict }
        do { return try JSONDecoder().decode(Self.self, from: data) } catch { throw HistoryError.conflict }
    }
}

extension HistoryRepository: ReflectionFactSink {
    func createReflectionTables() throws {
        try database.execute("CREATE TABLE reflection_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),dataset_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=0),deleted INTEGER NOT NULL CHECK(deleted IN (0,1)))")
        try database.execute("INSERT INTO reflection_state VALUES(1,?,0,0)", [.text(UUID().uuidString)])
        try database.execute("""
            CREATE TABLE reflection_sources(
              source_id TEXT PRIMARY KEY NOT NULL,high_water INTEGER NOT NULL CHECK(high_water>=0),
              imported_through INTEGER NOT NULL CHECK(imported_through>=0 AND imported_through<=high_water),
              deleted_through INTEGER NOT NULL CHECK(deleted_through>=0 AND deleted_through<=high_water),
              incomplete INTEGER NOT NULL CHECK(incomplete IN (0,1)))
            """)
        try database.execute("""
            CREATE TABLE reflection_facts(
              cursor INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,
              source_id TEXT NOT NULL REFERENCES reflection_sources(source_id),sequence INTEGER NOT NULL CHECK(sequence>0),
              committed_at REAL NOT NULL,record BLOB,payload_bytes INTEGER NOT NULL CHECK(payload_bytes>=0),
              UNIQUE(source_id,sequence),
              CHECK((record IS NULL AND payload_bytes=0) OR (record IS NOT NULL AND length(record)=payload_bytes)))
            """)
    }

    public func commitReflectionBatch(_ batch: ReflectionFactBatch) throws {
        guard batch.facts.count <= 100, batch.boundary.highWatermark >= batch.boundary.acknowledgedThrough,
              batch.boundary.acknowledgedThrough >= 0 else { throw HistoryError.corrupt }
        try transaction(writer: true) {
            try validateReflectionRelations()
            let before = try reflectionSource(batch.boundary.sourceID)
            try observeReflection(batch.boundary)
            var changed = before == nil || (before?.high ?? 0) < batch.boundary.highWatermark || (batch.boundary.incomplete && before?.incomplete == false)
            var inserted = false
            var previous = batch.boundary.acknowledgedThrough
            for fact in batch.facts {
                guard fact.sourceID == batch.boundary.sourceID, fact.sequence > previous,
                      fact.sequence <= batch.boundary.highWatermark else { throw HistoryError.corrupt }
                previous = fact.sequence
                do { try fact.validate() } catch { throw HistoryError.corrupt }
                let data = try JSONEncoder().encode(fact)
                guard data.count <= 65_536 else { throw HistoryError.corrupt }
                let id = fact.eventID.uuidString, source = fact.sourceID.uuidString
                let state = try reflectionSource(fact.sourceID)!
                if fact.sequence <= state.deleted { continue }
                let existing = try database.rows("SELECT event_id,source_id,sequence,record FROM reflection_facts WHERE event_id=? OR (source_id=? AND sequence=?)",
                    [.text(id), .text(source), .integer(fact.sequence)])
                if let row = existing.first {
                    guard row[0] == .text(id), row[1] == .text(source), row[2] == .integer(fact.sequence),
                          case let .blob(old) = row[3], try decodeReflectionFact(old) == fact else { throw HistoryError.conflict }
                    continue
                }
                try checkCapacity(adding: data.count) // Combined reason/history/reflection payload budget.
                try database.execute("INSERT INTO reflection_facts(event_id,source_id,sequence,committed_at,record,payload_bytes) VALUES(?,?,?,?,?,?)",
                    [.text(id), .text(source), .integer(fact.sequence), .real(fact.committedAt.secondsSince1970), .blob(data), .integer(Int64(data.count))])
                let covered = max(state.imported, state.deleted)
                let gap = fact.sequence > covered && fact.sequence - covered > 1
                try database.execute("UPDATE reflection_sources SET imported_through=max(imported_through,?),incomplete=max(incomplete,?) WHERE source_id=?",
                    [.integer(fact.sequence), .integer(gap ? 1 : 0), .text(source)])
                changed = true; inserted = true
            }
            if changed {
                try advanceReflectionRevision()
                if inserted { try database.execute("UPDATE reflection_state SET deleted=0 WHERE singleton=1") }
            }
        }
    }

    /// A single private read transaction pins both revisions and the calendar/as-of.
    /// Recalculates historical rule time; it is distinct from native enforcement measurement.
    public func readReflection(period: ReflectionPrototypePeriod, day: String, timeZone: String,
                               expectedToken: String? = nil, clippedTo: ReflectionPrototypeInterval? = nil,
                               includeLandscape: Bool? = nil,
                               now: Instant = try! Instant(secondsSince1970: Date().timeIntervalSince1970)) throws -> ReflectionReadSnapshot {
        try transaction(writer: false) {
            try validateReflectionPayloads()
            let state = try reflectionState(), historyRevision = try readRevision()
            var token: ReflectionReadToken
            if let expectedToken {
                token = try ReflectionReadToken.parse(expectedToken)
                guard token.datasetID == state.id, token.ledgerRevision == state.revision,
                      token.historyRevision == historyRevision, token.timeZone == timeZone,
                      token.asOf <= now else { throw HistoryError.conflict }
            } else {
                token = ReflectionReadToken(datasetID: state.id, ledgerRevision: state.revision, historyRevision: historyRevision, asOf: now, timeZone: timeZone)
            }
            let metric = "rule-schedule-excluding-unlocks-v1"
            if expectedToken != nil {
                guard token.metricVersion == metric else { throw HistoryError.conflict }
            } else { token.metricVersion = metric }
            let stamp = try expectedToken ?? token.string()
            let (count, first, last) = try reflectionFactBounds(asOf: token.asOf)
            let index = try reflectionIndex(token, stamp: stamp, count: count, first: first)
            let anchor: String
            if day.isEmpty {
                var calendar = Calendar(identifier: .gregorian)
                guard let zone = TimeZone(identifier: timeZone) else { throw HistoryError.invalidPage }
                calendar.timeZone = zone
                let parts = calendar.dateComponents([.year, .month, .day], from: token.asOf.date)
                anchor = String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
            } else { anchor = day }
            let view = try ReflectionPrototypeCalculator.snapshot(index, period: period, day: anchor, clippedTo: clippedTo, includeLandscape: includeLandscape)
            let incomplete = try !database.rows("SELECT 1 FROM reflection_sources WHERE incomplete=1 LIMIT 1").isEmpty
            return ReflectionReadSnapshot(metricVersion: metric,
                proofScope: view.proofScope.rawValue, token: stamp, historyRevision: String(historyRevision),
                timeZone: timeZone, asOf: token.asOf.secondsSince1970, observationCount: count, lastObservedAt: last, incomplete: incomplete,
                total: view.total, trend: view.trend, landscape: view.landscape, inspectionWeek: view.inspectionWeek, period: view.period, anchor: view.anchor,
                previousAnchor: view.previousAnchor, nextAnchor: view.nextAnchor, selected: view.selected, buckets: view.buckets)
        }
    }

    public func readReflectionWeek(day: String, timeZone: String, expectedToken: String,
                                   now: Instant = try! Instant(secondsSince1970: Date().timeIntervalSince1970)) throws -> ReflectionWeekRead {
        try transaction(writer: false) {
            try validateReflectionPayloads()
            let state = try reflectionState(), token = try ReflectionReadToken.parse(expectedToken)
            guard token.datasetID == state.id, token.ledgerRevision == state.revision,
                  token.historyRevision == (try readRevision()), token.timeZone == timeZone,
                  token.metricVersion == "rule-schedule-excluding-unlocks-v1", token.asOf <= now else { throw HistoryError.conflict }
            let index = try reflectionIndex(token, stamp: expectedToken)
            return ReflectionWeekRead(token: expectedToken, week: try index.week(day: day))
        }
    }

    private func reflectionFactBounds(asOf: Instant) throws -> (Int64, Double?, Double?) {
        let rows = try database.rows("SELECT count(*),min(committed_at),max(committed_at) FROM reflection_facts WHERE record IS NOT NULL AND committed_at<=?",
            [.real(asOf.secondsSince1970)])
        guard let row = rows.first, case let .integer(count) = row[0], count >= 0 else { throw HistoryError.corrupt }
        func real(_ value: SQLValue) throws -> Double? {
            if value == .null { return nil }
            guard case let .real(number) = value, number.isFinite else { throw HistoryError.corrupt }; return number
        }
        return try (count, real(row[1]), real(row[2]))
    }

    private func reflectionIndex(_ token: ReflectionReadToken, stamp: String, count: Int64? = nil, first: Double? = nil) throws -> ReflectionIntervalIndex {
        guard case let .integer(dataVersion) = try database.rows("PRAGMA main.data_version").first?.first else { throw HistoryError.corrupt }
        if let cached = reflectionIndexCache, cached.token == stamp, cached.dataVersion == dataVersion { return cached.value }
        let state = try reflectionState(), timeZone = token.timeZone
        let bounds = try count.map { ($0, first) } ?? { let (count, first, _) = try reflectionFactBounds(asOf: token.asOf); return (count, first) }()
        let range = try bounds.1.flatMap { start in start < token.asOf.secondsSince1970
            ? try ReflectionPrototypeInterval(from: Instant(secondsSince1970: start), until: token.asOf) : nil }
        let coverage: ReflectionPrototypeCoverage = bounds.0 > 0 ? .partial : state.deleted ? .deleted : .notRecorded
        let legacy = try ReflectionPrototypeDataset(sourceID: state.id, revision: state.revision, asOf: token.asOf,
            timeZone: timeZone, scope: .ruleScheduleLogs, coverage: coverage, recordedRange: range,
            gaps: range.map { [$0] } ?? []) // Reconstruction failure is missing data, never known zero.
        let input = try ruleLogRestrictionDataset(sourceID: state.id, revision: state.revision, asOf: token.asOf, timeZone: timeZone) ?? legacy
        let index = ReflectionIntervalIndex(input)
        reflectionIndexCache = (stamp, dataVersion, index)
        return index
    }

    /// Reuses immutable log projections, but calculates the open last policy through pinned as-of.
    /// Metric identity prevents old native/point tokens from being reused after this change.
    private func ruleLogRestrictionDataset(sourceID: UUID, revision: Int64, asOf: Instant, timeZone: String) throws -> ReflectionPrototypeDataset? {
        guard case let .integer(dataVersion) = try database.rows("PRAGMA main.data_version").first?.first else { throw HistoryError.corrupt }
        let builders: [UUID: RuleLogTimelineBuilder]
        if let cached = ruleLogTimelineCache, cached.revision == revision, cached.dataVersion == dataVersion,
           cached.asOf == asOf || (!cached.hasFutureRecords && cached.asOf <= asOf) {
            builders = cached.builders
        } else {
            var projections: [UUID: RuleLogTimelineBuilder] = [:]
            var source = "", sequence: Int64 = 0, hasFutureRecords = false
            while true {
                let rows = try database.rows("""
                    SELECT source_id,sequence,record FROM reflection_facts
                    WHERE record IS NOT NULL AND (source_id>? OR (source_id=? AND sequence>?))
                    ORDER BY source_id,sequence LIMIT 100
                    """, [.text(source), .text(source), .integer(sequence)])
                if rows.isEmpty { break }
                for row in rows {
                    guard case let .text(id) = row[0], let uuid = UUID(uuidString: id),
                          case let .integer(seq) = row[1], case let .blob(data) = row[2] else { throw HistoryError.corrupt }
                    let fact = try decodeReflectionFact(data)
                    if fact.committedAt <= asOf {
                        guard projections[uuid] != nil || projections.count < 20_000 else { throw HistoryError.invalidPage }
                        try projections[uuid, default: RuleLogTimelineBuilder()].append(fact)
                    }
                    else { hasFutureRecords = true }
                    source = id; sequence = seq
                }
            }
            ruleLogTimelineCache = (revision, dataVersion, asOf, hasFutureRecords, projections)
            builders = projections
        }
        let ordered = builders.filter { $0.value.firstAt != nil }.sorted {
            $0.value.firstAt! == $1.value.firstAt! ? $0.key.uuidString < $1.key.uuidString : $0.value.firstAt! < $1.value.firstAt!
        }
        var restricted: [ReflectionPrototypeInterval] = [], unlocked: [ReflectionPrototypeInterval] = [], gaps: [ReflectionPrototypeInterval] = []
        var first: Instant?, partial = false
        let unrepresentedPending = try !database.rows("""
            SELECT 1 FROM reflection_sources s WHERE max(s.imported_through,s.deleted_through)<s.high_water
              AND NOT EXISTS(SELECT 1 FROM reflection_facts f WHERE f.source_id=s.source_id AND f.record IS NOT NULL) LIMIT 1
            """).isEmpty
        for (index, item) in ordered.enumerated() {
            let windowEnd = min(asOf, index + 1 < ordered.count ? ordered[index + 1].value.firstAt! : asOf)
            var end = windowEnd
            first = min(first ?? item.value.firstAt!, item.value.firstAt!)
            let tied = (index > 0 && ordered[index - 1].value.firstAt == item.value.firstAt)
                || (index + 1 < ordered.count && ordered[index + 1].value.firstAt == item.value.firstAt)
            if tied {
                if item.value.firstAt! < windowEnd { gaps.append(try .init(from: item.value.firstAt!, until: windowEnd)) }
                partial = true // Equal source start times cannot establish which intent is newer.
                continue
            }
            let source = try reflectionSource(item.key)
            let pending = source.map { max($0.imported, $0.deleted) < $0.high } == true
                || (unrepresentedPending && index == ordered.count - 1)
            if pending, let last = item.value.lastAt {
                end = min(end, last)
                if end < windowEnd { gaps.append(try .init(from: end, until: windowEnd)) }
                partial = true // A pending/lost stop or unlock must not be extrapolated away.
            }
            guard let dataset = try item.value.dataset(sourceID: sourceID, revision: revision, asOf: end, timeZone: timeZone),
                  let range = dataset.recordedRange else { continue }
            first = min(first ?? range.from, range.from)
            restricted += dataset.restricted.compactMap { ReflectionPrototypeCalculator.intersection($0, range) }
            unlocked += dataset.unlocked.compactMap { ReflectionPrototypeCalculator.intersection($0, range) }
            gaps += dataset.gaps.compactMap { ReflectionPrototypeCalculator.intersection($0, range) }
            partial = partial || dataset.coverage == .partial
            guard restricted.count + unlocked.count + gaps.count <= 20_000 else { throw HistoryError.invalidPage }
        }
        guard let first, first < asOf else { return nil }
        let incomplete = try !database.rows("SELECT 1 FROM reflection_sources WHERE incomplete=1 LIMIT 1").isEmpty
        return try ReflectionPrototypeDataset(sourceID: sourceID, revision: revision, asOf: asOf, timeZone: timeZone,
            scope: .ruleScheduleLogs, coverage: incomplete || partial ? .partial : .recorded,
            recordedRange: .init(from: first, until: asOf), restricted: ReflectionPrototypeCalculator.union(restricted),
            unlocked: ReflectionPrototypeCalculator.union(unlocked), gaps: ReflectionPrototypeCalculator.union(gaps))
    }

    /// Captures shared cutoffs before opening the private writer. First import is not required.
    /// No OS action is performed and no past policy is reconstructed.
    public func deleteAllRecords(from control: ControlRepository) throws {
        try deleteAllRecords(through: control.recordsDeletionBoundary())
    }
    func deleteAllRecords(through boundary: RecordsDeletionBoundary) throws {
        try transaction(writer: true) {
            try deleteHistoryPayload(through: boundary.history)
            if let current = boundary.reflection {
                try observeReflection(current)
                try database.execute("""
                    UPDATE reflection_sources SET deleted_through=max(deleted_through,
                      CASE WHEN source_id=? THEN ? ELSE high_water END)
                    """, [.text(current.sourceID.uuidString), .integer(current.highWatermark)])
            } else {
                try database.execute("UPDATE reflection_sources SET deleted_through=high_water")
            }
            try database.execute("""
                UPDATE reflection_facts SET record=NULL,payload_bytes=0
                WHERE sequence<=(SELECT deleted_through FROM reflection_sources WHERE source_id=reflection_facts.source_id)
                """)
            try advanceReflectionRevision()
            try database.execute("UPDATE reflection_state SET deleted=NOT EXISTS(SELECT 1 FROM reflection_facts WHERE record IS NOT NULL) WHERE singleton=1")
        }
    }

    func validateReflectionRelations() throws {
        _ = try reflectionState()
        var key = ""
        while true {
            let rows = try database.rows("SELECT source_id FROM reflection_sources WHERE source_id>? ORDER BY source_id LIMIT 100", [.text(key)])
            if rows.isEmpty { break }
            for row in rows {
                guard case let .text(raw) = row[0], let source = UUID(uuidString: raw), source.uuidString == raw else { throw HistoryError.corrupt }
                _ = try reflectionSource(source); key = raw
            }
        }
        guard try database.rows("""
            SELECT 1 FROM reflection_facts f LEFT JOIN reflection_sources s ON f.source_id=s.source_id
            WHERE s.source_id IS NULL OR f.sequence>s.high_water
              OR (f.record IS NULL AND f.sequence>s.deleted_through)
              OR (f.record IS NOT NULL AND f.sequence<=s.deleted_through) LIMIT 1
            """).isEmpty else { throw HistoryError.corrupt }
    }
    func validateReflectionPayloads() throws {
        let dataVersion: Int64?
        if reflectionReadValidationAllowed && database.hasActiveTransaction {
            guard case let .integer(version) = try database.rows("PRAGMA main.data_version").first?.first,
                  version >= 0 else { throw HistoryError.corrupt }
            if reflectionValidationDataVersion == version { return }
            dataVersion = version
        } else { dataVersion = nil } // Writers and migration always validate their current data.
        reflectionValidationDataVersion = nil
        try validateReflectionRelations()
        var cursor: Int64 = 0
        while true {
            let rows = try database.rows("SELECT cursor,event_id,source_id,sequence,committed_at,record FROM reflection_facts WHERE cursor>? ORDER BY cursor LIMIT 100", [.integer(cursor)])
            if rows.isEmpty { break }
            for row in rows {
                guard case let .integer(next) = row[0], next > cursor else { throw HistoryError.corrupt }; cursor = next
                guard case let .text(id) = row[1], let uuid = UUID(uuidString: id), uuid.uuidString == id,
                      case let .text(source) = row[2], let sourceID = UUID(uuidString: source), sourceID.uuidString == source,
                      case let .integer(sequence) = row[3], sequence > 0, case let .real(at) = row[4], at.isFinite else { throw HistoryError.corrupt }
                if case let .blob(data) = row[5] {
                    let fact = try decodeReflectionFact(data)
                    guard fact.eventID == uuid, fact.sourceID == sourceID, fact.sequence == sequence,
                          fact.committedAt.secondsSince1970 == at else { throw HistoryError.corrupt }
                } else if row[5] != .null { throw HistoryError.corrupt }
            }
        }
        _ = try logicalBytes()
        // Publish only after every payload/relation/capacity check succeeded in this snapshot.
        if let dataVersion { reflectionValidationDataVersion = dataVersion }
    }
    private func decodeReflectionFact(_ data: Data) throws -> ReflectionControlFact {
        guard data.count <= 65_536 else { throw HistoryError.corrupt }
        do {
            let fact = try JSONDecoder().decode(ReflectionControlFact.self, from: data)
            try fact.validate(); return fact
        }
        catch { throw HistoryError.corrupt }
    }
    private func reflectionState() throws -> (id: UUID, revision: Int64, deleted: Bool) {
        guard let row = try database.rows("SELECT dataset_id,revision,deleted FROM reflection_state WHERE singleton=1").first,
              case let .text(raw) = row[0], let id = UUID(uuidString: raw), id.uuidString == raw,
              case let .integer(revision) = row[1], revision >= 0,
              [.integer(0), .integer(1)].contains(row[2]) else { throw HistoryError.corrupt }
        return (id, revision, row[2] == .integer(1))
    }
    private func advanceReflectionRevision() throws {
        guard try reflectionState().revision < Int64.max else { throw HistoryError.databaseFailure }
        try database.execute("UPDATE reflection_state SET revision=revision+1 WHERE singleton=1")
    }
    private func reflectionSource(_ source: UUID) throws -> (high: Int64, imported: Int64, deleted: Int64, incomplete: Bool)? {
        guard let row = try database.rows("SELECT high_water,imported_through,deleted_through,incomplete FROM reflection_sources WHERE source_id=?", [.text(source.uuidString)]).first else { return nil }
        guard case let .integer(high) = row[0], high >= 0, case let .integer(imported) = row[1], imported >= 0, imported <= high,
              case let .integer(deleted) = row[2], deleted >= 0, deleted <= high,
              [.integer(0), .integer(1)].contains(row[3]) else { throw HistoryError.corrupt }
        return (high, imported, deleted, row[3] == .integer(1))
    }
    private func observeReflection(_ boundary: ReflectionBoundary) throws {
        guard boundary.highWatermark >= 0 else { throw HistoryError.corrupt }
        if try reflectionSource(boundary.sourceID) == nil {
            try database.execute("INSERT INTO reflection_sources VALUES(?,?,0,0,?)",
                [.text(boundary.sourceID.uuidString), .integer(boundary.highWatermark), .integer(boundary.incomplete ? 1 : 0)])
        } else {
            try database.execute("UPDATE reflection_sources SET high_water=max(high_water,?),incomplete=max(incomplete,?) WHERE source_id=?",
                [.integer(boundary.highWatermark), .integer(boundary.incomplete ? 1 : 0), .text(boundary.sourceID.uuidString)])
        }
    }
}
