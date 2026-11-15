import Foundation

/// A native operation record. This scope does not assert continuous OS-wide enforcement.
/// Wall time is paired with uptime so reboot/clock discontinuities cannot create duration.
public struct RestrictionTimelineSample: Codable, Equatable, Sendable {
    public enum State: String, Codable, Sendable { case restricted, excluded, unknown }
    public enum Boundary: String, Codable, Sendable { case controlledTransition, checkpoint }
    public let at: Instant
    public let uptime: Double
    public let timeZone: String
    public let state: State
    public let boundary: Boundary
    public let validUntil: Instant?

    public init(at: Instant, uptime: Double, timeZone: String, state: State,
                boundary: Boundary, validUntil: Instant? = nil) throws {
        guard uptime.isFinite, uptime >= 0, timeZone.utf8.count <= 128,
              TimeZone(identifier: timeZone) != nil,
              state != .restricted || validUntil.map({ $0 > at }) == true else {
            throw ReflectionPrototypeError.invalidInput
        }
        self.at = at; self.uptime = uptime; self.timeZone = timeZone
        self.state = state; self.boundary = boundary; self.validUntil = validUntil
    }
    public func validate() throws {
        _ = try Self(at: at, uptime: uptime, timeZone: timeZone, state: state,
                     boundary: boundary, validUntil: validUntil)
    }
}

/// Streaming projection of ordered, durable native records. Legacy point facts never start it.
/// A missing sequence, failed checkpoint, restart, clock/zone change leaves an explicit gap.
public struct RestrictionTimelineBuilder: Sendable {
    private var previous: (source: UUID, sequence: Int64, sample: RestrictionTimelineSample)?
    private var first: Instant?
    private var last: Instant?
    private var observed: [ReflectionPrototypeInterval] = []
    private var restricted: [ReflectionPrototypeInterval] = []
    private var excluded: [ReflectionPrototypeInterval] = []
    public init() {}

    public mutating func append(source: UUID, sequence: Int64, sample: RestrictionTimelineSample?, asOf: Instant) throws {
        guard sequence > 0 else { throw ReflectionPrototypeError.invalidInput }
        guard let sample, sample.at <= asOf else { previous = nil; return }
        try sample.validate()
        first = min(first ?? sample.at, sample.at); last = max(last ?? sample.at, sample.at)
        if let p = previous, p.source == source, p.sequence < Int64.max, sequence == p.sequence + 1,
           sample.at > p.sample.at, sample.uptime >= p.sample.uptime,
           sample.timeZone == p.sample.timeZone,
           abs((sample.at.secondsSince1970 - p.sample.at.secondsSince1970) - (sample.uptime - p.sample.uptime)) <= 2,
           p.sample.state != .unknown,
           sample.state != .unknown || sample.boundary == .controlledTransition {
            let end = p.sample.state == .restricted ? min(sample.at, p.sample.validUntil!) : sample.at
            if p.sample.at < end {
                let interval = try ReflectionPrototypeInterval(from: p.sample.at, until: end)
                Self.merge(interval, into: &observed)
                if p.sample.state == .restricted { Self.merge(interval, into: &restricted) }
                if p.sample.state == .excluded { Self.merge(interval, into: &excluded) }
            }
        }
        previous = (source, sequence, sample)
        guard observed.count + restricted.count + excluded.count <= 20_000 else { throw ReflectionPrototypeError.invalidInput }
    }

    public func dataset(sourceID: UUID, revision: Int64, asOf: Instant, timeZone: String) throws -> ReflectionPrototypeDataset? {
        guard let first, let last, first < last, !observed.isEmpty else { return nil }
        let range = try ReflectionPrototypeInterval(from: first, until: min(last, asOf))
        let known = ReflectionPrototypeCalculator.union(observed)
        return try ReflectionPrototypeDataset(sourceID: sourceID, revision: revision, asOf: asOf, timeZone: timeZone,
            scope: .nativeRecordedIntervals, coverage: .recorded, recordedRange: range,
            restricted: ReflectionPrototypeCalculator.union(restricted),
            unlocked: ReflectionPrototypeCalculator.union(excluded),
            gaps: ReflectionPrototypeCalculator.subtract([range], known))
    }
    private static func merge(_ interval: ReflectionPrototypeInterval, into values: inout [ReflectionPrototypeInterval]) {
        if let last = values.last, interval.from >= last.from, interval.from <= last.until {
            values[values.count - 1] = try! .init(from: last.from, until: max(last.until, interval.until))
        } else { values.append(interval) }
    }
}
