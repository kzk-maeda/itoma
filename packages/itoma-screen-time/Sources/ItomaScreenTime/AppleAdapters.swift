import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import ItomaCore
import ItomaControl
import ItomaStorage

public struct ProductApplicationEntry: Codable {
    public let ref: TargetRef
    public let token: ApplicationToken
    public init(ref: TargetRef, token: ApplicationToken) { self.ref = ref; self.token = token }
}
public struct ProductSelectionPayload: Codable {
    public let version: Int
    public let applications: [ProductApplicationEntry]
    public init(applications: [ProductApplicationEntry]) { version = 1; self.applications = applications }
}

/// Immutable lookup built outside Control's writer. No readSnapshot is permitted inside apply.
@ItomaControlActor public struct ProductTokenRegistry {
    public let tokens: [TargetRef: ApplicationToken]
    public init(selections: [StoredSelection]) throws {
        var tokens: [TargetRef: ApplicationToken] = [:]
        var references: [ApplicationToken: TargetRef] = [:]
        for stored in selections {
            let payload = try JSONDecoder().decode(ProductSelectionPayload.self, from: stored.opaquePayload)
            guard payload.version == 1, !payload.applications.isEmpty,
                  Set(payload.applications.map(\.ref)).count == payload.applications.count,
                  Set(payload.applications.map(\.token)).count == payload.applications.count,
                  Set(payload.applications.map(\.ref)) == stored.selection.targets else { throw ScreenTimeRuntimeError.invalidSelection }
            for entry in payload.applications {
                if let old = tokens[entry.ref], old != entry.token { throw ScreenTimeRuntimeError.invalidSelection }
                if let ref = references[entry.token], ref != entry.ref { throw ScreenTimeRuntimeError.invalidSelection }
                tokens[entry.ref] = entry.token; references[entry.token] = entry.ref
            }
        }
        self.tokens = tokens
    }
}

@ItomaControlActor public final class AppleEvaluationContexts: EvaluationContextProvider {
    public private(set) var lastActivation: Activation = .paused
    public init() {}
    public func context(activation: Activation) -> EvaluationContext {
        lastActivation = activation
        let status: AuthorizationStatus
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved: status = .approved
        case .denied: status = .denied
        case .notDetermined: status = .unknown
        @unknown default: status = .unknown
        }
        // Date and TimeZone.current are finite/valid Foundation values.
        let now = try! NativeScheduleClock.instant(Date())
        return EvaluationContext(now: now, timeZone: try! TimeZoneID(TimeZone.current.identifier),
            authorization: AuthorizationObservation(status: status, observedAt: now), activation: activation)
    }
}

@ItomaControlActor public final class ApplePolicyScheduler: PolicyBoundaryScheduler {
    private let center = DeviceActivityCenter()
    public init() {}
    public func registerBoundary(name: String, minute: Int) throws {
        guard (0..<1440).contains(minute), name.hasPrefix("itoma.rule.") else { throw ScreenTimeRuntimeError.scheduleUnavailable }
        let end = (minute + 15) % 1440
        // No fixed zone/weekday: daily local-time wakeups; Core resolves weekdays, DST and priority.
        let schedule = DeviceActivitySchedule(intervalStart: DateComponents(hour: minute / 60, minute: minute % 60),
            intervalEnd: DateComponents(hour: end / 60, minute: end % 60), repeats: true)
        do { try center.startMonitoring(DeviceActivityName(name), during: schedule) }
        catch { throw ScreenTimeRuntimeError.scheduleUnavailable }
    }
    public func containsActivities(_ names: Set<String>) -> Bool {
        names.isSubset(of: Set(center.activities.map(\.rawValue)))
    }
    public func containsAnyActivity(_ names: Set<String>) -> Bool { !names.isDisjoint(with: Set(center.activities.map(\.rawValue))) }
    public func stopActivities(_ names: Set<String>) { center.stopMonitoring(names.map(DeviceActivityName.init)) }
}

