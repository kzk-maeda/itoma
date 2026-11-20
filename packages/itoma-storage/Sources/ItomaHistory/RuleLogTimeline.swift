import Foundation
import ItomaCore
import ItomaStorage

/// Reconstructs configured time from immutable historical policy/activation and successful grant
/// logs. Application readback/authorization checkpoints are deliberately not duration evidence.
/// One builder owns one source, in sequence order; History clips replaced sources separately.
struct RuleLogTimelineBuilder {
    private struct Unlock: Equatable {
        let id: GrantID
        let target: TargetRef
        let ruleID: RuleID
        let version: Int64
        let occurrenceStart: Instant
        let zone: String
        let acceptedAt: Instant
        let expiresAt: Instant
        let uncertain: Bool
    }
    private struct State: Equatable {
        let policy: PolicySnapshot
        let activation: Activation
        let zone: String
        let selections: [ReflectionSelectionFact]
        let unlocks: [Unlock]
    }
    private(set) var firstAt: Instant?
    private(set) var lastAt: Instant?
    private var lastSequence: Int64?
    private var pendingAt: Instant?
    private var state: State?
    private var restricted: [ReflectionPrototypeInterval] = []
    private var unlocked: [ReflectionPrototypeInterval] = []
    private var gaps: [ReflectionPrototypeInterval] = []
    private var incomplete = false

    mutating func append(_ fact: ReflectionControlFact) throws {
        try fact.validate()
        if let lastSequence, fact.sequence <= lastSequence { throw HistoryError.corrupt }
        let previousUnlocks = Set(state?.unlocks.filter { !$0.uncertain }.map(\.id) ?? [])
        let active = fact.activation == .enabled ? fact.grants.filter {
            !$0.ended && [.active, .applying, .uncertain].contains($0.status)
        } : []
        let next = State(policy: fact.policy, activation: fact.activation, zone: fact.timeZone,
            selections: fact.selections, unlocks: active.map {
                Unlock(id: $0.id, target: $0.target, ruleID: $0.ruleID, version: $0.ruleVersion,
                    occurrenceStart: $0.occurrenceStart, zone: $0.timeZone, acceptedAt: $0.acceptedAt, expiresAt: $0.expiresAt,
                    uncertain: $0.status != .active && !previousUnlocks.contains($0.id))
            }.sorted { $0.id.rawValue.uuidString < $1.id.rawValue.uuidString })
        if let lastAt, let lastSequence {
            let missing = fact.sequence != lastSequence + 1
            let backwards = fact.committedAt < lastAt
            if missing || backwards {
                try close(at: lastAt)
                let start = min(lastAt, fact.committedAt), end = max(lastAt, fact.committedAt)
                if start < end { gaps.append(try .init(from: start, until: end)) }
                incomplete = true
                pendingAt = fact.committedAt
            } else if next != state {
                try close(at: fact.committedAt)
                pendingAt = fact.committedAt
            }
        } else {
            firstAt = fact.committedAt
            pendingAt = fact.committedAt
        }
        state = next; lastAt = fact.committedAt; lastSequence = fact.sequence
    }

    func dataset(sourceID: UUID, revision: Int64, asOf: Instant, timeZone: String) throws -> ReflectionPrototypeDataset? {
        guard let firstAt, firstAt < asOf else { return nil }
        var finished = self
        try finished.close(at: asOf)
        return try ReflectionPrototypeDataset(sourceID: sourceID, revision: revision, asOf: asOf, timeZone: timeZone,
            scope: .ruleScheduleLogs, coverage: incomplete ? .partial : .recorded,
            recordedRange: .init(from: firstAt, until: asOf),
            restricted: ReflectionPrototypeCalculator.union(finished.restricted),
            unlocked: ReflectionPrototypeCalculator.union(finished.unlocked),
            gaps: ReflectionPrototypeCalculator.union(finished.gaps))
    }

    private mutating func close(at end: Instant) throws {
        guard let state, let start = pendingAt, start < end else { return }
        guard state.activation == .enabled else { return }
        var cursor = start
        // Bound calendar expansion even if the app has not been opened for years.
        while cursor < end {
            let until = try Instant(secondsSince1970: min(end.secondsSince1970, cursor.secondsSince1970 + 31 * 86_400))
            let relevantUnlocks = state.unlocks.filter { $0.expiresAt > cursor && $0.acceptedAt < until }
            let searchStart = min(cursor, relevantUnlocks.map(\.acceptedAt).min() ?? cursor)
            let context = try EvaluationContext(now: searchStart, timeZone: TimeZoneID(state.zone),
                authorization: AuthorizationObservation(status: .unknown, observedAt: searchStart), activation: state.activation)
            // Occurrence enumeration is configuration arithmetic; desiredTargets' live OS gate
            // is intentionally not used, and no Approved observation is manufactured.
            let rules = try RuleEvaluator.evaluate(policy: state.policy,
                selections: state.selections.map { Selection(ref: $0.ref, targets: Set($0.targets)) },
                context: context, through: until)
            let priorities = Dictionary(uniqueKeysWithValues: state.policy.priorityOrder.enumerated().map { ($1, $0) })
            for occurrence in rules.occurrences where !occurrence.targets.isEmpty {
                let from = max(cursor, occurrence.startsAt), to = min(until, occurrence.endsAt)
                if from < to { restricted.append(try .init(from: from, until: to)) }
            }
            for grant in relevantUnlocks {
                guard let occurrence = rules.occurrences.first(where: {
                    $0.rule.id == grant.ruleID && $0.rule.version.rawValue == grant.version
                        && $0.startsAt == grant.occurrenceStart && $0.key.timeZone.identifier == grant.zone
                        && $0.targets.contains(grant.target)
                }) else { continue }
                let from = max(cursor, grant.acceptedAt, occurrence.startsAt)
                var to = min(until, grant.expiresAt, occurrence.endsAt)
                // A grant cannot survive a higher-priority winner, then return when it ends.
                for other in rules.occurrences where other.targets.contains(grant.target)
                    && (priorities[other.rule.id]! < priorities[occurrence.rule.id]!
                        || (other.rule.id == occurrence.rule.id && other.startsAt > occurrence.startsAt))
                    && other.endsAt > grant.acceptedAt && other.startsAt < to {
                    to = min(to, max(grant.acceptedAt, other.startsAt))
                }
                if from < to {
                    if grant.uncertain { gaps.append(try .init(from: from, until: to)) }
                    else { unlocked.append(try .init(from: from, until: to)) }
                }
            }
            restricted = ReflectionPrototypeCalculator.union(restricted)
            unlocked = ReflectionPrototypeCalculator.union(unlocked)
            guard restricted.count + unlocked.count + gaps.count <= 20_000 else { throw HistoryError.invalidPage }
            cursor = until
        }
    }
}
