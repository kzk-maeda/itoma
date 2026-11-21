import Foundation

public struct ReflectionCumulativePoint: Encodable, Sendable {
    public let at: Double
    public let cumulativeSeconds: Double?
    /// The interval leading to this point has continuous coverage.
    public let connected: Bool
}

public struct ReflectionLandscape: Encodable, Sendable {
    public let startDay: String
    public let latestDay: String
    public let points: [ReflectionCumulativePoint]
}

public struct ReflectionInspectionWeek: Encodable, Sendable {
    public let anchor: String
    public let before: ReflectionPrototypeBucket?
    public let days: [ReflectionPrototypeBucket]
}

/// Prefix sums over disjoint, ordered ranges. Each query only visits two boundaries.
private struct IntervalPrefix: Sendable {
    private let ranges: [ReflectionPrototypeInterval]
    private let totals: [Double]

    init(_ ranges: [ReflectionPrototypeInterval]) {
        self.ranges = ranges
        var totals = [0.0]
        for range in ranges {
            totals.append(totals.last! + (range.until.secondsSince1970 - range.from.secondsSince1970))
        }
        self.totals = totals
    }

    func through(_ time: Instant) -> Double {
        var lo = 0, hi = ranges.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if ranges[mid].until <= time { lo = mid + 1 }
            else { hi = mid }
        }
        guard lo < ranges.count else { return totals[lo] }
        return totals[lo] + max(0, time.secondsSince1970 - ranges[lo].from.secondsSince1970)
    }

    func inRange(_ range: ReflectionPrototypeInterval) -> Double {
        min(range.until.secondsSince1970 - range.from.secondsSince1970, max(0, through(range.until) - through(range.from)))
    }
}

/// One prepared view of the existing interval calculation for a pinned snapshot.
public struct ReflectionIntervalIndex: Sendable {
    let input: ReflectionPrototypeDataset
    let range: ReflectionPrototypeInterval?
    private let known: IntervalPrefix
    private let gaps: IntervalPrefix
    private let observed: IntervalPrefix

    public init(_ input: ReflectionPrototypeDataset) {
        typealias Calc = ReflectionPrototypeCalculator
        self.input = input
        let range = input.recordedRange.flatMap { Calc.clipAtAsOf($0, input.asOf) }
        self.range = range
        let gaps = Calc.union(input.gaps)
        self.gaps = IntervalPrefix(gaps)
        let restricted = range.map { coverage in
            Calc.union(input.restricted.compactMap { Calc.intersection($0, coverage) })
        } ?? []
        known = IntervalPrefix(Calc.subtract(restricted, Calc.union(input.unlocked + gaps)))
        observed = IntervalPrefix(Calc.subtract(range.map { [$0] } ?? [], gaps))
    }

    private var calendar: Calendar {
        var result = Calendar(identifier: .gregorian)
        result.timeZone = TimeZone(identifier: input.timeZone)!
        result.firstWeekday = 2
        result.minimumDaysInFirstWeek = 4
        return result
    }

    var total: ReflectionPrototypeBucket {
        range.map { bucket($0) } ?? ReflectionPrototypeBucket(day: "", from: input.asOf.secondsSince1970,
            until: input.asOf.secondsSince1970, knownSeconds: nil, coverage: input.coverage == .recorded ? .notRecorded : input.coverage)
    }

    func bucket(_ interval: ReflectionPrototypeInterval) -> ReflectionPrototypeBucket {
        let overlap = range.flatMap { ReflectionPrototypeCalculator.intersection($0, interval) }
        let coverage: ReflectionPrototypeCoverage
        if input.coverage == .deleted { coverage = .deleted }
        else if input.scope == .pointObservations && input.coverage == .partial { coverage = .partial }
        else if overlap == nil { coverage = .notRecorded }
        else if input.scope == .pointObservations || input.coverage == .partial || overlap != interval || gaps.inRange(interval) > 0 {
            coverage = .partial
        } else { coverage = .recorded }
        let seconds = input.scope != .pointObservations && observed.inRange(interval) > 0 ? known.inRange(interval) : nil
        return ReflectionPrototypeBucket(day: ReflectionPrototypeCalculator.formatDay(interval.from.date, calendar),
            from: interval.from.secondsSince1970, until: interval.until.secondsSince1970, knownSeconds: seconds, coverage: coverage)
    }

    func landscape() -> ReflectionLandscape? {
        guard let range else { return nil }
        let start = range.from.secondsSince1970, end = range.until.secondsSince1970
        let count = min(64, max(1, Int(ceil((end - start) / 86_400))))
        var points: [ReflectionCumulativePoint] = []
        var from = range.from
        for i in 1...count {
            let until = i == count ? range.until : try! Instant(secondsSince1970: start + (end - start) * Double(i) / Double(count))
            let interval = try! ReflectionPrototypeInterval(from: from, until: until)
            let prefix = try! ReflectionPrototypeInterval(from: range.from, until: until)
            let cumulative = i == count ? total.knownSeconds : bucket(prefix).knownSeconds
            // Partial source coverage can be unlocated. In that case omit all connections.
            let connected = cumulative != nil && input.coverage == .recorded && gaps.inRange(interval) == 0
            points.append(.init(at: until.secondsSince1970, cumulativeSeconds: cumulative, connected: connected))
            from = until
        }
        return .init(startDay: ReflectionPrototypeCalculator.formatDay(range.from.date, calendar),
            latestDay: ReflectionPrototypeCalculator.formatDay(input.asOf.date, calendar), points: points)
    }

    public func week(day: String) throws -> ReflectionInspectionWeek {
        typealias Calc = ReflectionPrototypeCalculator
        let calendar = self.calendar
        let date = try Calc.parseDay(day, calendar)
        guard let bounds = calendar.dateInterval(of: .weekOfYear, for: date) else { throw ReflectionPrototypeError.invalidInput }
        let before = range.flatMap { range in
            (try? Calc.interval(range.from.date, min(bounds.start, range.until.date))).map { bucket($0) }
        }
        var days: [ReflectionPrototypeBucket] = []
        var cursor = bounds.start
        while cursor < bounds.end && cursor <= input.asOf.date && days.count < 7 {
            let start = cursor
            guard let dayBounds = calendar.dateInterval(of: .day, for: start), dayBounds.end > start else {
                throw ReflectionPrototypeError.invalidInput
            }
            cursor = min(dayBounds.end, bounds.end)
            // Keep the civil date at exact midnight as an unrecorded zero-length window.
            if start == input.asOf.date {
                days.append(.init(day: Calc.formatDay(start, calendar), from: input.asOf.secondsSince1970,
                                  until: input.asOf.secondsSince1970, knownSeconds: nil, coverage: .notRecorded))
            } else {
                days.append(bucket(try Calc.interval(start, min(cursor, input.asOf.date))))
            }
        }
        return .init(anchor: Calc.formatDay(bounds.start, calendar), before: before, days: days)
    }
}
