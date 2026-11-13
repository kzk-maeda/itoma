// Experiment scaffolding only. Host method bodies are inserted from the checked-out sources
// by run.py. Apple ports below are fakes; Control/Storage/History are the real Swift packages.
import Foundation
import Testing
import CSQLiteProbe
import ItomaCore
import ItomaStorage
import ItomaHistory
import ItomaControl

func entity<K>(_ value: Int) -> EntityID<K> { EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", value))!) }
@ItomaControlActor final class Clock: EvaluationContextProvider {
    var now = try! Instant(secondsSince1970: 43_200)
    func context(activation: Activation) -> EvaluationContext {
        EvaluationContext(now: now, timeZone: try! TimeZoneID("UTC"),
            authorization: AuthorizationObservation(status: .approved, observedAt: now), activation: activation)
    }
}
@ItomaControlActor final class IDs: ControlIdentifiers {
    var next = 1000
    func registrationID() -> RegistrationID { next += 1; return entity(next) }
    func evaluationID() -> EvaluationID { next += 1; return entity(next) }
    func eventID() -> EventID { next += 1; return entity(next) }
}
@ItomaControlActor final class Scheduler: DeadlineScheduler {
    let clock: Clock
    var requests: [DeadlineRegistration] = []
    init(_ clock: Clock) { self.clock = clock }
    func register(_ r: DeadlineRegistration) async -> DeadlineScheduleResult {
        requests.append(r)
        return .accepted(DeadlineReceipt(registrationID: r.id, generation: r.generation, scheduledFor: r.scheduledFor, acceptedAt: clock.now))
    }
    func cancel(_ r: DeadlineRegistration) async -> DeadlineCancellationResult { .accepted }
}
@ItomaControlActor final class Restriction: RestrictionAdapter {
    var calls = 0
    var lastTargets: Set<TargetRef> = []
    var result: RestrictionApplicationResult = .accepted(.writeAttempt)
    func apply(_ plan: Evaluation) -> RestrictionApplicationResult {
        calls += 1; lastTargets = plan.desiredTargets; return result
    }
}
@ItomaControlActor final class Monitors {
    var prepares = 0, cleanups = 0
    func prepare(_ policy: PolicySnapshot) throws -> Bool { prepares += 1; return true }
    func readyPlan(for policy: PolicySnapshot) throws -> Bool? { true }
    func cleanup(keeping: Bool) throws { cleanups += 1 }
}
actor ProductHistoryController {
    static let shared = ProductHistoryController()
    var imports = 0
    private var blockNext = false, entered = false
    private var entryWaiter: CheckedContinuation<Void, Never>?
    private var releaseWaiter: CheckedContinuation<Void, Never>?
    func holdNextImport() { blockNext = true; entered = false }
    func waitForBlockedImport() async {
        if entered { return }
        await withCheckedContinuation { entryWaiter = $0 }
    }
    func releaseImport() { releaseWaiter?.resume(); releaseWaiter = nil }
    func importForMaintenance() async throws {
        imports += 1
        guard blockNext else { return }
        entered = true; entryWaiter?.resume(); entryWaiter = nil
        await withCheckedContinuation { releaseWaiter = $0 }
        blockNext = false
    }
    func count() -> Int { imports }
}
@ItomaControlActor final class ScreenTimeRuntime {
    let directory: URL, repository: ControlRepository
    let contexts = Clock(), restriction = Restriction(), monitors = Monitors()
    let scheduler: Scheduler
    let service: CommandService
    var protections = 0
    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let rule = try Rule(id: entity(1), version: RuleVersion(0), enabled: true, selectionRef: entity(1),
            schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 540, endMinute: 1020, endDayOffset: .sameDay), unlockMode: .reason)
        repository = try ControlRepository.create(at: directory.appendingPathComponent("control.sqlite"),
            initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [rule], priorityOrder: [rule.id]),
            selections: [StoredSelection(selection: Selection(ref: entity(1), targets: [entity(1), entity(2)]), opaquePayload: Data([1]))], activation: .enabled)
        scheduler = Scheduler(contexts)
        service = try CommandService(repository: repository, scheduler: scheduler, restriction: restriction, contexts: contexts,
            historyCapacity: HistoryOutboxCapacity(maximumPendingEvents: 1000), identifiers: IDs())
        try repository.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 1000))
    }
    func makeService(stopping: Bool = false) throws -> CommandService { service }
    func protectFiles() throws { protections += 1 }
    func remove() { try? repository.close(); try? FileManager.default.removeItem(at: directory) }
}
@ItomaControlActor final class ExtractedHost {
// EXTRACT_CURRENT_REFRESH
}
// No file protection claim: this probe supplies a portable open/protection boundary.
enum ScreenTimeFiles {
    enum Protection { case complete }
    static func protectDatabase(_ url: URL, protection: Protection) throws {}
}
@ItomaControlActor enum ProductRuleDetailsStore {
    static var injected: (RuleDetailsRepository, URL)?
    static func open(create: Bool) throws -> (RuleDetailsRepository, URL)? { injected }
// EXTRACT_CURRENT_PRIVATE_READ
}
func sqlite(_ url: URL) throws -> OpaquePointer {
    var db: OpaquePointer?
    guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else { throw RuleDetailsError.unavailable }
    return db
}

