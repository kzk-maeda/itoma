import Foundation

/// Experimental arithmetic only. No OS adapter qualifies a continuous restriction interval yet.
public enum ReflectionPrototypeError: Error, Equatable, Sendable { case invalidInterval, invalidInput, changed }
public enum ReflectionPrototypeScope: String, Codable, Sendable { case syntheticFixture, pointObservations }
public enum ReflectionPrototypeCoverage: String, Codable, Sendable { case recorded, partial, notRecorded, deleted }
public enum ReflectionPrototypePeriod: String, Codable, Sendable { case week, month }

public struct ReflectionPrototypeInterval: Equatable, Codable, Sendable {
    public let from: Instant
    public let until: Instant
    public init(from: Instant, until: Instant) throws {
        guard from < until else { throw ReflectionPrototypeError.invalidInterval }
        self.from = from; self.until = until
    }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(from: c.decode(Instant.self, forKey: .from), until: c.decode(Instant.self, forKey: .until))
    }
    enum CodingKeys: CodingKey { case from, until }
}

public struct ReflectionPrototypeDataset: Sendable {
    public let sourceID: UUID
    public let revision: Int64
    public let asOf: Instant
    public let timeZone: String
    public let scope: ReflectionPrototypeScope
    public let coverage: ReflectionPrototypeCoverage
    public let recordedRange: ReflectionPrototypeInterval?
    public let restricted: [ReflectionPrototypeInterval]
    public let unlocked: [ReflectionPrototypeInterval]
    public let gaps: [ReflectionPrototypeInterval]

    public init(sourceID: UUID, revision: Int64, asOf: Instant, timeZone: String,
                scope: ReflectionPrototypeScope, coverage: ReflectionPrototypeCoverage,
                recordedRange: ReflectionPrototypeInterval?, restricted: [ReflectionPrototypeInterval] = [],
                unlocked: [ReflectionPrototypeInterval] = [], gaps: [ReflectionPrototypeInterval] = []) throws {
        let intervals = restricted + unlocked + gaps + (recordedRange.map { [$0] } ?? [])
        let supported = -2_208_988_800.0...253_370_764_800.0
        guard revision >= 0, TimeZone(identifier: timeZone) != nil, supported.contains(asOf.secondsSince1970),
              intervals.allSatisfy({ supported.contains($0.from.secondsSince1970) && supported.contains($0.until.secondsSince1970) }),
              restricted.count + unlocked.count + gaps.count <= 20_000,
              scope == .syntheticFixture || (restricted.isEmpty && unlocked.isEmpty && gaps.isEmpty),
              coverage != .recorded || recordedRange != nil,
              recordedRange != nil || (restricted.isEmpty && unlocked.isEmpty && gaps.isEmpty),
              (coverage != .deleted && coverage != .notRecorded) || recordedRange == nil else { throw ReflectionPrototypeError.invalidInput }
        self.sourceID = sourceID; self.revision = revision; self.asOf = asOf; self.timeZone = timeZone
        self.scope = scope; self.coverage = coverage; self.recordedRange = recordedRange
        self.restricted = restricted; self.unlocked = unlocked; self.gaps = gaps
    }
}

public struct ReflectionPrototypeBucket: Equatable, Encodable, Sendable {
    public let day: String
    public let from: Double
    public let until: Double
    public let knownSeconds: Double?
    public let coverage: ReflectionPrototypeCoverage
}

public struct ReflectionPrototypeSnapshot: Encodable, Sendable {
    public let version = 1
    public let metricVersion = "restricted-excluding-unlocks-prototype-v1"
    public let token: String
    public let proofScope: ReflectionPrototypeScope
    public let timeZone: String
    public let asOf: Double
    public let total: ReflectionPrototypeBucket
    public let trend: [ReflectionPrototypeBucket]
    public let period: ReflectionPrototypePeriod
    public let anchor: String
    public let previousAnchor: String?
    public let nextAnchor: String?
    public let selected: ReflectionPrototypeBucket
    public let buckets: [ReflectionPrototypeBucket]
}

