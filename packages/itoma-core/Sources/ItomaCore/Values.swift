import Foundation

/// Structural input errors. Never include a reason body, application token, or raw OS error.
public enum ModelError: Error, Equatable, Sendable {
    case negativeCounter
    case counterOverflow
    case nonFiniteInstant
    case invalidTimeZone
    case invalidLocalDate
    case invalidMinute
    case emptyWeekdays
    case invalidScheduleInterval
    case invalidUnlockDuration
    case unsupportedSchemaVersion
    case duplicateRuleID
    case invalidPriorityOrder
    case invalidCandidateRevision
    case stalePolicyRevision
    case invalidRuleVersion
    case invalidGrantWindow
    case invalidCommandRevision
    case missingDeadlineReceipt
    case mismatchedDeadlineReceipt
    case missingFiredAt
    case inconsistentDeadlineState
    case missingEvaluationID
    case missingObservationEvidence
}

/// The phantom Kind keeps a command ID from being used as a rule ID, for example.
public struct EntityID<Kind>: Hashable, Codable, Sendable {
    public let rawValue: UUID

    public init(_ rawValue: UUID) { self.rawValue = rawValue }

    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(UUID.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum IDKind {
    public enum Rule {}
    public enum Selection {}
    public enum Target {}
    public enum Command {}
    public enum Grant {}
    public enum Registration {}
    public enum Evaluation {}
    public enum Reason {}
    public enum Event {}
    public enum HistorySource {}
}

public typealias RuleID = EntityID<IDKind.Rule>
public typealias SelectionRef = EntityID<IDKind.Selection>
public typealias TargetRef = EntityID<IDKind.Target>
public typealias CommandID = EntityID<IDKind.Command>
public typealias GrantID = EntityID<IDKind.Grant>
public typealias RegistrationID = EntityID<IDKind.Registration>
public typealias EvaluationID = EntityID<IDKind.Evaluation>
public typealias ReasonRef = EntityID<IDKind.Reason>
public typealias EventID = EntityID<IDKind.Event>
public typealias HistorySourceID = EntityID<IDKind.HistorySource>

/// Signed 64-bit nonnegative values fit SQLite integers. Zero is a valid baseline.
public struct Counter<Kind>: Hashable, Comparable, Codable, Sendable {
    public let rawValue: Int64

    public init(_ rawValue: Int64) throws {
        guard rawValue >= 0 else { throw ModelError.negativeCounter }
        self.rawValue = rawValue
    }

    public func next() throws -> Self {
        let (value, overflow) = rawValue.addingReportingOverflow(1)
        guard !overflow else { throw ModelError.counterOverflow }
        return try Self(value)
    }

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }

    public init(from decoder: any Decoder) throws {
        try self.init(decoder.singleValueContainer().decode(Int64.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum CounterKind {
    public enum Policy {}
    public enum Rule {}
    public enum Snapshot {}
    public enum Attempt {}
    public enum Generation {}
    public enum History {}
}

public typealias PolicyRevision = Counter<CounterKind.Policy>
public typealias RuleVersion = Counter<CounterKind.Rule>
public typealias SnapshotSequence = Counter<CounterKind.Snapshot>
public typealias AttemptNumber = Counter<CounterKind.Attempt>
public typealias RegistrationGeneration = Counter<CounterKind.Generation>
public typealias HistorySequence = Counter<CounterKind.History>

/// Absolute UTC time, encoded as finite seconds since 1970. Never a relative countdown.
public struct Instant: Hashable, Comparable, Codable, Sendable {
    public let secondsSince1970: Double
    public var date: Date { Date(timeIntervalSince1970: secondsSince1970) }

    public init(secondsSince1970: Double) throws {
        guard secondsSince1970.isFinite else { throw ModelError.nonFiniteInstant }
        self.secondsSince1970 = secondsSince1970
    }

    public init(_ date: Date) throws {
        try self.init(secondsSince1970: date.timeIntervalSince1970)
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.secondsSince1970 < rhs.secondsSince1970
    }

    public init(from decoder: any Decoder) throws {
        try self.init(secondsSince1970: decoder.singleValueContainer().decode(Double.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(secondsSince1970)
    }
}

public struct TimeZoneID: Hashable, Sendable {
    public let identifier: String
    public let timeZone: TimeZone

    public init(_ identifier: String) throws {
        guard let zone = TimeZone(identifier: identifier) else { throw ModelError.invalidTimeZone }
        self.identifier = identifier
        timeZone = zone
    }
}

/// Gregorian start day of an occurrence; DST resolution belongs to the evaluator.
public struct LocalDate: Hashable, Sendable {
    public let year: Int
    public let month: Int
    public let day: Int

    public init(year: Int, month: Int, day: Int) throws {
        guard (1...9999).contains(year), (1...12).contains(month) else {
            throw ModelError.invalidLocalDate
        }
        let leap = year.isMultiple(of: 400) || (year.isMultiple(of: 4) && !year.isMultiple(of: 100))
        let lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        guard (1...lengths[month - 1]).contains(day) else { throw ModelError.invalidLocalDate }
        self.year = year
        self.month = month
        self.day = day
    }
}
