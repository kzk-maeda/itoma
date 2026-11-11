import Foundation
import ItomaCore
import ItomaSQLite

public enum OnboardingStep: String, Codable, Sendable { case purpose, schedule, apps, review }

/// A reference to ONE durable control command. Personal text never enters that command.
public struct OnboardingBinding: Codable, Equatable, Sendable {
    public let commandID: UUID
    public let policyRevision: UInt64
    public var submitted: Bool
    public init(commandID: UUID, policyRevision: UInt64, submitted: Bool = false) {
        self.commandID = commandID; self.policyRevision = policyRevision; self.submitted = submitted
    }
}
public struct OnboardingDraft: Codable, Equatable, Sendable {
    public let id: UUID
    public var step: OnboardingStep
    public var title: String
    public var goal: String
    public var weekdays: [Int]
    public var start: String
    public var end: String
    public var nextDay: Bool
    public var selectionRef: UUID?
    public var binding: OnboardingBinding?
    public init(id: UUID = UUID()) {
        self.id = id; step = .purpose; title = ""; goal = ""; weekdays = []
        start = ""; end = ""; nextDay = false
    }
    public func validate() throws {
        _ = try RuleDetails(title: title, goal: goal)
        guard start.utf16.count <= 16, end.utf16.count <= 16, !start.utf8.contains(0), !end.utf8.contains(0),
              Set(weekdays).count == weekdays.count, weekdays.allSatisfy({ (1...7).contains($0) }) else { throw RuleDetailsError.invalidInput }
        if binding != nil { _ = try schedule(); guard selectionRef != nil else { throw RuleDetailsError.invalidInput } }
    }
    /// The same domain validation as ordinary rules, including the 1...1440 minute range.
    public func schedule() throws -> WeeklySchedule {
        func minute(_ value: String) throws -> Int {
            let parts = value.split(separator: ":", omittingEmptySubsequences: false)
            guard value.utf8.count == 5, parts.count == 2, parts.allSatisfy({ $0.utf8.count == 2 && $0.utf8.allSatisfy({ (48...57).contains($0) }) }),
                  let h = Int(parts[0]), let m = Int(parts[1]), (0...23).contains(h), (0...59).contains(m) else { throw RuleDetailsError.invalidInput }
            return h * 60 + m
        }
        return try WeeklySchedule(weekdays: Set(weekdays.compactMap(Weekday.init(rawValue:))),
            startMinute: minute(start), endMinute: minute(end), endDayOffset: nextDay ? .nextDay : .sameDay)
    }
}
public struct OnboardingProgress: Codable, Equatable, Sendable {
    public var seenIntro = false
    public var completed = false
    public var draft: OnboardingDraft?
    public init() {}
    public func validate() throws {
        guard !(completed && draft != nil), seenIntro || (!completed && draft == nil) else { throw RuleDetailsError.invalidInput }
        try draft?.validate()
    }
}
public struct OnboardingSnapshot: Sendable {
    public let revision: UInt64
    public let progress: OnboardingProgress
    public init(revision: UInt64 = 0, progress: OnboardingProgress = OnboardingProgress()) {
        self.revision = revision; self.progress = progress
    }
}

extension RuleDetailsRepository {
    /// Optional auxiliary schema: existing schema-1 rule-details readers remain compatible.
    /// Reads of old stores do not create/reset tables. No App Group or history dependency.
    public func readOnboarding() throws -> OnboardingSnapshot {
        lock.lock(); defer { lock.unlock() }
        return try database.transaction(writer: false) { try loadOnboarding() }
    }
    public func saveOnboarding(_ progress: OnboardingProgress, expectedRevision: UInt64) throws -> OnboardingSnapshot {
        try progress.validate()
        lock.lock(); defer { lock.unlock() }
        return try database.transaction(writer: true) {
            let before = try loadOnboarding()
            guard before.revision == expectedRevision, before.revision < UInt64.max else { throw RuleDetailsError.changed }
            try installOnboardingIfMissing()
            return try writeOnboarding(progress, revision: before.revision + 1)
        }
    }
    /// Control has already committed the bound rule. Finish only private bookkeeping atomically.
    /// Never overwrite a later explicit edit to that rule's name/goal.
    public func finishOnboarding(expectedRevision: UInt64, activeRuleIDs: Set<UUID>) throws -> OnboardingSnapshot {
        lock.lock(); defer { lock.unlock() }
        return try database.transaction(writer: true) {
            let before = try loadOnboarding()
            guard before.revision == expectedRevision, before.revision < UInt64.max,
                  let draft = before.progress.draft, draft.binding?.submitted == true,
                  activeRuleIDs.contains(draft.id) else { throw RuleDetailsError.changed }
            let details = try RuleDetails(title: draft.title, goal: draft.goal), current = try load()
            if current.rules[draft.id] == nil, !details.title.isEmpty || !details.goal.isEmpty {
                guard current.revision < UInt64.max else { throw RuleDetailsError.changed }
                try database.execute("INSERT INTO rule_details VALUES (?,?,?)", [.text(draft.id.uuidString), .text(details.title), .text(details.goal)])
                try database.execute("UPDATE metadata SET revision=? WHERE id=1", [.text(String(current.revision + 1))])
            }
            var done = OnboardingProgress(); done.seenIntro = true; done.completed = true
            return try writeOnboarding(done, revision: before.revision + 1)
        }
    }
    private func onboardingTablesExist() throws -> Bool {
        let tables = try database.rows("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('onboarding_version','onboarding_progress')")
        guard tables.count == 0 || tables.count == 2 else { throw RuleDetailsError.corrupt }
        return tables.count == 2
    }
    private func installOnboardingIfMissing() throws {
        guard try !onboardingTablesExist() else { return }
        try database.execute("CREATE TABLE onboarding_version (version INTEGER PRIMARY KEY NOT NULL)")
        try database.execute("INSERT INTO onboarding_version VALUES (1)")
        try database.execute("CREATE TABLE onboarding_progress (id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, payload TEXT NOT NULL)")
    }
    private func loadOnboarding() throws -> OnboardingSnapshot {
        guard try onboardingTablesExist() else { return OnboardingSnapshot() }
        guard try database.rows("SELECT version FROM onboarding_version") == [[.integer(1)]] else { throw RuleDetailsError.corrupt }
        let rows = try database.rows("SELECT revision,payload FROM onboarding_progress WHERE id=1")
        guard rows.count == 1, rows[0].count == 2, case let .text(counter) = rows[0][0],
              let revision = UInt64(counter), String(revision) == counter, case let .text(json) = rows[0][1], json.utf8.count <= 16_384 else { throw RuleDetailsError.corrupt }
        do {
            let progress = try JSONDecoder().decode(OnboardingProgress.self, from: Data(json.utf8))
            try progress.validate()
            return OnboardingSnapshot(revision: revision, progress: progress)
        } catch { throw RuleDetailsError.corrupt }
    }
    private func writeOnboarding(_ progress: OnboardingProgress, revision: UInt64) throws -> OnboardingSnapshot {
        let json = String(decoding: try JSONEncoder().encode(progress), as: UTF8.self)
        guard json.utf8.count <= 16_384 else { throw RuleDetailsError.invalidInput }
        try database.execute("INSERT INTO onboarding_progress VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
            [.text(String(revision)), .text(json)])
        return OnboardingSnapshot(revision: revision, progress: progress)
    }
}