/// The input intervals are synthetic, globally scoped, and already matched to target/occurrence.
/// A point observation cannot produce a positive value, even when two endpoints match.
public enum ReflectionPrototypeCalculator {
    public static func snapshot(_ input: ReflectionPrototypeDataset, period: ReflectionPrototypePeriod,
                                day: String, expectedToken: String? = nil,
                                clippedTo: ReflectionPrototypeInterval? = nil) throws -> ReflectionPrototypeSnapshot {
        let token = "prototype-v1:\(input.sourceID.uuidString):\(input.revision):\(input.asOf.secondsSince1970.bitPattern):\(input.timeZone)"
        if let expectedToken, expectedToken != token { throw ReflectionPrototypeError.changed }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX"); calendar.timeZone = TimeZone(identifier: input.timeZone)!
        calendar.firstWeekday = 2; calendar.minimumDaysInFirstWeek = 4
        let date = try parseDay(day, calendar)
        let component: Calendar.Component = period == .week ? .weekOfYear : .month
        guard let bounds = calendar.dateInterval(of: component, for: date),
              let previous = calendar.date(byAdding: component, value: -1, to: bounds.start),
              let next = calendar.date(byAdding: component, value: 1, to: bounds.start) else { throw ReflectionPrototypeError.invalidInput }
        let requested = try interval(bounds.start, bounds.end)
        let selectedRange: ReflectionPrototypeInterval
        if let clippedTo {
            guard let clipped = intersection(requested, clippedTo) else { throw ReflectionPrototypeError.invalidInput }
            selectedRange = clipped
        } else { selectedRange = requested }
        let effective = input.recordedRange.flatMap { clipAtAsOf($0, input.asOf) }
        let restricted = effective.map { range in union(input.restricted.compactMap { intersection($0, range) }) } ?? []
        let excluded = union(input.unlocked + input.gaps)
        let known = subtract(restricted, excluded)
        func bucket(_ range: ReflectionPrototypeInterval, label: String? = nil) -> ReflectionPrototypeBucket {
            let overlap = effective.flatMap { intersection(range, $0) }
            let coverage: ReflectionPrototypeCoverage
            if input.coverage == .deleted { coverage = .deleted }
            else if input.scope == .pointObservations && input.coverage == .partial { coverage = .partial }
            else if overlap == nil { coverage = .notRecorded }
            else if input.scope == .pointObservations || input.coverage == .partial || overlap != range || input.gaps.contains(where: { intersection($0, range) != nil }) { coverage = .partial }
            else { coverage = .recorded }
            let seconds: Double? = input.scope == .syntheticFixture && overlap != nil && input.coverage != .deleted
                ? known.compactMap { intersection($0, range) }.reduce(0) { $0 + $1.until.secondsSince1970 - $1.from.secondsSince1970 } : nil
            return ReflectionPrototypeBucket(day: label ?? formatDay(range.from.date, calendar),
                from: range.from.secondsSince1970, until: range.until.secondsSince1970, knownSeconds: seconds, coverage: coverage)
        }
        let total = effective.map { bucket($0) } ?? ReflectionPrototypeBucket(day: "", from: input.asOf.secondsSince1970,
            until: input.asOf.secondsSince1970, knownSeconds: nil, coverage: input.coverage == .recorded ? .notRecorded : input.coverage)
        var buckets: [ReflectionPrototypeBucket] = []
        var cursor = bounds.start
        while cursor < bounds.end {
            let bucketComponent: Calendar.Component = period == .week ? .day : .weekOfYear
            let end: Date
            if period == .week { end = calendar.date(byAdding: .day, value: 1, to: cursor)! }
            else { end = calendar.dateInterval(of: bucketComponent, for: cursor)!.end }
            let raw = try interval(cursor, min(end, bounds.end))
            if let clipped = intersection(raw, selectedRange) { buckets.append(bucket(clipped)) }
            cursor = end
        }
        var trend: [ReflectionPrototypeBucket] = []
        if let effective {
            let length = effective.until.secondsSince1970 - effective.from.secondsSince1970
            let count = min(64, max(1, Int(ceil(min(length / 86_400, 64)))))
            for n in 0..<count {
                let from = effective.from.secondsSince1970 + length * Double(n) / Double(count)
                let until = n == count - 1 ? effective.until.secondsSince1970 : effective.from.secondsSince1970 + length * Double(n + 1) / Double(count)
                trend.append(bucket(try .init(from: Instant(secondsSince1970: from), until: Instant(secondsSince1970: until))))
            }
        }
        return ReflectionPrototypeSnapshot(token: token, proofScope: input.scope, timeZone: input.timeZone,
            asOf: input.asOf.secondsSince1970, total: total, trend: trend, period: period,
            anchor: formatDay(bounds.start, calendar), previousAnchor: validAnchor(previous, calendar),
            nextAnchor: validAnchor(next, calendar), selected: bucket(selectedRange), buckets: buckets)
    }

