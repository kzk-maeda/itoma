import Foundation
import FamilyControls
import SwiftUI
import UIKit
import ItomaScreenTime

private struct DirectProbeResponse: Encodable {
    var status = "ok"
    var code: String?
    var authorization = "unknown"
    var snapshot: DirectProbeSnapshot?
    func json() -> String { String(data: (try? JSONEncoder().encode(self)) ?? Data(), encoding: .utf8) ?? "{}" }
}

@MainActor final class DirectShieldProbeUI {
    static let shared = DirectShieldProbeUI()
    private var busy = false
    private var generation = 0
    private weak var picker: UIViewController?
    private var pickerCompletion: ((String) -> Void)?
    private func finishPicker(_ json: String) {
        let finish = pickerCompletion; pickerCompletion = nil
        finish?(json)
    }
    func cancelPicker() {
        generation &+= 1; picker?.dismiss(animated: true); picker = nil
        finishPicker(DirectProbeResponse(status: "cancelled").json()); busy = false
    }
    func perform(_ action: String, expectedID: String?, presenter: UIViewController?, complete: @escaping (String) -> Void) {
        #if targetEnvironment(simulator)
        complete(DirectProbeResponse(status: "error", code: "unavailable").json()); return
        #endif
        guard Bundle.main.object(forInfoDictionaryKey: "ITOMADirectShieldProbe") as? Bool == true else {
            complete(DirectProbeResponse(status: "error", code: "unavailable").json()); return
        }
        guard !busy || action == "stop" else { complete(DirectProbeResponse(status: "error", code: "busy").json()); return }
        guard ["snapshot", "pick", "arm", "stop"].contains(action) else {
            complete(DirectProbeResponse(status: "error", code: "invalid").json()); return
        }
        if action == "stop" { cancelPicker() }
        let epoch = generation
        busy = true
        Task { @MainActor in
            let authorization: String
            switch AuthorizationCenter.shared.authorizationStatus {
            case .approved: authorization = "approved"
            case .denied: authorization = "denied"
            default: authorization = "unknown"
            }
            if action == "pick" || action == "arm", authorization != "approved" {
                self.busy = false
                complete(DirectProbeResponse(status: "error", code: "authorization-required", authorization: authorization).json()); return
            }
            if action == "pick" {
                guard let presenter, presenter.presentedViewController == nil else {
                    self.busy = false; complete(DirectProbeResponse(status: "error", code: "busy").json()); return
                }
                let previous = try? await DirectShieldProbe.snapshot()
                let data = try? await DirectShieldProbe.displayData()
                guard epoch == self.generation else { self.busy = false; complete(DirectProbeResponse(status: "cancelled").json()); return }
                self.pickerCompletion = complete
                let sheet = UIHostingController(rootView: DirectProbePicker(data: data) { [weak self] selected in
                    guard let self, self.pickerCompletion != nil else { return }
                    self.picker?.dismiss(animated: true); self.picker = nil
                    guard epoch == self.generation, let selected else {
                        self.busy = false; self.finishPicker(DirectProbeResponse(status: "cancelled").json()); return
                    }
                    Task { @MainActor in
                        defer { self.busy = false }
                        guard epoch == self.generation, AuthorizationCenter.shared.authorizationStatus == .approved else {
                            self.finishPicker(DirectProbeResponse(status: "error", code: "authorization-required").json()); return
                        }
                        do {
                            let value = try await DirectShieldProbe.prepare(selected, expectedPreviousID: previous?.id)
                            self.finishPicker(DirectProbeResponse(authorization: "approved", snapshot: value).json())
                        } catch { self.finishPicker(self.failure(error, authorization: authorization).json()) }
                    }
                })
                sheet.isModalInPresentation = true; self.picker = sheet; presenter.present(sheet, animated: true)
                return
            }
            defer { self.busy = false }
            do {
                if action == "stop" || authorization == "denied" { try await DirectShieldProbe.stop() }
                if action == "arm" {
                    guard let expectedID, UUID(uuidString: expectedID) != nil else { throw DirectProbeFailure.invalid }
                    let value = try await DirectShieldProbe.arm(expectedID: expectedID)
                    complete(DirectProbeResponse(authorization: authorization, snapshot: value).json())
                } else {
                    let value = try await DirectShieldProbe.snapshot()
                    complete(DirectProbeResponse(authorization: authorization, snapshot: value).json())
                }
            } catch { complete(self.failure(error, authorization: authorization).json()) }
        }
    }
    private func failure(_ error: Error, authorization: String) -> DirectProbeResponse {
        let code: String
        switch error {
        case DirectProbeFailure.busy: code = "busy"
        case DirectProbeFailure.normalRulesActive: code = "normal-rules-active"
        case DirectProbeFailure.changed: code = "changed"
        case DirectProbeFailure.invalid: code = "invalid"
        default: code = "unavailable"
        }
        return DirectProbeResponse(status: "error", code: code, authorization: authorization)
    }
}

private struct DirectProbePicker: View {
    @State private var selection: FamilyActivitySelection
    @State private var finished = false
    let complete: (Data?) -> Void
    init(data: Data?, complete: @escaping (Data?) -> Void) {
        var value = FamilyActivitySelection()
        if let data, let tokens = try? JSONDecoder().decode([ApplicationToken].self, from: data) { value.applicationTokens = Set(tokens) }
        _selection = State(initialValue: value); self.complete = complete
    }
    var body: some View {
        NavigationStack {
            VStack {
                Text("検証に使って支障のないアプリを1件だけ選んでください。通常ルールで制限していないものを使います。")
                    .font(.body).padding()
                FamilyActivityPicker(selection: $selection)
            }.navigationTitle("検証するアプリ1件")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { finish(nil) } }
                    ToolbarItem(placement: .confirmationAction) { Button("時刻を準備") {
                        finish(try? JSONEncoder().encode(Array(selection.applicationTokens)))
                    }.disabled(selection.applicationTokens.count != 1 || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty || finished) }
                }
        }
    }
    private func finish(_ data: Data?) { guard !finished else { return }; finished = true; complete(data) }
}
