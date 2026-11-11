import Foundation
import Testing
import ItomaHistory
import ItomaSQLite

struct RuleDetailsRepositoryTests {
    @Test func aFailedSaveRollsBackCleanupAndRevisionTogether() throws {
        let url = try path(), first = UUID(), second = UUID()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url), text = try RuleDetails(title: "合成名", goal: "")
        try store.save(ruleID: first, details: text, expectedRevision: 0, activeRuleIDs: [first])
        let raw = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        try raw.execute("CREATE TRIGGER fail_save BEFORE INSERT ON rule_details BEGIN SELECT RAISE(ABORT,'fixture'); END")
        #expect(throws: SQLiteFailure.self) { try store.save(ruleID: second, details: text, expectedRevision: 1, activeRuleIDs: [second]) }
        #expect(try store.read().rules[first] == text); #expect(try store.read().revision == 1)
        try raw.close(); try store.close()
    }
    func path() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("details.sqlite")
    }
    @Test func roundTripPreservesPersonalTextAndClearIsDurable() throws {
        let url = try path(), id = UUID()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url)
        let goal = "  合成の目標\n自分で決めた時間を過ごす 🌙  "
        try store.save(ruleID: id, details: RuleDetails(title: " 夜の余白 ", goal: goal), expectedRevision: 0, activeRuleIDs: [id])
        try store.close()
        let reopened = try RuleDetailsRepository.open(at: url)
        let saved = try reopened.read()
        #expect(saved.revision == 1)
        #expect(saved.rules[id]?.title == "夜の余白")
        #expect(saved.rules[id]?.goal == goal)
        try reopened.save(ruleID: id, details: RuleDetails(title: " \n", goal: "\t\n"), expectedRevision: 1, activeRuleIDs: [id])
        try reopened.close()
        let cleared = try RuleDetailsRepository.open(at: url)
        #expect(try cleared.read().rules.isEmpty)
        #expect(try cleared.read().revision == 2)
        try cleared.close()
    }
    @Test func staleWriterCannotOverwriteOrRecreateDeletedRules() throws {
        let url = try path(), first = UUID(), second = UUID()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let a = try RuleDetailsRepository.create(at: url), b = try RuleDetailsRepository.open(at: url)
        let text = try RuleDetails(title: "合成名", goal: "合成目標")
        try a.save(ruleID: first, details: text, expectedRevision: 0, activeRuleIDs: [first, second])
        #expect(throws: RuleDetailsError.self) { try b.save(ruleID: first, details: text, expectedRevision: 0, activeRuleIDs: [first, second]) }
        #expect(throws: RuleDetailsError.self) { try b.save(ruleID: first, details: text, expectedRevision: 1, activeRuleIDs: [second]) }
        #expect(try b.read().rules[first] == text)
        try b.prune(activeRuleIDs: [second])
        #expect(try a.read().rules[first] == nil)
        #expect(try a.read().revision == 2)
        try a.close(); try b.close()
    }
    @Test func invalidTextAndCorruptOrFutureDatabaseAreNotReset() throws {
        #expect(throws: RuleDetailsError.self) { try RuleDetails(title: String(repeating: "あ", count: 81), goal: "") }
        #expect(throws: RuleDetailsError.self) { try RuleDetails(title: "", goal: String(repeating: "🌙", count: 501)) }
        #expect(throws: RuleDetailsError.self) { try RuleDetails(title: "bad\0name", goal: "") }
        let url = try path()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url); try store.close()
        let raw = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        try raw.execute("PRAGMA user_version=99"); try raw.close()
        #expect(throws: RuleDetailsError.self) { _ = try RuleDetailsRepository.open(at: url) }
        let unchanged = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        #expect(try unchanged.rows("PRAGMA user_version") == [[.integer(99)]])
        try unchanged.close()
    }
    @Test func manyEditsReplaceOneRowAndUnchangedPruningDoesNotAdvanceRevision() throws {
        let url = try path(), id = UUID()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url)
        for n in 0..<100 {
            try store.save(ruleID: id, details: RuleDetails(title: "合成 \(n)", goal: ""), expectedRevision: UInt64(n), activeRuleIDs: [id])
            try store.prune(activeRuleIDs: [id])
        }
        let saved = try store.read()
        #expect(saved.revision == 100); #expect(saved.rules.count == 1); #expect(saved.rules[id]?.title == "合成 99")
        try store.close()
    }
}
