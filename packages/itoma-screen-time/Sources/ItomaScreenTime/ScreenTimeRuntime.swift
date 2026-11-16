import Foundation
import FamilyControls
import ManagedSettings
import ItomaCore
import ItomaControl
import ItomaStorage

@ItomaControlActor public final class ScreenTimeRuntime {
    public let repository: ControlRepository
    public let contexts = AppleEvaluationContexts()
    public let directory: URL
    private var monitorRepository: PolicyMonitorRepository?
    private var coordinator: PolicyScheduleCoordinator?
    private let mayCreateMonitor: Bool
    private let policyScheduler = ApplePolicyScheduler()
    public let outboxCapacity: HistoryOutboxCapacity
    public var monitors: PolicyScheduleCoordinator {
        get throws {
            if let coordinator { return coordinator }
            let url = directory.appendingPathComponent("monitors.sqlite")
            let repository = try !FileManager.default.fileExists(atPath: url.path) && mayCreateMonitor
                ? PolicyMonitorRepository.create(at: url) : PolicyMonitorRepository.open(at: url)
            monitorRepository = repository
            let created = PolicyScheduleCoordinator(repository: repository, scheduler: policyScheduler)
            try ScreenTimeFiles.protectDatabase(url)
            coordinator = created
            return created
        }
    }