@ItomaControlActor final class Completion { var done = false }

@Suite(.serialized) struct LifecycleReproduction {
@Test @ItomaControlActor func currentHostRefreshAmplifiesTenUnchangedPolls() async throws {
    let runtime = try ScreenTimeRuntime(); defer { runtime.remove() }
    _ = await runtime.service.reconcile() // Start with already valid evidence in the same context.
    let appliesBefore = runtime.restriction.calls
    let before = try runtime.repository.readSnapshot().snapshotSequence.rawValue
    let facts = try #require(try runtime.repository.reflectionBatch(limit: 100)).facts.count
    let imports = await ProductHistoryController.shared.count()
    let host = ExtractedHost()
    for _ in 0..<10 { try await host.refresh(runtime) }
    let sequenceDelta = try runtime.repository.readSnapshot().snapshotSequence.rawValue - before
    let factsDelta = try #require(try runtime.repository.reflectionBatch(limit: 100)).facts.count - facts
    #expect(sequenceDelta == 20)
    #expect(factsDelta == 20)
    let appliesDelta = runtime.restriction.calls - appliesBefore
    #expect(appliesDelta == 10)
    #expect(runtime.monitors.prepares == 10 && runtime.monitors.cleanups == 10)
    #expect(await ProductHistoryController.shared.count() - imports == 10)
    print("CURRENT host_refresh polls=10 apply=\(appliesDelta) sequence_delta=\(sequenceDelta) reflection_delta=\(factsDelta) monitor_prepare=10 monitor_cleanup=10 awaited_import=10")
}

@Test @ItomaControlActor func repositoryReadPrimitiveDoesNotRenewEvidenceOrWrite() async throws {
    let runtime = try ScreenTimeRuntime(); defer { runtime.remove() }
    _ = await runtime.service.reconcile()
    let initial = try runtime.repository.readSnapshot()
    let factCount = try #require(try runtime.repository.reflectionBatch(limit: 100)).facts.count
    runtime.contexts.now = try Instant(secondsSince1970: 43_210)
    for _ in 0..<10 {
        let current = try runtime.repository.readSnapshot()
        #expect(current.snapshotSequence == initial.snapshotSequence)
        #expect(current.application == initial.application)
    }
    #expect(runtime.restriction.calls == 1)
    #expect(try runtime.repository.reflectionBatch(limit: 100)?.facts.count == factCount)
    // A new explicit reconciliation with fake readback carries new evidence; display reads did not.
    runtime.restriction.result = .accepted(.ownStoreReadback)
    _ = await runtime.service.reconcile()
    let refreshed = try runtime.repository.readSnapshot()
    #expect(refreshed.application?.observation.observedAt == runtime.contexts.now)
    #expect(refreshed.application?.observation.evidence == .ownStoreReadback)
    let newUntil = try #require(refreshed.application?.observation.validUntil)
    let newBoundary = try #require(refreshed.application?.evaluation.nextBoundary)
    #expect(newUntil <= newBoundary)
    #expect(newUntil > runtime.contexts.now)
    print("CURRENT evidence_read stored_unchanged=true explicit_fake_readback observed_at=43210 valid_until=\(newUntil.secondsSince1970)")
}

@Test @ItomaControlActor func currentPrivateReadNeedsAWriterEvenWithNothingToPrune() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("details.sqlite"), ruleID = UUID()
    let store = try RuleDetailsRepository.create(at: url); defer { try? store.close(); ProductRuleDetailsStore.injected = nil }
    try store.save(ruleID: ruleID, details: RuleDetails(title: "", goal: "fixture"), expectedRevision: 0, activeRuleIDs: [ruleID])
    ProductRuleDetailsStore.injected = (store, url)
    let blocker = try sqlite(url); defer { sqlite3_exec(blocker, "ROLLBACK", nil, nil, nil); sqlite3_close(blocker) }
    #expect(sqlite3_exec(blocker, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK)
    #expect(try store.read().revision == 1) // WAL read works while another writer holds its lock.
    #expect(throws: (any Error).self) { try ProductRuleDetailsStore.read(activeRuleIDs: [ruleID]) }
    // The extracted host method owns/closes its connection even when prune fails.
    let reopened = try RuleDetailsRepository.open(at: url); defer { try? reopened.close() }
    #expect(try reopened.read().revision == 1)
    print("CURRENT private_read unchanged=true raw_read=success extracted_host_read=writer_busy revision=1")
}

