import Foundation
import Testing
import ItomaCore
import ItomaHistory
import ItomaSQLite

struct OnboardingRepositoryTests {
    private func path() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("private.sqlite")
    }
    private func progress(bound: Bool = false) -> OnboardingProgress {
        var p = OnboardingProgress(); p.seenIntro = true
        var d = OnboardingDraft(); d.title = " 合成の時間 "; d.goal = "合成の目標\n自分の時間を過ごす 🌙"
        d.weekdays = [1, 7]; d.start = "23:30"; d.end = "00:01"; d.nextDay = true
        if bound { d.selectionRef = UUID(); d.binding = OnboardingBinding(commandID: UUID(), policyRevision: 42, submitted: true); d.step = .review }
        p.draft = d; return p
    }
    @Test func oldSchemaStaysReadableAndDraftSurvivesReopeningWithoutPolicyStorage() throws {
        let url = try path(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url)
        #expect(try store.readOnboarding().revision == 0)
        let p = progress(), saved = try store.saveOnboarding(p, expectedRevision: 0)
        #expect(saved.revision == 1); #expect(try store.read().revision == 0)
        try store.close()
        let reopened = try RuleDetailsRepository.open(at: url)
        #expect(try reopened.readOnboarding().progress == p)
        let raw = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        #expect(try raw.rows("PRAGMA user_version") == [[.integer(1)]])
        try raw.close(); try reopened.close()
    }
    @Test func staleWriterCannotRestoreDiscardedDraftAndRowsAreBounded() throws {
        let url = try path(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let a = try RuleDetailsRepository.create(at: url), b = try RuleDetailsRepository.open(at: url)
        let p = progress(); _ = try a.saveOnboarding(p, expectedRevision: 0)
        var discarded = OnboardingProgress(); discarded.seenIntro = true
        _ = try b.saveOnboarding(discarded, expectedRevision: 1)
        #expect(throws: RuleDetailsError.self) { _ = try a.saveOnboarding(p, expectedRevision: 1) }
        for n in 2..<52 { _ = try b.saveOnboarding(p, expectedRevision: UInt64(n)) }
        let raw = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        #expect(try raw.rows("SELECT COUNT(*) FROM onboarding_progress") == [[.integer(1)]])
        try raw.close(); try a.close(); try b.close()
    }
    @Test func finishingCopiesPurposeAndClearsDraftTogetherWithoutTouchingOtherRules() throws {
        let url = try path(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url), p = progress(bound: true), other = UUID()
        try store.save(ruleID: other, details: RuleDetails(title: "別の合成名", goal: ""), expectedRevision: 0, activeRuleIDs: [other])
        _ = try store.saveOnboarding(p, expectedRevision: 0)
        #expect(throws: RuleDetailsError.self) { _ = try store.finishOnboarding(expectedRevision: 1, activeRuleIDs: [other]) }
        let done = try store.finishOnboarding(expectedRevision: 1, activeRuleIDs: [p.draft!.id, other])
        #expect(done.progress.completed); #expect(done.progress.draft == nil)
        #expect(try store.read().rules[p.draft!.id]?.title == "合成の時間")
        #expect(try store.read().rules[p.draft!.id]?.goal == p.draft!.goal)
        #expect(try store.read().rules[other]?.title == "別の合成名")
        try store.close()
        let reopened = try RuleDetailsRepository.open(at: url)
        #expect(try reopened.readOnboarding().progress.completed); #expect(try reopened.read().rules.count == 2)
        try reopened.close()
    }
    @Test func failedPrivateCompletionRollsBackAndRetryDoesNotOverwriteLaterExplicitText() throws {
        let url = try path(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url), p = progress(bound: true), id = p.draft!.id
        _ = try store.saveOnboarding(p, expectedRevision: 0)
        let raw = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        try raw.execute("CREATE TRIGGER fail_finish BEFORE UPDATE ON onboarding_progress BEGIN SELECT RAISE(ABORT,'fixture'); END")
        #expect(throws: SQLiteFailure.self) { _ = try store.finishOnboarding(expectedRevision: 1, activeRuleIDs: [id]) }
        #expect(try store.read().rules.isEmpty); #expect(try store.read().revision == 0)
        #expect(try store.readOnboarding().progress.draft == p.draft)
        try raw.execute("DROP TRIGGER fail_finish")
        try store.save(ruleID: id, details: RuleDetails(title: "後から本人が編集", goal: "別の合成目標"), expectedRevision: 0, activeRuleIDs: [id])
        _ = try store.finishOnboarding(expectedRevision: 1, activeRuleIDs: [id])
        #expect(try store.read().rules[id]?.title == "後から本人が編集"); #expect(try store.read().revision == 1)
        try raw.close(); try store.close()
    }
    @Test func optionalPurposeAndDomainScheduleDoNotAdoptDemoLimits() throws {
        var p = progress(); p.draft!.title = ""; p.draft!.goal = ""; p.draft!.start = "23:59"; p.draft!.end = "00:00"
        try p.validate(); _ = try p.draft!.schedule() // One minute across midnight is valid.
        p.draft!.end = "23:59"; _ = try p.draft!.schedule() // Exactly 24 hours.
        p.draft!.nextDay = false
        #expect(throws: (any Error).self) { _ = try p.draft!.schedule() }
        p.draft!.start = "bad"; try p.validate() // A partial form is a valid durable draft.
        p.draft!.binding = OnboardingBinding(commandID: UUID(), policyRevision: 0)
        #expect(throws: (any Error).self) { try p.validate() }
        p = progress(); p.draft!.goal = String(repeating: "🌙", count: 501)
        #expect(throws: RuleDetailsError.self) { try p.validate() }
    }
    @Test func completionRecoveryDoesNotResurrectPurposeAfterAnExplicitClear() throws {
        let url = try path(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url), p = progress(bound: true), id = p.draft!.id
        _ = try store.saveOnboarding(p, expectedRevision: 0)
        try store.save(ruleID: id, details: RuleDetails(title: "", goal: ""), expectedRevision: 0, activeRuleIDs: [id])
        _ = try store.finishOnboarding(expectedRevision: 1, activeRuleIDs: [id])
        #expect(try store.read().rules.isEmpty); #expect(try store.read().revision == 1)
        try store.close()
        let reopened = try RuleDetailsRepository.open(at: url)
        #expect(try reopened.readOnboarding().progress.completed); #expect(try reopened.read().rules.isEmpty)
        try reopened.prune(activeRuleIDs: [])
        let raw = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        #expect(try raw.rows("SELECT COUNT(*) FROM rule_details") == [[.integer(0)]])
        try raw.close(); try reopened.close()
    }
    @Test func corruptOrFutureAuxiliarySchemaIsNotResetAndExistingDetailsStayReadable() throws {
        let url = try path(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = try RuleDetailsRepository.create(at: url)
        _ = try store.saveOnboarding(progress(), expectedRevision: 0)
        let raw = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        try raw.execute("UPDATE onboarding_version SET version=99")
        #expect(throws: RuleDetailsError.self) { _ = try store.readOnboarding() }
        #expect(throws: RuleDetailsError.self) { _ = try store.saveOnboarding(OnboardingProgress(), expectedRevision: 1) }
        #expect(try store.read().revision == 0)
        #expect(try raw.rows("SELECT version FROM onboarding_version") == [[.integer(99)]])
        try raw.close(); try store.close()
    }
}