    public init(createIfMissing: Bool, allowMonitorCreation: Bool = false) throws {
        mayCreateMonitor = createIfMissing || allowMonitorCreation
        guard let limit = Bundle.main.object(forInfoDictionaryKey: "ITOMAPendingEventLimit") as? Int else { throw ScreenTimeRuntimeError.unavailable }
        outboxCapacity = try HistoryOutboxCapacity(maximumPendingEvents: limit)
        directory = try ScreenTimeFiles.sharedDirectory()
        let controlURL = directory.appendingPathComponent("control.sqlite")
        if createIfMissing { try ScreenTimeFiles.prepareDirectory(directory) }
        if !FileManager.default.fileExists(atPath: controlURL.path), createIfMissing {
            repository = try ControlRepository.create(at: controlURL,
                initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [], priorityOrder: []), activation: .enabled)
        } else {
            // No destructive recovery; migrations belong to the host and must be explicit.
            repository = try ControlRepository.open(at: controlURL)
        }
        try protectFiles()
    }

    public func protectFiles() throws {
        for file in ["control.sqlite", "monitors.sqlite"] { try ScreenTimeFiles.protectDatabase(directory.appendingPathComponent(file)) }
    }

    /// Explicit foreground checkpoint only; no timer, schedule registration or shield mutation.
    /// A mismatch revokes the preceding unconfirmed span instead of reporting it as success.
    public func recordDurationCheckpoint() throws {
        let snapshot = try repository.readSnapshot()
        let context = contexts.context(activation: snapshot.activation)
        let registry = try ProductTokenRegistry(selections: snapshot.selections)
        let store = ManagedSettingsStore(named: AppleRestrictionAdapter.storeName)
        let desired = snapshot.application?.evaluation.desiredTargets ?? []
        let tokens = Set(desired.compactMap { registry.tokens[$0] })
        var confirmed = context.authorization.status == .approved
            && tokens.count == desired.count && (store.shield.applications ?? []) == tokens
        if #available(iOS 26.5, *) { confirmed = confirmed && store.isActive }
        try repository.recordReflectionBaseline(durationConfirmed: confirmed, expectedSequence: snapshot.snapshotSequence)
        try protectFiles()
    }

    public func makeService(additionalPolicy: PolicySnapshot? = nil, stopping: Bool = false) throws -> CommandService {
        let snapshot = try repository.readSnapshot()
        let registry = try ProductTokenRegistry(selections: stopping ? [] : snapshot.selections)
        var plans: [PolicyRevision: PolicyMonitorPlan] = [:]
        for policy in [snapshot.policy, additionalPolicy].compactMap({ $0 }) where !stopping {
            // A missing policy monitor must not prevent current-state reblock. New permission
            // operations still require a complete plan in their explicit apply purpose.
            if let ready = try? monitors.readyPlan(for: policy) { plans[policy.revision] = ready }
        }
        let restriction = AppleRestrictionAdapter(registry: registry, plans: plans, scheduler: policyScheduler, contexts: contexts)
        return CommandService(repository: repository, scheduler: AppleDeadlineScheduler(), restriction: restriction,
            contexts: contexts, historyCapacity: outboxCapacity)
    }

    public func saveSelection(tokensData: Data) throws -> SelectionRef {
        let tokens = try JSONDecoder().decode([ApplicationToken].self, from: tokensData)
        guard !tokens.isEmpty, tokens.count <= 50, Set(tokens).count == tokens.count,
              contexts.context(activation: .enabled).authorization.status == .approved else { throw ScreenTimeRuntimeError.invalidSelection }
        let snapshot = try repository.readSnapshot(), registry = try ProductTokenRegistry(selections: snapshot.selections)
        let applications = tokens.map { token in
            ProductApplicationEntry(ref: registry.tokens.first(where: { $0.value == token })?.key ?? TargetRef(UUID()), token: token)
        }
        let ref = SelectionRef(UUID())
        _ = try repository.putSelection(StoredSelection(selection: Selection(ref: ref, targets: Set(applications.map(\.ref))),
            opaquePayload: JSONEncoder().encode(ProductSelectionPayload(applications: applications))), expectedSequence: snapshot.snapshotSequence)
        try protectFiles()
        return ref
    }

    /// Return opaque native-only data to the hosting SwiftUI label. Never expose it in RN events.
    public func selectionData(ref: SelectionRef, target: TargetRef? = nil) throws -> Data? {
        guard contexts.context(activation: .enabled).authorization.status == .approved else { return nil }
        let snapshot = try repository.readSnapshot()
        guard let stored = snapshot.selections.first(where: { $0.selection.ref == ref }) else { return nil }
        let payload = try JSONDecoder().decode(ProductSelectionPayload.self, from: stored.opaquePayload)
        return try JSONEncoder().encode(payload.applications.filter { target == nil || $0.ref == target }.map(\.token))
    }

    /// Called only by the synchronous OS callback bridge, on ItomaControlActor.
    public static func handleActivity(_ name: String, ended: Bool) {
        let kind = ScreenTimeDiagnostics.activity(name)
        guard kind != .unrecognized else {
            ScreenTimeDiagnostics.record(.reconciliationResult, activity: kind, ended: ended, result: .ignored)
            return
        }
        // An interval already in progress can start immediately after registration. It must not
        // consume a deadline receipt before the grant's end.
        if name.hasPrefix("itoma.deadline."), !ended {
            ScreenTimeDiagnostics.record(.reconciliationResult, activity: kind, result: .ignored)
            return
        }
        do {
            let runtime = try ScreenTimeRuntime(createIfMissing: false)
            ScreenTimeDiagnostics.record(.runtimeOpen, activity: kind, ended: ended, result: .accepted)
            let service = try runtime.makeService()
            ScreenTimeDiagnostics.record(.serviceReady, activity: kind, ended: ended)
            let result: ReconciliationResult
            if let (id, generation) = AppleDeadlineScheduler.identity(name) {
                result = service.reconcileSynchronously(registrationID: id, generation: generation)
            } else { result = service.reconcileSynchronously() }
            let disposition: ScreenTimeDiagnostics.Result
            switch result.disposition {
            case .committed: disposition = .committed
            case .requiresRecovery: disposition = .requiresRecovery
            case .uncertain: disposition = .uncertain
            }
            ScreenTimeDiagnostics.record(.reconciliationResult, activity: kind, ended: ended,
                result: disposition, failure: ScreenTimeDiagnostics.failure(result.failure))
            try runtime.protectFiles()
        } catch {
            ScreenTimeDiagnostics.record(.callbackError, activity: kind, ended: ended,
                result: .failed, failure: ScreenTimeDiagnostics.error(error))
            // No database recreation, stale plan, empty-store fallback or user-data logging.
            // The durable last intent and any existing own-store restrictions remain available.
        }
    }
}