@Test @ItomaControlActor func deadlineCallbackReblocksWithoutDisplayClock() async throws {
    let runtime = try ScreenTimeRuntime(); defer { runtime.remove() }
    let snapshot = try runtime.repository.readSnapshot(), context = runtime.contexts.context(activation: snapshot.activation)
    let evaluation = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection), context: context, grants: [])
    let command = try Command(id: entity(1), kind: .requestTemporaryGrant, status: .pending, expectedPolicyRevision: snapshot.policy.revision, attempt: AttemptNumber(0), reasonRef: entity(1))
    let request = GrantRequest(grantID: entity(1), commandID: command.id, targetRef: entity(1), expectedPolicyRevision: snapshot.policy.revision,
        expectedOccurrence: try #require(evaluation.rules.targets[entity(1)]?.winner?.key), condition: try UnlockCondition.reason("fixture"))
    let grant = try runtime.repository.write { try $0.acceptGrant(command: command, request: request, context: context, expectedSequence: snapshot.snapshotSequence) }.grant
    _ = try await runtime.service.executeAcceptedGrant(commandID: command.id)
    let registered = try #require(runtime.scheduler.requests.first)
    runtime.contexts.now = grant.effectiveExpiresAt
    let result = runtime.service.reconcileSynchronously(registrationID: registered.id, generation: registered.generation)
    #expect(result.disposition == .committed)
    #expect(runtime.restriction.lastTargets == [entity(1), entity(2)])
    #expect(try runtime.repository.grant(grant.id)?.hasEnded == true)
    #expect(try runtime.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
}

@Test func privateCompletionRequiresSubmissionAndDoesNotRestoreClearedText() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try RuleDetailsRepository.create(at: directory.appendingPathComponent("details.sqlite")); defer { try? store.close() }
    var progress = OnboardingProgress(); progress.seenIntro = true
    var draft = OnboardingDraft(); draft.title = "initial"; draft.goal = "initial goal"; draft.weekdays = [1]
    draft.start = "09:00"; draft.end = "10:00"; draft.selectionRef = UUID()
    let commandID = UUID(); draft.binding = OnboardingBinding(commandID: commandID, policyRevision: 0)
    progress.draft = draft
    let prepared = try store.saveOnboarding(progress, expectedRevision: 0)
    #expect(throws: RuleDetailsError.changed) { try store.finishOnboarding(expectedRevision: prepared.revision, activeRuleIDs: [draft.id]) }
    progress.draft?.binding?.submitted = true
    let submitted = try store.saveOnboarding(progress, expectedRevision: prepared.revision)
    try store.save(ruleID: draft.id, details: RuleDetails(title: "", goal: ""), expectedRevision: 0, activeRuleIDs: [draft.id])
    let finished = try store.finishOnboarding(expectedRevision: submitted.revision, activeRuleIDs: [draft.id])
    #expect(finished.progress.completed && finished.progress.draft == nil)
    #expect(try store.read().rules[draft.id] == nil)
    #expect(try store.read().revision == 1)
    #expect(submitted.progress.draft?.id == draft.id && submitted.progress.draft?.binding?.commandID == commandID)
}

@Test @ItomaControlActor func currentHostRefreshWaitsForPrivateImportAfterControlFinishes() async throws {
    let runtime = try ScreenTimeRuntime(); defer { runtime.remove() }
    let host = ExtractedHost()
    let completion = Completion()
    await ProductHistoryController.shared.holdNextImport()
    let work = Task { @ItomaControlActor in
        try await host.refresh(runtime)
        completion.done = true
    }
    await ProductHistoryController.shared.waitForBlockedImport()
    #expect(runtime.restriction.calls == 1)
    let applied = try? runtime.repository.readSnapshot()
    #expect(applied?.application?.observation.status == .applied)
    #expect(!completion.done)
    await ProductHistoryController.shared.releaseImport()
    try await work.value
    #expect(completion.done)
    print("CURRENT host_refresh control_complete=true private_import=held host_returned=false; released=true host_returned=true")
}
}
