import Foundation

/// ISO weekday numbering, not Foundation Calendar's Sunday-first weekday values.
public enum Weekday: Int, CaseIterable, Codable, Sendable {
    case monday = 1, tuesday, wednesday, thursday, friday, saturday, sunday
}

public enum EndDayOffset: Int, Codable, Sendable { case sameDay = 0, nextDay = 1 }

public struct WeeklySchedule: Equatable, Codable, Sendable {
    public let weekdays: Set<Weekday>
    public let startMinute: Int
    public let endMinute: Int
    public let endDayOffset: EndDayOffset

    public init(
        weekdays: Set<Weekday>, startMinute: Int, endMinute: Int, endDayOffset: EndDayOffset
    ) throws {
        guard !weekdays.isEmpty else { throw ModelError.emptyWeekdays }
        guard (0..<1440).contains(startMinute), (0..<1440).contains(endMinute) else {
            throw ModelError.invalidMinute
        }
        let duration = endMinute + 1440 * endDayOffset.rawValue - startMinute
        guard (1...1440).contains(duration) else { throw ModelError.invalidScheduleInterval }
        self.weekdays = weekdays
        self.startMinute = startMinute
        self.endMinute = endMinute
        self.endDayOffset = endDayOffset
    }

    private enum CodingKeys: String, CodingKey { case weekdays, startMinute, endMinute, endDayOffset }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            weekdays: c.decode(Set<Weekday>.self, forKey: .weekdays),
            startMinute: c.decode(Int.self, forKey: .startMinute),
            endMinute: c.decode(Int.self, forKey: .endMinute),
            endDayOffset: c.decode(EndDayOffset.self, forKey: .endDayOffset)
        )
    }
}

public struct UnlockDuration: Hashable, Codable, Sendable {
    public let minutes: Int
    public static let defaultDuration = Self(validatedMinutes: 5)

    private init(validatedMinutes: Int) { minutes = validatedMinutes }

    public init(minutes: Int) throws {
        guard (1...30).contains(minutes) else { throw ModelError.invalidUnlockDuration }
        self.minutes = minutes
    }

    public init(from decoder: any Decoder) throws {
        try self.init(minutes: decoder.singleValueContainer().decode(Int.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(minutes)
    }
}

public enum UnlockMode: String, Codable, Sendable {
    case reason, dummyPayment, unavailable
}

public struct Rule: Equatable, Codable, Sendable {
    public let id: RuleID
    public let version: RuleVersion
    public let enabled: Bool
    public let selectionRef: SelectionRef
    public let schedule: WeeklySchedule
    public let unlockMode: UnlockMode

    public init(
        id: RuleID, version: RuleVersion, enabled: Bool, selectionRef: SelectionRef,
        schedule: WeeklySchedule, unlockMode: UnlockMode
    ) {
        self.id = id
        self.version = version
        self.enabled = enabled
        self.selectionRef = selectionRef
        self.schedule = schedule
        self.unlockMode = unlockMode
    }
}

/// Platform adapters normalize native tokens to these references; names are never identifiers.
public struct Selection: Equatable, Sendable {
    public let ref: SelectionRef
    public let targets: Set<TargetRef>

    public init(ref: SelectionRef, targets: Set<TargetRef>) {
        self.ref = ref
        self.targets = targets
    }
}

/// Active policy only. Persist pending edits separately as PolicyCandidate.
public struct PolicySnapshot: Equatable, Codable, Sendable {
    public let schemaVersion: Int
    public let revision: PolicyRevision
    public let rules: [Rule]
    public let priorityOrder: [RuleID]
    public let defaultUnlockDuration: UnlockDuration

    public init(
        schemaVersion: Int = 1, revision: PolicyRevision, rules: [Rule], priorityOrder: [RuleID],
        defaultUnlockDuration: UnlockDuration = .defaultDuration
    ) throws {
        guard schemaVersion == 1 else { throw ModelError.unsupportedSchemaVersion }
        let ruleIDs = Set(rules.map(\.id))
        guard ruleIDs.count == rules.count else { throw ModelError.duplicateRuleID }
        guard Set(priorityOrder).count == priorityOrder.count, Set(priorityOrder) == ruleIDs else {
            throw ModelError.invalidPriorityOrder
        }
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.rules = rules
        self.priorityOrder = priorityOrder
        self.defaultUnlockDuration = defaultUnlockDuration
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, revision, rules, priorityOrder, defaultUnlockDuration
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            schemaVersion: c.decode(Int.self, forKey: .schemaVersion),
            revision: c.decode(PolicyRevision.self, forKey: .revision),
            rules: c.decode([Rule].self, forKey: .rules),
            priorityOrder: c.decode([RuleID].self, forKey: .priorityOrder),
            defaultUnlockDuration: c.decode(UnlockDuration.self, forKey: .defaultUnlockDuration)
        )
    }
}

/// Reserving base+1 does not activate the proposed policy or advance the active revision.
public struct PolicyCandidate: Equatable, Sendable {
    public let commandID: CommandID
    public let expectedRevision: PolicyRevision
    public let proposedPolicy: PolicySnapshot

    public init(commandID: CommandID, expectedRevision: PolicyRevision, proposedPolicy: PolicySnapshot) throws {
        guard proposedPolicy.revision == (try expectedRevision.next()) else {
            throw ModelError.invalidCandidateRevision
        }
        self.commandID = commandID
        self.expectedRevision = expectedRevision
        self.proposedPolicy = proposedPolicy
    }
}
