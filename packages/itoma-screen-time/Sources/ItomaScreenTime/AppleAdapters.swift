import DeviceActivity
import FamilyControls
import Foundation
import OSLog
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
    private var diagnosticKey: String?
    public init() {}
    public func context(activation: Activation) -> EvaluationContext {
        lastActivation = activation
        let status: ItomaCore.AuthorizationStatus
        let diagnosticStatus: ScreenTimeDiagnostics.Authorization
        // Observe the same single read used for evaluation; do not fix the queue/initialization
        // behavior in this instrumentation change or substitute a previous approved value.
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved: status = .approved; diagnosticStatus = .approved
        case .denied: status = .denied; diagnosticStatus = .denied
        case .notDetermined: status = .unknown; diagnosticStatus = .notDetermined
        @unknown default: status = .unknown; diagnosticStatus = .unrecognized
        }
        // First read and changes only, rather than a log for every context inside a transaction.
        let key = "\(diagnosticStatus.rawValue):\(activation.rawValue):\(Thread.isMainThread)"
        if key != diagnosticKey {
            diagnosticKey = key
            let intent: ScreenTimeDiagnostics.Result
            switch activation {
            case .paused: intent = .paused
            case .enabled: intent = .enabled
            case .awaitingReauthorizationConfirmation: intent = .awaitingReauthorizationConfirmation
            }
            ScreenTimeDiagnostics.record(.authorizationRead, authorization: diagnosticStatus, result: intent)
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
        ScreenTimeDiagnostics.record(.policyRegistrationBegin, activity: .rule, minute: minute)
        do {
            try center.startMonitoring(DeviceActivityName(name), during: schedule)
            ScreenTimeDiagnostics.record(.policyRegistrationResult, activity: .rule, result: .accepted, minute: minute)
        } catch {
            ScreenTimeDiagnostics.record(.policyRegistrationResult, activity: .rule, result: .rejected,
                failure: .registrationFailure, minute: minute)
            throw ScreenTimeRuntimeError.scheduleUnavailable
        }
    }
    public func containsActivities(_ names: Set<String>) -> Bool {
        names.isSubset(of: Set(center.activities.map(\.rawValue)))
    }
    public func containsAnyActivity(_ names: Set<String>) -> Bool { !names.isDisjoint(with: Set(center.activities.map(\.rawValue))) }
    public func stopActivities(_ names: Set<String>) { center.stopMonitoring(names.map { DeviceActivityName($0) }) }
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
        ScreenTimeDiagnostics.record(.deadlineRegistrationBegin, activity: .deadline)
        guard end > now else {
            ScreenTimeDiagnostics.record(.deadlineRegistrationResult, activity: .deadline,
                result: .rejected, failure: .registrationFailure)
            return .rejected(.registrationFailure)
        }
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
            ScreenTimeDiagnostics.record(.deadlineRegistrationResult, activity: .deadline, result: .accepted)
            return .accepted(DeadlineReceipt(registrationID: registration.id, generation: registration.generation,
                scheduledFor: registration.scheduledFor, acceptedAt: try NativeScheduleClock.instant(Date())))
        } catch {
            ScreenTimeDiagnostics.record(.deadlineRegistrationResult, activity: .deadline,
                result: .rejected, failure: .registrationFailure)
            return .rejected(.registrationFailure)
        }
    }
    public func cancel(_ registration: DeadlineRegistration) async -> DeadlineCancellationResult {
        let name = DeviceActivityName(Self.name(registration))
        center.stopMonitoring([name])
        let remains = center.activities.contains(name)
        ScreenTimeDiagnostics.record(.deadlineCancellationResult, activity: .deadline,
            result: remains ? .uncertain : .accepted, failure: remains ? .osOperationFailure : .none)
        return remains ? .unknown(.osOperationFailure) : .accepted
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
        let operation: ScreenTimeDiagnostics.Result
        switch purpose {
        case .reconciliation: operation = .reconciliation
        case .policyCandidate: operation = .policyCandidate
        case .temporaryGrant: operation = .temporaryGrant
        }
        ScreenTimeDiagnostics.record(.restrictionBegin, result: operation,
            count: evaluation.desiredTargets.count, revision: evaluation.policyRevision.rawValue)
        let result = applyToOwnStore(evaluation, purpose: purpose)
        let outcome: ScreenTimeDiagnostics.Result
        let failure: ScreenTimeDiagnostics.Result
        switch result {
        case .accepted: outcome = .accepted; failure = .none
        case let .failed(error): outcome = .failed; failure = ScreenTimeDiagnostics.failure(error)
        case let .uncertain(error): outcome = .uncertain; failure = ScreenTimeDiagnostics.failure(error)
        }
        ScreenTimeDiagnostics.record(.restrictionResult, result: outcome, failure: failure,
            count: evaluation.desiredTargets.count, revision: evaluation.policyRevision.rawValue)
        return result
    }
    private func applyToOwnStore(_ evaluation: Evaluation, purpose: RestrictionPurpose) -> RestrictionApplicationResult {
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

/// Fixed vocabulary only: never pass a token, identifier, user text, path or error description.
/// OS-managed, best-effort diagnostics; not a durable callback ledger or OS Shield evidence.
public enum ScreenTimeDiagnostics {
    public enum Stage: String, Sendable {
        case callbackEntry, actorEntry, runtimeOpen, serviceReady, reconciliationResult, callbackError, callbackExit
        case authorizationRead, policyRegistrationBegin, policyRegistrationResult
        case deadlineRegistrationBegin, deadlineRegistrationResult, deadlineCancellationResult
        case restrictionBegin, restrictionResult, hostRefreshBegin, hostRefreshEnd
    }
    public enum Activity: String, Sendable { case none, rule, deadline, unrecognized }
    public enum Authorization: String, Sendable { case notRead, approved, denied, notDetermined, unrecognized }
    public enum Result: String, Sendable {
        case none, accepted, rejected, uncertain, committed, requiresRecovery, failed, ignored
        case reconciliation, policyCandidate, temporaryGrant, paused, enabled, awaitingReauthorizationConfirmation
        case storageMissing, storageBusy, storageCorrupt, storageSchema, storageUnavailable, storageOther
        case invalidSelection, runtimeUnavailable, scheduleUnavailable, runtimeBusy, otherError
        case authorizationRequired, registrationFailure, storageFailure, osOperationFailure, interrupted, unknownFailure
    }
    private static let logger = Logger(subsystem: "com.itoma.screentime", category: "lifecycle")
    private static let role = Bundle.main.bundleURL.pathExtension == "appex" ? "extension" : "host"

    public static func activity(_ name: String) -> Activity {
        if name.hasPrefix("itoma.rule.") { return .rule }
        if name.hasPrefix("itoma.deadline.") { return .deadline }
        return .unrecognized
    }

    public static func record(_ stage: Stage, activity: Activity = .none, ended: Bool = false,
                              authorization: Authorization = .notRead, result: Result = .none,
                              failure: Result = .none,
                              count: Int = -1, revision: Int64 = -1, minute: Int = -1,
                              elapsedMilliseconds: Int = -1) {
        // Process/PID, time and sender image UUID are OS log metadata. No raw activity name/ID.
        logger.notice("v=1 role=\(role, privacy: .public) stage=\(stage.rawValue, privacy: .public) activity=\(activity.rawValue, privacy: .public) ended=\(ended) auth=\(authorization.rawValue, privacy: .public) result=\(result.rawValue, privacy: .public) failure=\(failure.rawValue, privacy: .public) main=\(Thread.isMainThread) count=\(count) revision=\(revision) minute=\(minute) elapsed_ms=\(elapsedMilliseconds)")
    }

    static func failure(_ failure: OperationFailure?) -> Result {
        switch failure {
        case nil: .none
        case .authorizationRequired: .authorizationRequired
        case .unavailable: .runtimeUnavailable
        case .busy: .runtimeBusy
        case .storageFailure: .storageFailure
        case .registrationFailure: .registrationFailure
        case .osOperationFailure: .osOperationFailure
        case .interrupted: .interrupted
        case .unknown: .unknownFailure
        }
    }

    static func error(_ error: Error) -> Result {
        switch error {
        case StorageError.missingDatabase: .storageMissing
        case StorageError.busy: .storageBusy
        case StorageError.corrupt, StorageError.wrongDatabase: .storageCorrupt
        case StorageError.unsupportedSchema: .storageSchema
        case StorageError.unavailable: .storageUnavailable
        case is StorageError: .storageOther
        case ScreenTimeRuntimeError.invalidSelection: .invalidSelection
        case ScreenTimeRuntimeError.scheduleUnavailable: .scheduleUnavailable
        case ScreenTimeRuntimeError.unavailable: .runtimeUnavailable
        case ScreenTimeRuntimeError.busy: .runtimeBusy
        default: .otherError
        }
    }
}
