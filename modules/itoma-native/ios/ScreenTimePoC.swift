import ExpoModulesCore
import Combine
import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit
import ItomaCore
import ItomaStorage

private struct ApplicationEntry: Codable {
    let ref: TargetRef
    let token: ApplicationToken
}

private struct SelectionPayload: Codable {
    let version: Int
    let applications: [ApplicationEntry]
}

/// Deliberately separate from product policies, grants, history and the future App Group store.
/// No method here schedules a deadline or performs a temporary grant.
@available(iOS 16.0, *)
@MainActor
final class ScreenTimePoC {
    static let shared = ScreenTimePoC()
    private var presenting = false
    private var confirmedThisSession: Set<SelectionRef> = []
    private var selectionEpoch: UInt64 = 0
    private let storeName = ManagedSettingsStore.Name("itoma.poc.manual")
    private var observers: Set<AnyCancellable> = []

    private init() {
        guard availability == "device-poc" else { return }
        AuthorizationCenter.shared.$authorizationStatus.receive(on: DispatchQueue.main).sink { [weak self] status in
            MainActor.assumeIsolated {
                if status != .approved { self?.invalidateConfirmation() }
            }
        }.store(in: &observers)
        // Conservatively reject tokens if Settings could have revoked/regranted authorization
        // while this process was suspended, even when the next getter already reads approved.
        NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)
            .receive(on: DispatchQueue.main).sink { [weak self] _ in
                MainActor.assumeIsolated { self?.invalidateConfirmation() }
            }.store(in: &observers)
    }

    private func invalidateConfirmation() {
        confirmedThisSession.removeAll(); selectionEpoch &+= 1
    }

    private var availability: String {
        #if targetEnvironment(simulator)
        return "simulator-unavailable"
        #else
        return Bundle.main.object(forInfoDictionaryKey: "ITOMAScreenTimePoC") as? Bool == true
            ? "device-poc" : "disabled"
        #endif
    }

    private var authorization: String {
        guard availability == "device-poc" else { return "unknown" }
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved: return "approved"
        case .denied: invalidateConfirmation(); return "denied"
        case .notDetermined: invalidateConfirmation(); return "unknown"
        @unknown default: invalidateConfirmation(); return "unknown"
        }
    }

    private func databaseURL() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: false)
            .appendingPathComponent("ITOMA-ScreenTime-PoC", isDirectory: true)
            .appendingPathComponent("control.sqlite")
    }

    private func protectFiles(at database: URL) throws {
        var directory = database.deletingLastPathComponent()
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        for file in [directory.path, database.path, database.path + "-wal", database.path + "-shm"] {
            if FileManager.default.fileExists(atPath: file) {
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file)
            }
        }
    }

    private func withRepository<T>(_ body: (ControlRepository) throws -> T) throws -> T {
        let url = try databaseURL()
        let repository = try ControlRepository.open(at: url)
        defer { try? repository.close() }
        try protectFiles(at: url)
        let value = try body(repository)
        try protectFiles(at: url)
        return value
    }

    private func decode(_ stored: StoredSelection) throws -> SelectionPayload {
        let payload = try JSONDecoder().decode(SelectionPayload.self, from: stored.opaquePayload)
        guard payload.version == 1,
              Set(payload.applications.map(\.ref)) == stored.selection.targets,
              Set(payload.applications.map(\.ref)).count == payload.applications.count,
              Set(payload.applications.map(\.token)).count == payload.applications.count else {
            throw StorageError.invalidSelection
        }
        return payload
    }

    func snapshot(operation: String = "idle", code: String? = nil, observation: String = "unknown") -> [String: Any] {
        let auth = authorization
        var storage = "not-created"
        var selections: [[String: Any]] = []
        if availability == "device-poc" {
            do {
                let url = try databaseURL()
                if FileManager.default.fileExists(atPath: url.path) {
                    selections = try withRepository { repository in
                        try repository.readSnapshot().selections.sorted {
                            $0.selection.ref.rawValue.uuidString < $1.selection.ref.rawValue.uuidString
                        }.map { stored in
                            let payload = try decode(stored)
                            return ["ref": stored.selection.ref.rawValue.uuidString,
                                    "applicationCount": payload.applications.count,
                                    "confirmedThisSession": confirmedThisSession.contains(stored.selection.ref)]
                        }
                    }
                    storage = "ready"
                }
            } catch { storage = "unavailable" }
        }
        // No native token/name, raw error, file path or system-wide success claim crosses JS.
        return ["availability": availability, "authorization": auth, "storage": storage,
                "selections": selections, "operation": operation, "code": code as Any? ?? NSNull(),
                "observation": observation]
    }

    func perform(_ action: String, ref: String?, presenter: UIViewController?, complete: @escaping ([String: Any]) -> Void) {
        // Stop never needs the selection DB or authorization, and clears only this PoC's own store.
        if action == "stop" {
            #if targetEnvironment(simulator)
            complete(snapshot(operation: "failed", code: "unavailable"))
            #else
            let store = ManagedSettingsStore(named: storeName)
            store.clearAllSettings()
            let empty = (store.shield.applications ?? []).isEmpty
                && store.shield.applicationCategories == nil && store.shield.webDomains == nil
                && store.shield.webDomainCategories == nil
            complete(snapshot(operation: "requested", observation: empty ? "own-store-empty" : "uncertain"))
            #endif
            return
        }
        guard action != "snapshot" else { complete(snapshot()); return }
        guard availability == "device-poc" else { complete(snapshot(operation: "failed", code: "unavailable")); return }
        guard !presenting else { complete(snapshot(operation: "failed", code: "busy")); return }
        switch action {
        case "initialize":
            do {
                let url = try databaseURL()
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                try protectFiles(at: url)
                let policy = try PolicySnapshot(revision: PolicyRevision(0), rules: [], priorityOrder: [])
                let repository = try ControlRepository.create(at: url, initialPolicy: policy, activation: .paused)
                defer { try? repository.close() }
                try protectFiles(at: url)
                complete(snapshot(operation: "saved"))
            } catch { complete(snapshot(operation: "failed", code: "storage-failure")) }
        case "authorize":
            invalidateConfirmation()
            presenting = true
            Task { @MainActor in
                var code: String?
                do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual) }
                catch { code = "authorization-failed" }
                presenting = false
                complete(snapshot(operation: code == nil ? "requested" : "failed", code: code))
            }
        case "pick":
            guard authorization == "approved" else { complete(snapshot(operation: "failed", code: "authorization-required")); return }
            guard let presenter, presenter.viewIfLoaded?.window != nil, !presenter.isBeingDismissed,
                  !presenter.isBeingPresented, presenter.presentedViewController == nil else {
                complete(snapshot(operation: "failed", code: "presentation-unavailable")); return
            }
            guard snapshot()["storage"] as? String == "ready" else {
                complete(snapshot(operation: "failed", code: "storage-failure")); return
            }
            presenting = true
            var completed = false
            let pickerEpoch = selectionEpoch
            let host = UIHostingController(rootView: PoCPicker { [weak self] selection in
                guard let self, !completed else { return }
                completed = true
                let result: [String: Any]
                if let selection { result = save(selection, expectedEpoch: pickerEpoch) }
                else { result = snapshot(operation: "cancelled") }
                presenter.dismiss(animated: true) { self.presenting = false; complete(result) }
            })
            host.isModalInPresentation = true // Cancellation is explicit and leaves persisted state unchanged.
            presenter.present(host, animated: true)
        case "apply":
            guard authorization == "approved" else { complete(snapshot(operation: "failed", code: "authorization-required")); return }
            guard let rawRef = ref.flatMap(UUID.init(uuidString:)), confirmedThisSession.contains(SelectionRef(rawRef)) else {
                complete(snapshot(operation: "failed", code: "reselection-required")); return
            }
            do {
                let tokens = try withRepository { repository in
                    guard let stored = try repository.readSnapshot().selections.first(where: { $0.selection.ref.rawValue == rawRef }) else {
                        throw StorageError.invalidSelection
                    }
                    return Set(try decode(stored).applications.map(\.token))
                }
                guard !tokens.isEmpty else { complete(snapshot(operation: "failed", code: "empty-selection")); return }
                guard tokens.count <= 50 else { complete(snapshot(operation: "failed", code: "too-many-applications")); return }
                guard authorization == "approved" else { complete(snapshot(operation: "failed", code: "authorization-required")); return }
                let store = ManagedSettingsStore(named: storeName)
                store.shield.applications = tokens
                complete(snapshot(operation: "requested", observation: store.shield.applications == tokens ? "own-store-matches" : "uncertain"))
            } catch { complete(snapshot(operation: "failed", code: "storage-failure")) }
        default: complete(snapshot(operation: "failed", code: "invalid-action"))
        }
    }

    private func save(_ selection: FamilyActivitySelection, expectedEpoch: UInt64) -> [String: Any] {
        guard authorization == "approved" else { return snapshot(operation: "failed", code: "authorization-required") }
        guard selectionEpoch == expectedEpoch else { return snapshot(operation: "failed", code: "reselection-required") }
        guard selection.categoryTokens.isEmpty, selection.webDomainTokens.isEmpty else {
            return snapshot(operation: "failed", code: "applications-only")
        }
        guard !selection.applicationTokens.isEmpty else { return snapshot(operation: "failed", code: "empty-selection") }
        guard selection.applicationTokens.count <= 50 else { return snapshot(operation: "failed", code: "too-many-applications") }
        do {
            let ref = try withRepository { repository in
                let current = try repository.readSnapshot()
                let previous = try current.selections.flatMap { try decode($0).applications }
                var tokenRefs: [ApplicationToken: TargetRef] = [:]
                var refTokens: [TargetRef: ApplicationToken] = [:]
                for entry in previous {
                    if let old = tokenRefs[entry.token], old != entry.ref { throw StorageError.invalidSelection }
                    if let old = refTokens[entry.ref], old != entry.token { throw StorageError.invalidSelection }
                    tokenRefs[entry.token] = entry.ref; refTokens[entry.ref] = entry.token
                }
                // Token equality is the identity. Never use display names, encoded bytes or hashes.
                let entries = selection.applicationTokens.map { token in
                    ApplicationEntry(ref: tokenRefs[token] ?? TargetRef(UUID()), token: token)
                }
                let ref = SelectionRef(UUID())
                let payload = try JSONEncoder().encode(SelectionPayload(version: 1, applications: entries))
                _ = try repository.putSelection(StoredSelection(selection: Selection(ref: ref, targets: Set(entries.map(\.ref))), opaquePayload: payload), expectedSequence: current.snapshotSequence)
                return ref
            }
            // Only the selection just reviewed in the native Picker can be manually applied.
            confirmedThisSession = [ref]
            return snapshot(operation: "saved")
        } catch { return snapshot(operation: "failed", code: "storage-failure") }
    }
}

@available(iOS 16.0, *)
private struct PoCPicker: View {
    @State private var selection = FamilyActivitySelection()
    let complete: (FamilyActivitySelection?) -> Void
    var body: some View {
        NavigationStack {
            VStack {
                Text("検証ではアプリだけを選択してください。保存しても制限は開始しません。")
                    .padding().fixedSize(horizontal: false, vertical: true)
                FamilyActivityPicker(selection: $selection)
            }
            .navigationTitle("検証対象を選択")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { complete(nil) } }
                ToolbarItem(placement: .confirmationAction) { Button("保存") { complete(selection) } }
            }
        }
        .tint(.primary)
    }
}
