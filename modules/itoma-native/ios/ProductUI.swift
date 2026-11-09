import ExpoModulesCore
import FamilyControls
import Foundation
import ManagedSettings
import SwiftUI
import UIKit
import Combine
import ItomaCore

@available(iOS 16.0, *)
@MainActor final class ProductUI {
    static let shared = ProductUI()
    private var busy = false
    private weak var picker: UIViewController?
    private var authorizationEpoch = 0
    private var subscriptions: Set<AnyCancellable> = []
    private init() {
        AuthorizationCenter.shared.$authorizationStatus.receive(on: DispatchQueue.main).sink { [weak self] status in
            MainActor.assumeIsolated {
                if status == .denied { self?.authorizationEpoch += 1 }
            }
        }.store(in: &subscriptions)
    }

    func perform(_ action: String, payload: String?, presenter: UIViewController?, complete: @escaping (String) -> Void) {
        guard #available(iOS 16.0, *) else { unavailable("unsupported-os", complete); return }
        #if targetEnvironment(simulator)
        unavailable("simulator", complete); return
        #endif
        guard Bundle.main.object(forInfoDictionaryKey: "ITOMAScreenTime") as? Bool == true else { unavailable("unconfigured", complete); return }
        guard !busy || action == "snapshot" || action == "stop" else { complete(ProductResponse(status: "error", code: "busy").json()); return }
        if ["commitRule", "retryRule", "unlock", "retryGrant", "resume"].contains(action), legacyActive {
            finish(ProductResponse(status: "error", code: "legacy-active"), complete); return
        }
        let request: ProductRequest
        do { request = try JSONDecoder().decode(ProductRequest.self, from: Data((payload ?? "{}").utf8)) }
        catch { complete(ProductResponse(status: "error", code: "invalid-input").json()); return }
        if action == "pickApplications" {
            guard AuthorizationCenter.shared.authorizationStatus == .approved, let presenter, presenter.presentedViewController == nil else {
                complete(ProductResponse(status: "error", code: "authorization-required").json()); return
            }
            busy = true
            let pickerEpoch = authorizationEpoch
            let sheet = UIHostingController(rootView: ProductPicker { [weak self] data in
                guard let self else { return }
                self.picker?.dismiss(animated: true); self.picker = nil
                guard let data else { self.busy = false; complete(ProductResponse(status: "cancelled").json()); return }
                guard self.authorizationEpoch == pickerEpoch, AuthorizationCenter.shared.authorizationStatus == .approved else {
                    self.busy = false; self.finish(ProductResponse(status: "error", code: "selection-required"), complete); return
                }
                Task { @MainActor in
                    guard self.authorizationEpoch == pickerEpoch, AuthorizationCenter.shared.authorizationStatus == .approved else {
                        self.busy = false; self.finish(ProductResponse(status: "error", code: "selection-required"), complete); return
                    }
                    let response: ProductResponse
                    do {
                        let ref = try await ProductController.shared.selectionSaved(data, authorizationEpoch: pickerEpoch)
                        var saved = await ProductController.shared.perform("snapshot", request: ProductRequest(), authorizationEpoch: self.authorizationEpoch)
                        if self.authorizationEpoch == pickerEpoch { saved.ref = ref; response = saved }
                        else { response = ProductResponse(status: "error", code: "selection-required", snapshot: saved.snapshot) }
                    } catch { response = ProductResponse(status: "error", code: "selection-required") }
                    self.busy = false; self.finish(response, complete)
                }
            })
            sheet.isModalInPresentation = true // Explicit Save/Cancel remain available at all times.
            picker = sheet; presenter.present(sheet, animated: true)
            return
        }
        if action == "stopLegacy" {
            // Explicitly requested transition. This does not touch/migrate the PoC database.
            ScreenTimePoC.shared.perform("stop", ref: nil, presenter: presenter) { _ in
                self.finish(ProductResponse(), complete)
            }
            return
        }
        let mutates = action != "snapshot" && action != "stop"
        if mutates { busy = true }
        Task { @MainActor in
            defer { if mutates { self.busy = false } }
            if action == "authorize" {
                do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual) }
                catch { self.finish(ProductResponse(status: "error", code: "authorization-required"), complete); return }
            }
            let result = await ProductController.shared.perform(action == "authorize" ? "snapshot" : action, request: request,
                authorizationEpoch: self.authorizationEpoch)
            self.finish(result, complete)
        }
    }

    private func unavailable(_ availability: String, _ complete: (String) -> Void) {
        complete(ProductResponse(status: "error", code: "unavailable", snapshot: ProductSnapshotDTO(availability: availability)).json())
    }
    private func finish(_ result: ProductResponse, _ complete: (String) -> Void) {
        var result = result
        result.legacyActive = legacyActive
        complete(result.json())
    }
    private var legacyActive: Bool {
        let store = ManagedSettingsStore(named: .init("itoma.poc.manual"))
        return !(store.shield.applications ?? []).isEmpty || store.shield.applicationCategories != nil
            || store.shield.webDomains != nil || store.shield.webDomainCategories != nil
    }
}

@available(iOS 16.0, *)
private struct ProductPicker: View {
    @State private var selection = FamilyActivitySelection()
    @State private var finished = false
    let complete: (Data?) -> Void
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Text("制限したいアプリだけを選んでください。カテゴリやWebサイトは対象に含めません。")
                    .font(.body).padding(.horizontal)
                FamilyActivityPicker(selection: $selection)
            }
            .navigationTitle("アプリを選ぶ")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { if !finished { finished = true; complete(nil) } }.disabled(finished) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("選択を保存") { if !finished { finished = true; complete(try? JSONEncoder().encode(Array(selection.applicationTokens))) } }
                        .disabled(finished || selection.applicationTokens.isEmpty || selection.applicationTokens.count > 50
                            || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty)
                }
            }
        }
    }
}
