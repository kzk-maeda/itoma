import Foundation
import ItomaCore
import ItomaStorage
import Testing
@testable import ItomaControl

@ItomaControlActor private final class BoundaryScheduler: PolicyBoundaryScheduler {
    var activities: Set<String> = []
    var failMinute: Int?
    var onRegister: (() throws -> Void)?
    var stopped: Set<String> = []
    func registerBoundary(name: String, minute: Int) throws {
        try onRegister?()
        if minute == failMinute { throw CommandServiceError.invalidState }
        activities.insert(name)
    }
    func containsActivities(_ names: Set<String>) -> Bool { names.isSubset(of: activities) }
    func stopActivities(_ names: Set<String>) { activities.subtract(names); stopped.formUnion(names) }
}

@Test @ItomaControlActor func policyPlansPersistBeforeOSAndPartialReceiptCannotActivate() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("monitors.sqlite")
    let repository = try PolicyMonitorRepository.create(at: url)
    let scheduler = BoundaryScheduler()
    let coordinator = PolicyScheduleCoordinator(repository: repository, scheduler: scheduler)
    let ref = SelectionRef(UUID()), ruleID = RuleID(UUID())
    let rule = try Rule(id: ruleID, version: RuleVersion(0), enabled: true, selectionRef: ref,
        schedule: WeeklySchedule(weekdays: [.friday], startMinute: 1439, endMinute: 2, endDayOffset: .nextDay), unlockMode: .reason)
    let policy = try PolicySnapshot(revision: PolicyRevision(1), rules: [rule], priorityOrder: [ruleID])
    scheduler.onRegister = {
        let other = try PolicyMonitorRepository.open(at: url); defer { try? other.close() }
        #expect(try other.plans().count == 1)
        #expect(try other.plans().first?.isReady == false)
    }
    scheduler.failMinute = 1439
    #expect(throws: CommandServiceError.invalidState) { try coordinator.prepare(policy) }
    #expect(try coordinator.readyPlan(for: policy) == nil)
    let partial = try #require(repository.plans().first)
    #expect(partial.boundaryMinutes == [2, 1439] && partial.acceptedMinutes == [2])
    scheduler.onRegister = nil; scheduler.failMinute = nil
    let ready = try coordinator.prepare(policy)
    #expect(ready.isReady && ready.policy == policy)
    #expect(try coordinator.prepare(policy) == ready)
    try coordinator.cleanup(keeping: ready)
    #expect(try repository.plans() == [ready])
    #expect(scheduler.stopped == partial.activityNames)
    scheduler.activities.remove(ready.activityName(minute: 2))
    #expect(try coordinator.readyPlan(for: policy) == nil)
    try repository.close()
    let reopened = try PolicyMonitorRepository.open(at: url); defer { try? reopened.close() }
    #expect(try reopened.plans() == [ready])
    #expect(throws: StorageError.conflict) { try reopened.record(partial, expected: nil) }
    #expect(throws: StorageError.alreadyExists) { try PolicyMonitorRepository.create(at: url) }
}

@Test @ItomaControlActor func synchronousDeadlineCompletesStoreAndFactsWithoutStartingAsyncCleanup() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept(1)
    _ = try await f.service.executeAcceptedGrant(commandID: grant.commandID)
    let registration = try #require(f.scheduler.requests.first)
    f.contexts.now = grant.effectiveExpiresAt
    let result = f.service.reconcileSynchronously(registrationID: registration.id, generation: registration.generation)
    #expect(result.failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets.count == 2)
    #expect(try f.repository.grant(grant.id)?.grant.status == .reconciled)
    #expect(try f.repository.registration(registration.id)?.firedAt == grant.effectiveExpiresAt)
    #expect(try f.repository.readSnapshot().application?.observation.status == .applied)
    #expect(f.scheduler.cancellations.isEmpty)
    _ = await f.service.reconcile()
    #expect(f.scheduler.cancellations == [registration.id])
}
