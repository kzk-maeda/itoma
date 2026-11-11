import Foundation
import ItomaHistory
import ItomaScreenTime

struct ProductRuleDetailsInput: Decodable, Sendable {
    let ruleID: String
    let title: String
    let goal: String
    let expectedRevision: String
    let expectedPolicyRevision: String
}

/// Separate host-private config: not included in history deletion, App Groups or Extension.
enum ProductRuleDetailsStore {
    private static func url() throws -> URL {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { throw RuleDetailsError.unavailable }
        return base.appendingPathComponent("ITOMA-Private", isDirectory: true).appendingPathComponent("rule-details.sqlite")
    }
    private static func open(create: Bool) throws -> (RuleDetailsRepository, URL)? {
        let url = try Self.url()
        if !FileManager.default.fileExists(atPath: url.path), !create { return nil }
        try ScreenTimeFiles.prepareDirectory(url.deletingLastPathComponent(), protection: .complete)
        let store: RuleDetailsRepository
        if FileManager.default.fileExists(atPath: url.path) { store = try RuleDetailsRepository.open(at: url) }
        else { store = try RuleDetailsRepository.create(at: url) }
        do { try ScreenTimeFiles.protectDatabase(url, protection: .complete) }
        catch { try? store.close(); throw error }
        return (store, url)
    }
    static func read(activeRuleIDs: Set<UUID>) throws -> RuleDetailsSnapshot {
        guard let (store, url) = try open(create: false) else { return RuleDetailsSnapshot() }
        defer { try? store.close() }
        try store.prune(activeRuleIDs: activeRuleIDs)
        try ScreenTimeFiles.protectDatabase(url, protection: .complete)
        return try store.read()
    }
    static func save(_ input: ProductRuleDetailsInput, activeRuleIDs: Set<UUID>) throws {
        guard let ruleID = UUID(uuidString: input.ruleID), let revision = UInt64(input.expectedRevision),
              String(revision) == input.expectedRevision else { throw RuleDetailsError.invalidInput }
        let details = try RuleDetails(title: input.title, goal: input.goal)
        do {
            guard let (store, url) = try open(create: true) else { throw RuleDetailsError.unavailable }
            defer { try? store.close() }
            try store.save(ruleID: ruleID, details: details, expectedRevision: revision, activeRuleIDs: activeRuleIDs)
            try ScreenTimeFiles.protectDatabase(url, protection: .complete)
        } catch let error as RuleDetailsError { throw error }
        catch { throw RuleDetailsError.unavailable }
    }
    static func readOnboarding() throws -> OnboardingSnapshot {
        try withOnboardingStore(create: false) { try $0.readOnboarding() } ?? OnboardingSnapshot()
    }
    static func saveOnboarding(_ progress: OnboardingProgress, expectedRevision: UInt64) throws -> OnboardingSnapshot {
        guard let saved = try withOnboardingStore(create: true, body: { try $0.saveOnboarding(progress, expectedRevision: expectedRevision) }) else { throw RuleDetailsError.unavailable }
        return saved
    }
    static func finishOnboarding(expectedRevision: UInt64, activeRuleIDs: Set<UUID>) throws -> OnboardingSnapshot {
        guard let saved = try withOnboardingStore(create: false, body: { try $0.finishOnboarding(expectedRevision: expectedRevision, activeRuleIDs: activeRuleIDs) }) else { throw RuleDetailsError.unavailable }
        return saved
    }
    private static func withOnboardingStore<T>(create: Bool, body: (RuleDetailsRepository) throws -> T) throws -> T? {
        do {
            guard let (store, url) = try open(create: create) else { return nil }
            defer { try? store.close() }
            let value = try body(store)
            try ScreenTimeFiles.protectDatabase(url, protection: .complete)
            return value
        } catch let error as RuleDetailsError { throw error }
        catch { throw RuleDetailsError.unavailable }
    }
}
