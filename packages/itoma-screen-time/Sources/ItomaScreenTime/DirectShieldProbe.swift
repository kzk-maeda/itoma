import Foundation
import DeviceActivity
import FamilyControls
import ManagedSettings
import ItomaControl
import ItomaCore
import ItomaStorage

public struct DirectProbeSnapshot: Encodable, Sendable {
    public var phase = "idle"
    public var id: String?
    public var startsAt: Double?
    public var endsAt: Double?
    public var selectedCount = 0
    public var storeCount = 0
    public var observation = "none"
    public var origin = "none"
    public var observedAt: Double?
}

/// Isolated opt-in experiment. Never supplies an approved value to the product evaluator.
@ItomaControlActor public enum DirectShieldProbe {
    public static let storeName = ManagedSettingsStore.Name("itoma.poc.direct-shield")
    private static let prefix = "itoma.directprobe."
    public static var enabled: Bool { Bundle.main.object(forInfoDictionaryKey: "ITOMADirectShieldProbe") as? Bool == true }
    private static func file(create: Bool) throws -> DirectProbeFile {
        let directory = try ScreenTimeFiles.sharedDirectory().appendingPathComponent("DirectProbe", isDirectory: true)
        if create { try ScreenTimeFiles.prepareDirectory(directory) }
        return DirectProbeFile(directory: directory)
    }
    private static func persist(_ record: DirectProbeRecord, to file: DirectProbeFile) throws {
        try file.write(record)
        try ScreenTimeFiles.protectDatabase(file.recordURL)
        try ScreenTimeFiles.protectDatabase(file.lockURL)
    }
    private static func requireNormalStopped() throws {
        let runtime = try ScreenTimeRuntime(createIfMissing: false)
        guard try runtime.repository.readSnapshot().activation == .paused,
              (ManagedSettingsStore(named: AppleRestrictionAdapter.storeName).shield.applications ?? []).isEmpty
        else { throw DirectProbeFailure.normalRulesActive }
    }
    public static func prepare(_ data: Data, expectedPreviousID: String?) throws -> DirectProbeSnapshot {
        guard enabled else { throw DirectProbeFailure.unavailable }
        let tokens = try JSONDecoder().decode([ApplicationToken].self, from: data)
        guard tokens.count == 1 else { throw DirectProbeFailure.invalid }
        try requireNormalStopped()
        let f = try file(create: true)
        try f.withLock { f in
            let old = try f.read()
            guard old?.id.uuidString.lowercased() == expectedPreviousID,
                  old.map({ ![.armed, .registering].contains($0.phase) }) ?? true else { throw DirectProbeFailure.changed }
            let startsAt = ceil((Date().timeIntervalSince1970 + 180) / 60) * 60
            try persist(DirectProbeRecord(startsAt: startsAt, tokenData: data), to: f)
        }
        return try snapshot()
    }
    public static func arm(expectedID: String) throws -> DirectProbeSnapshot {
        guard enabled else { throw DirectProbeFailure.unavailable }
        try requireNormalStopped()
        try file(create: false).withLock { f in
            guard var record = try f.read(), record.id.uuidString.lowercased() == expectedID,
                  record.phase == .prepared, record.startsAt >= Date().timeIntervalSince1970 + 30
            else { throw DirectProbeFailure.changed }
            record.phase = .registering
            try persist(record, to: f)
            let center = DeviceActivityCenter()
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = .current
            let fields: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
            var start = calendar.dateComponents(fields, from: Date(timeIntervalSince1970: record.startsAt))
            var end = calendar.dateComponents(fields, from: Date(timeIntervalSince1970: record.endsAt))
            start.timeZone = calendar.timeZone; end.timeZone = calendar.timeZone
            do {
                try center.startMonitoring(DeviceActivityName(record.activityName),
                    during: DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false))
                record.phase = .armed; try persist(record, to: f)
                ScreenTimeDiagnostics.record(.directProbeSchedule, activity: .directProbe, result: .accepted)
            } catch {
                record.stop(); try? persist(record, to: f)
                center.stopMonitoring([DeviceActivityName(record.activityName)])
                ManagedSettingsStore(named: storeName).clearAllSettings()
                ScreenTimeDiagnostics.record(.directProbeSchedule, activity: .directProbe, result: .rejected)
                throw DirectProbeFailure.unavailable
            }
        }
        return try snapshot()
    }
    /// Available to global Stop even without the PoC build flag. Never starts/apply restrictions.
    public static func stop() throws {
        let f = try file(create: false)
        let store = ManagedSettingsStore(named: storeName)
        guard FileManager.default.fileExists(atPath: f.directory.path) else {
            store.clearAllSettings(); return
        }
        try f.withLock { f in
            var record = try? f.read()
            if record == nil {
                record = try DirectProbeRecord(startsAt: Date().timeIntervalSince1970, tokenData: Data([0]))
                record!.hasSchedule = false // Cancellation tombstone, not an invented user schedule.
            }
            record!.stop(); record!.id = UUID() // Invalidate old picker/arm responses as well as callbacks.
            try persist(record!, to: f)
            let center = DeviceActivityCenter()
            center.stopMonitoring(center.activities.filter { $0.rawValue.hasPrefix(prefix) })
            store.clearAllSettings()
            record!.origin = .manual; record!.observedAt = Date().timeIntervalSince1970
            record!.observation = (store.shield.applications ?? []).isEmpty ? .cleared : .uncertain
            try persist(record!, to: f)
            ScreenTimeDiagnostics.record(.directProbeClear, activity: .directProbe,
                result: record!.observation == .cleared ? .accepted : .uncertain, count: 0)
            guard record!.observation == .cleared else { throw DirectProbeFailure.unavailable }
        }
    }
    public static func snapshot() throws -> DirectProbeSnapshot {
        guard enabled else { throw DirectProbeFailure.unavailable }
        let f = try file(create: true)
        return try f.withLock { f in
            guard var record = try f.read() else { return DirectProbeSnapshot() }
            let store = ManagedSettingsStore(named: storeName)
            // Foreground recovery may clear an expired probe, but must NEVER start one.
            if record.phase == .armed, Date().timeIntervalSince1970 >= record.endsAt {
                record.stop(); try persist(record, to: f); store.clearAllSettings()
                record.origin = .expiry; record.observedAt = Date().timeIntervalSince1970
                record.observation = (store.shield.applications ?? []).isEmpty ? .cleared : .uncertain
                try persist(record, to: f)
                ScreenTimeDiagnostics.record(.directProbeClear, activity: .directProbe,
                    result: .probeHostExpiry, count: 0)
            }
            var value = DirectProbeSnapshot()
            value.phase = record.phase.rawValue; value.id = record.id.uuidString.lowercased()
            if record.hasSchedule { value.startsAt = record.startsAt; value.endsAt = record.endsAt }
            value.selectedCount = record.tokenData == nil ? 0 : 1
            value.storeCount = (store.shield.applications ?? []).count
            value.observation = record.observation.rawValue; value.origin = record.origin.rawValue
            value.observedAt = record.observedAt
            return value
        }
    }
    public static func displayData() throws -> Data? {
        guard enabled else { return nil }
        return try file(create: false).withLock { try $0.read()?.tokenData }
    }
    public static func handle(_ name: String) {
        guard name.hasPrefix(prefix) else { return }
        // An OFF build can finish an old experiment, but must never apply a new restriction.
        guard enabled else { try? stop(); return }
        do {
            try file(create: false).withLock { f in
                guard var record = try f.read() else { return }
                let now = Date().timeIntervalSince1970, store = ManagedSettingsStore(named: storeName)
                switch record.decision(activity: name, now: now) {
                case .ignore:
                    ScreenTimeDiagnostics.record(.directProbeApply, activity: .directProbe, result: .ignored); return
                case .clear:
                    record.stop(); try persist(record, to: f); store.clearAllSettings()
                    record.observation = (store.shield.applications ?? []).isEmpty ? .cleared : .uncertain
                case .apply:
                    try requireNormalStopped()
                    guard let data = record.tokenData else { throw DirectProbeFailure.invalid }
                    let tokens = try JSONDecoder().decode([ApplicationToken].self, from: data)
                    guard tokens.count == 1 else { throw DirectProbeFailure.invalid }
                    // Direct OS experiment: no fake authorization context or product grant.
                    store.shield.applications = Set(tokens)
                    record.observation = store.shield.applications == Set(tokens) ? .applied : .uncertain
                }
                record.origin = .monitor; record.observedAt = Date().timeIntervalSince1970
                try persist(record, to: f)
                ScreenTimeDiagnostics.record(record.observation == .cleared ? .directProbeClear : .directProbeApply,
                    activity: .directProbe, result: record.observation == .uncertain ? .uncertain : .accepted,
                    count: (store.shield.applications ?? []).count)
            }
        } catch {
            let failure: ScreenTimeDiagnostics.Result
            switch error {
            case DirectProbeFailure.busy: failure = .runtimeBusy
            case DirectProbeFailure.normalRulesActive: failure = .interrupted
            default: failure = .storageFailure
            }
            ScreenTimeDiagnostics.record(.directProbeApply, activity: .directProbe,
                result: .failed, failure: failure)
        }
    }
}