    static func parseDay(_ day: String, _ calendar: Calendar) throws -> Date {
        let parts = day.split(separator: "-", omittingEmptySubsequences: false)
        guard day.utf8.count == 10, parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              parts.allSatisfy({ $0.utf8.allSatisfy { (48...57).contains($0) } }),
              let y = Int(parts[0]), (1900...9998).contains(y), let m = Int(parts[1]), let d = Int(parts[2]),
              let date = calendar.date(from: DateComponents(year: y, month: m, day: d)),
              calendar.component(.year, from: date) == y, calendar.component(.month, from: date) == m,
              calendar.component(.day, from: date) == d else { throw ReflectionPrototypeError.invalidInput }
        return date
    }
    static func formatDay(_ date: Date, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
    static func validAnchor(_ date: Date, _ calendar: Calendar) -> String? {
        let day = formatDay(date, calendar)
        return (try? parseDay(day, calendar)) == nil ? nil : day
    }
    static func interval(_ from: Date, _ until: Date) throws -> ReflectionPrototypeInterval {
        try .init(from: Instant(secondsSince1970: from.timeIntervalSince1970), until: Instant(secondsSince1970: until.timeIntervalSince1970))
    }
    static func clipAtAsOf(_ range: ReflectionPrototypeInterval, _ asOf: Instant) -> ReflectionPrototypeInterval? {
        try? .init(from: range.from, until: min(range.until, asOf))
    }
    static func intersection(_ a: ReflectionPrototypeInterval, _ b: ReflectionPrototypeInterval) -> ReflectionPrototypeInterval? {
        try? .init(from: max(a.from, b.from), until: min(a.until, b.until))
    }
    static func union(_ ranges: [ReflectionPrototypeInterval]) -> [ReflectionPrototypeInterval] {
        var result: [ReflectionPrototypeInterval] = []
        for value in ranges.sorted(by: { $0.from < $1.from }) {
            if let last = result.last, value.from <= last.until {
                result[result.count - 1] = try! .init(from: last.from, until: max(last.until, value.until))
            } else { result.append(value) }
        }
        return result
    }
    static func subtract(_ input: [ReflectionPrototypeInterval], _ excluded: [ReflectionPrototypeInterval]) -> [ReflectionPrototypeInterval] {
        var result: [ReflectionPrototypeInterval] = [], index = 0
        for range in input {
            var start = range.from
            while index < excluded.count && excluded[index].until <= start { index += 1 }
            var n = index
            while n < excluded.count && excluded[n].from < range.until {
                if excluded[n].from > start { result.append(try! .init(from: start, until: min(range.until, excluded[n].from))) }
                start = max(start, excluded[n].until)
                if start >= range.until { break }
                n += 1
            }
            if start < range.until { result.append(try! .init(from: start, until: range.until)) }
        }
        return result
    }
}
