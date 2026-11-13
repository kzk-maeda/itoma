// Experiment scaffolding only. Host method bodies are inserted from the checked-out sources
// by run.py. Apple ports below are fakes; Control/Storage/History are the real Swift packages.
import Foundation
import Testing
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
    var available = true
    func prepare(_ policy: PolicySnapshot) throws -> Bool { prepares += 1; available = true; return true }
    func readyPlan(for policy: PolicySnapshot) throws -> Bool? { available ? true : nil }
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
    var busy = false
    var displayRefreshGate = DisplayRefreshGate()
    var displayRefreshInFlight = false
    var hostMutationGeneration = 0
// EXTRACT_DISPLAY_REFRESH
}

@Suite(.serialized) struct DisplayPollHostTests {
@Test @ItomaControlActor func tenActualHostPollsReuseOneCompletedRefresh() async throws {
    let runtime = try ScreenTimeRuntime(); defer { runtime.remove() }
    let host = ExtractedHost()
    try await host.refreshForDisplay(runtime, authorizationEpoch: 0, lifecycleGeneration: 0)
    let before = try runtime.repository.readSnapshot(), facts = try runtime.repository.reflectionBatch()?.boundary
    let applies = runtime.restriction.calls, imports = await ProductHistoryController.shared.count()
    for _ in 0..<10 { try await host.refreshForDisplay(runtime, authorizationEpoch: 0, lifecycleGeneration: 0) }
    #expect(try runtime.repository.readSnapshot() == before)
    #expect(try runtime.repository.reflectionBatch()?.boundary == facts)
    #expect(runtime.restriction.calls == applies)
    #expect(await ProductHistoryController.shared.count() == imports + 10)
    print("HOST polls=10 additional_apply=0 sequence_delta=0 reflection_delta=0 backlog_import=10 evidence_unchanged=true")
}
@Test @ItomaControlActor func hostStillRefreshesForLifecycleAndMissingProtection() async throws {
    let runtime = try ScreenTimeRuntime(); defer { runtime.remove() }
    let host = ExtractedHost()
    try await host.refreshForDisplay(runtime, authorizationEpoch: 0, lifecycleGeneration: 0)
    let initial = runtime.restriction.calls
    try await host.refreshForDisplay(runtime, authorizationEpoch: 0, lifecycleGeneration: 1)
    #expect(runtime.restriction.calls == initial + 1)
    runtime.monitors.available = false
    try await host.refreshForDisplay(runtime, authorizationEpoch: 0, lifecycleGeneration: 1)
    #expect(runtime.restriction.calls == initial + 2)
}
@Test @ItomaControlActor func overlappingHostPollDoesNotDuplicateApplyAndInterleavedActionInvalidatesStamp() async throws {
    let runtime = try ScreenTimeRuntime(); defer { runtime.remove() }
    let host = ExtractedHost()
    await ProductHistoryController.shared.holdNextImport()
    let first = Task { try await host.refreshForDisplay(runtime, authorizationEpoch: 0, lifecycleGeneration: 0) }
    await ProductHistoryController.shared.waitForBlockedImport()
    let applies = runtime.restriction.calls
    try await host.refreshForDisplay(runtime, authorizationEpoch: 0, lifecycleGeneration: 0)
    #expect(runtime.restriction.calls == applies)
    host.hostMutationGeneration += 1
    await ProductHistoryController.shared.releaseImport()
    try await first.value
    try await host.refreshForDisplay(runtime, authorizationEpoch: 0, lifecycleGeneration: 0)
    #expect(runtime.restriction.calls == applies + 1)
}
}
