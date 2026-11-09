import ItomaCore
import ItomaStorage

@ItomaControlActor public protocol PolicyBoundaryScheduler: AnyObject {
    /// A 15-minute daily interval begins at each boundary. Start AND end callbacks reevaluate
    /// current Core state; the extra end callback never applies an old captured policy.
    func registerBoundary(name: String, minute: Int) throws
    func containsActivities(_ names: Set<String>) -> Bool
    func containsAnyActivity(_ names: Set<String>) -> Bool
    func stopActivities(_ names: Set<String>)
}

/// Separate from grant deadlines. A finite Core evaluation horizon is not an OS wake-up plan.
@ItomaControlActor public final class PolicyScheduleCoordinator {
    let repository: PolicyMonitorRepository
    let scheduler: any PolicyBoundaryScheduler
    public init(repository: PolicyMonitorRepository, scheduler: any PolicyBoundaryScheduler) {
        self.repository = repository; self.scheduler = scheduler
    }

    public func readyPlan(for policy: PolicySnapshot) throws -> PolicyMonitorPlan? {
        try repository.plans().first { $0.policy == policy && $0.isReady && scheduler.containsActivities($0.activityNames) }
    }

    /// OS calls are synchronous and outside the journal/control writers. A partial registration
    /// never permits activating a candidate. Old policy monitors remain until a new policy commits.
    @discardableResult public func prepare(_ policy: PolicySnapshot) throws -> PolicyMonitorPlan {
        if let plan = try readyPlan(for: policy) { return plan }
        var plan = try PolicyMonitorPlan(policy: policy)
        try repository.record(plan, expected: nil)
        for minute in plan.boundaryMinutes.sorted() {
            try scheduler.registerBoundary(name: plan.activityName(minute: minute), minute: minute)
            let updated = try PolicyMonitorPlan(id: plan.id, policy: policy, acceptedMinutes: plan.acceptedMinutes.union([minute]))
            try repository.record(updated, expected: plan)
            plan = updated
        }
        guard scheduler.containsActivities(plan.activityNames) else { throw CommandServiceError.invalidState }
        return plan
    }

    /// Call only after inspecting the active policy, with no concurrent host edit in flight.
    /// Removing old wakeups is safe: every callback reevaluates the latest durable state.
    public func cleanup(keeping plan: PolicyMonitorPlan) throws {
        guard plan.isReady, scheduler.containsActivities(plan.activityNames) else { throw CommandServiceError.invalidState }
        for old in try repository.plans() where old.id != plan.id {
            scheduler.stopActivities(old.activityNames)
            if !scheduler.containsAnyActivity(old.activityNames) { try repository.remove(old) }
        }
    }
}
