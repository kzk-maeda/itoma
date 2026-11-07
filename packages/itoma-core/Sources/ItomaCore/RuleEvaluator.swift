import Foundation

public enum RuleEvaluationError: Error, Equatable, Sendable {
    case invalidEvaluationWindow
    case unsupportedDateRange
    case duplicateSelection
    case missingSelection
    case unresolvableBoundary
}

public struct RuleOccurrence: Equatable, Sendable {
    public let rule: Rule
    public let key: OccurrenceKey
    public let endsAt: Instant
    public let targets: Set<TargetRef>
    public var startsAt: Instant { key.resolvedStart }

    public func contains(_ instant: Instant) -> Bool { startsAt <= instant && instant < endsAt }
}

/// A collapsed DST interval is reported, never expanded into a full day.
public struct InvalidOccurrence: Equatable, Sendable {
    public let key: OccurrenceKey
    public let resolvedEnd: Instant
}

/// Facts for edit confirmation within the requested window; no save or reorder is performed.
public struct RuleOverlap: Equatable, Sendable {
    public let higherPriority: OccurrenceKey
    public let lowerPriority: OccurrenceKey
    public let targets: Set<TargetRef>
    public let startsAt: Instant
    public let endsAt: Instant
}

public struct TargetRuleEvaluation: Equatable, Sendable {
    /// Priority order, then newest occurrence first for the same rule.
    public let activeOccurrences: [RuleOccurrence]
    public var winner: RuleOccurrence? { activeOccurrences.first }
    /// Compares full occurrence keys, including transitions between days of the same rule.
    public let nextWinnerChange: Instant?
}

/// Configuration baseline before grants. This is not an OS application observation.
public struct RuleEvaluation: Equatable, Sendable {
    public let policyRevision: PolicyRevision
    public let context: EvaluationContext
    public let evaluatedThrough: Instant
    public let occurrences: [RuleOccurrence]
    public let targets: [TargetRef: TargetRuleEvaluation]
    public let desiredTargets: Set<TargetRef>
    public let nextBoundary: Instant?
    /// Refresh even when no boundary was found inside the finite search window.
    public var nextEvaluationAt: Instant { nextBoundary ?? evaluatedThrough }
    public let overlaps: [RuleOverlap]
    public let invalidOccurrences: [InvalidOccurrence]
    public var activeOccurrences: [RuleOccurrence] { occurrences.filter { $0.contains(context.now) } }
}

public enum RuleEvaluator {
    /// An explicit UTC coverage limit prevents nil from meaning "no future event ever".
    /// At most 366 elapsed days per call; this is a query bound, not a schedule duration limit.
    public static func evaluate(
        policy: PolicySnapshot, selections: [Selection], context: EvaluationContext, through: Instant
    ) throws -> RuleEvaluation {
        let now = context.now
        guard now < through, through.secondsSince1970 - now.secondsSince1970 <= 366 * 86400 else {
            throw RuleEvaluationError.invalidEvaluationWindow
        }
        // Leave a year of room on both ends for civil-day arithmetic and timezone resolution.
        // Reject extreme finite Instant values before passing them to Foundation.
        guard now.secondsSince1970 >= -62_104_060_800,
              through.secondsSince1970 < 253_370_764_800 else {
            throw RuleEvaluationError.unsupportedDateRange
        }
        var selectionsByRef: [SelectionRef: Set<TargetRef>] = [:]
        for selection in selections {
            guard selectionsByRef.updateValue(selection.targets, forKey: selection.ref) == nil else {
                throw RuleEvaluationError.duplicateSelection
            }
        }
        let enabled = policy.rules.filter(\.enabled)
        for rule in enabled where selectionsByRef[rule.selectionRef] == nil {
            throw RuleEvaluationError.missingSelection
        }
        let priority = Dictionary(uniqueKeysWithValues: policy.priorityOrder.enumerated().map { ($1, $0) })
        let precedes: (RuleOccurrence, RuleOccurrence) -> Bool = { a, b in
            if a.rule.id != b.rule.id { return priority[a.rule.id]! < priority[b.rule.id]! }
            if a.startsAt != b.startsAt { return a.startsAt > b.startsAt }
            let x = a.key.startDay, y = b.key.startDay
            return (x.year, x.month, x.day) > (y.year, y.month, y.day)
        }
        let civil = CivilCalendar(zone: context.timeZone)
        // Two previous nominal days also cover a skipped local day (e.g. Apia 2011).
        var day = civil.midnight(for: now).addingTimeInterval(-2 * 86400)
        // Include later nominal dates that may have begun before a rollback across midnight.
        let lastDay = civil.midnight(for: through).addingTimeInterval(2 * 86400)
        var occurrences: [RuleOccurrence] = []
        var invalid: [InvalidOccurrence] = []
        while day <= lastDay {
            let weekday = Weekday(rawValue: (civil.calendar.component(.weekday, from: day) + 5) % 7 + 1)!
            for rule in enabled where rule.schedule.weekdays.contains(weekday) {
                let schedule = rule.schedule
                let start = try civil.resolve(day: day, minute: schedule.startMinute, isStart: true)
                let endDay = day.addingTimeInterval(Double(schedule.endDayOffset.rawValue * 86400))
                let end = try civil.resolve(day: endDay, minute: schedule.endMinute, isStart: false)
                let key = try OccurrenceKey(
                    ruleID: rule.id, ruleVersion: rule.version, startDay: civil.localDate(day),
                    timeZone: context.timeZone, resolvedStart: start
                )
                if start >= end {
                    if now <= start && start <= through { invalid.append(InvalidOccurrence(key: key, resolvedEnd: end)) }
                } else if end > now && start <= through {
                    occurrences.append(RuleOccurrence(rule: rule, key: key, endsAt: end, targets: selectionsByRef[rule.selectionRef]!))
                }
            }
            day = day.addingTimeInterval(86400)
        }
        occurrences.sort { a, b in a.startsAt == b.startsAt ? precedes(a, b) : a.startsAt < b.startsAt }
        let allTargets = enabled.reduce(into: Set<TargetRef>()) { $0.formUnion(selectionsByRef[$1.selectionRef]!) }
        var targetResults: [TargetRef: TargetRuleEvaluation] = [:]
        for target in allTargets {
            let relevant = occurrences.filter { $0.targets.contains(target) }.sorted(by: precedes)
            let active = relevant.filter { $0.contains(now) }
            let current = active.first?.key
            let nextChange = boundaries(relevant, after: now, through: through).first { time in
                relevant.first(where: { $0.contains(time) })?.key != current
            }
            targetResults[target] = TargetRuleEvaluation(activeOccurrences: active, nextWinnerChange: nextChange)
        }
        var overlaps: [RuleOverlap] = []
        for (index, a) in occurrences.enumerated() {
            for b in occurrences.dropFirst(index + 1) {
                if b.startsAt >= a.endsAt { break }
                if a.rule.id == b.rule.id { continue }
                let common = a.targets.intersection(b.targets)
                let start = max(now, a.startsAt, b.startsAt), end = min(through, a.endsAt, b.endsAt)
                if !common.isEmpty && start < end {
                    let higher = precedes(a, b) ? a : b, lower = precedes(a, b) ? b : a
                    overlaps.append(RuleOverlap(higherPriority: higher.key, lowerPriority: lower.key,
                                                targets: common, startsAt: start, endsAt: end))
                }
            }
        }
        let canActivate = context.activation == .enabled && context.authorization.status == .approved
        let desired = canActivate ? Set(targetResults.compactMap { $0.value.winner == nil ? nil : $0.key }) : []
        return RuleEvaluation(
            policyRevision: policy.revision, context: context, evaluatedThrough: through,
            occurrences: occurrences, targets: targetResults, desiredTargets: desired,
            nextBoundary: boundaries(occurrences, after: now, through: through).first,
            overlaps: overlaps, invalidOccurrences: invalid
        )
    }