@ItomaControlActor public final class AppleDeadlineScheduler: DeadlineScheduler {
    private let center = DeviceActivityCenter()
    public init() {}
    public static func name(_ registration: DeadlineRegistration) -> String {
        "itoma.deadline.\(registration.id.rawValue.uuidString.lowercased()).\(registration.generation.rawValue)"
    }
    public static func identity(_ name: String) -> (RegistrationID, RegistrationGeneration)? {
        let parts = name.split(separator: ".")
        guard parts.count == 4, parts[0] == "itoma", parts[1] == "deadline",
              let id = UUID(uuidString: String(parts[2])), let value = Int64(parts[3]),
              let generation = try? RegistrationGeneration(value) else { return nil }
        return (RegistrationID(id), generation)
    }
    public func register(_ registration: DeadlineRegistration) async -> DeadlineScheduleResult {
        let end = registration.scheduledFor.date, now = Date()
        guard end > now else { return .rejected(.registrationFailure) }
        // Apple's minimum monitoring interval is 15m. A short grant uses an interval beginning
        // in the past and ending at its fixed deadline. Early intervalDidStart is NOT expiry.
        // Acceptance is an API receipt only; exact callback delivery needs physical-device QA.
        let start = min(now, end.addingTimeInterval(-15 * 60))
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = .current
        let components: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
        var starts = calendar.dateComponents(components, from: start)
        var ends = calendar.dateComponents(components, from: end)
        starts.timeZone = calendar.timeZone; ends.timeZone = calendar.timeZone
        do {
            try center.startMonitoring(DeviceActivityName(Self.name(registration)),
                during: DeviceActivitySchedule(intervalStart: starts, intervalEnd: ends, repeats: false))
            return .accepted(DeadlineReceipt(registrationID: registration.id, generation: registration.generation,
                scheduledFor: registration.scheduledFor, acceptedAt: try NativeScheduleClock.instant(Date())))
        } catch { return .rejected(.registrationFailure) }
    }
    public func cancel(_ registration: DeadlineRegistration) async -> DeadlineCancellationResult {
        let name = DeviceActivityName(Self.name(registration))
        center.stopMonitoring([name])
        return center.activities.contains(name) ? .unknown(.osOperationFailure) : .accepted
    }
}

@ItomaControlActor public final class AppleRestrictionAdapter: RestrictionAdapter {
    public static let storeName = ManagedSettingsStore.Name("itoma.product")
    private let store = ManagedSettingsStore(named: storeName)
    private let registry: ProductTokenRegistry
    private let plans: [PolicyRevision: PolicyMonitorPlan]
    private let scheduler: ApplePolicyScheduler
    private let contexts: AppleEvaluationContexts
    public init(registry: ProductTokenRegistry, plans: [PolicyRevision: PolicyMonitorPlan],
                scheduler: ApplePolicyScheduler, contexts: AppleEvaluationContexts) {
        self.registry = registry; self.plans = plans; self.scheduler = scheduler; self.contexts = contexts
    }
    public func apply(_ evaluation: Evaluation) -> RestrictionApplicationResult {
        apply(evaluation, purpose: .reconciliation)
    }
    public func apply(_ evaluation: Evaluation, purpose: RestrictionPurpose) -> RestrictionApplicationResult {
        // An explicit durable stop can always clear our own store, even if schedules/tokens fail.
        if contexts.lastActivation == .paused {
            guard evaluation.desiredTargets.isEmpty else { return .failed(.interrupted) }
            store.clearAllSettings()
            return store.shield.applications == nil ? .accepted(.ownStoreReadback) : .uncertain(.osOperationFailure)
        }
        if purpose != .reconciliation {
            guard let plan = plans[evaluation.policyRevision], plan.isReady,
                  scheduler.containsActivities(plan.activityNames) else { return .failed(.registrationFailure) }
        }
        guard evaluation.desiredTargets.count <= 50 else { return .failed(.osOperationFailure) }
        var applications: Set<ApplicationToken> = []
        for target in evaluation.desiredTargets {
            guard let token = registry.tokens[target] else { return .failed(.storageFailure) }
            applications.insert(token)
        }
        store.shield.applications = applications.isEmpty ? nil : applications
        let readback = store.shield.applications ?? []
        return readback == applications ? .accepted(.ownStoreReadback) : .uncertain(.osOperationFailure)
    }
}