    private static func boundaries(_ occurrences: [RuleOccurrence], after: Instant, through: Instant) -> [Instant] {
        Set(occurrences.flatMap { [$0.startsAt, $0.endsAt] }.filter { after < $0 && $0 <= through }).sorted()
    }
}

/// UTC calendar dates encode nominal local dates, so stepping a day never skips a DST date.
private struct CivilCalendar {
    let zone: TimeZoneID
    let calendar: Calendar = {
        var value = Calendar(identifier: .iso8601)
        // Fixed zero offset without the newer TimeZone.gmt deployment requirement.
        value.timeZone = TimeZone(secondsFromGMT: 0)!
        return value
    }()

    func midnight(for instant: Instant) -> Date {
        let wall = instant.date.addingTimeInterval(Double(zone.timeZone.secondsFromGMT(for: instant.date)))
        return calendar.startOfDay(for: wall)
    }

    func localDate(_ nominalDay: Date) throws -> LocalDate {
        let c = calendar.dateComponents([.year, .month, .day], from: nominalDay)
        return try LocalDate(year: c.year!, month: c.month!, day: c.day!)
    }

    func resolve(day: Date, minute: Int, isStart: Bool) throws -> Instant {
        let wall = day.addingTimeInterval(Double(minute * 60))
        let lower = wall.addingTimeInterval(-2 * 86400), upper = wall.addingTimeInterval(2 * 86400)
        let tz = zone.timeZone
        var offsets: Set<Int> = [tz.secondsFromGMT(for: lower), tz.secondsFromGMT(for: upper)]
        var cursor = lower
        var gapEnd: Date?
        // Foundation exposes timezone transitions here, including political offset changes.
        // Do not rely on Calendar.nextDate's handling of 30-minute gaps/repeated times.
        while let transition = tz.nextDaylightSavingTimeTransition(after: cursor), transition <= upper {
            let before = tz.secondsFromGMT(for: transition.addingTimeInterval(-1))
            let after = tz.secondsFromGMT(for: transition)
            offsets.formUnion([before, after])
            if after > before,
               wall >= transition.addingTimeInterval(Double(before)),
               wall < transition.addingTimeInterval(Double(after)) { gapEnd = transition }
            guard transition > cursor else { throw RuleEvaluationError.unresolvableBoundary }
            cursor = transition.addingTimeInterval(1)
        }
        let candidates = offsets.compactMap { offset -> Date? in
            let candidate = wall.addingTimeInterval(-Double(offset))
            return tz.secondsFromGMT(for: candidate) == offset ? candidate : nil
        }.sorted()
        guard let resolved = (isStart ? candidates.first : candidates.last) ?? gapEnd else {
            throw RuleEvaluationError.unresolvableBoundary
        }
        return try Instant(resolved)
    }
}
