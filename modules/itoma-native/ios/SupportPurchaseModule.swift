import ExpoModulesCore
import UIKit

public final class SupportPurchaseSubscriber: ExpoAppDelegateSubscriber {
    public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Task { @MainActor in SupportPurchases.shared.start() }
        return true
    }
}

public final class SupportPurchaseModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ItomaSupport")
        Events("supportChanged")
        OnStartObserving("supportChanged") {
            NotificationCenter.default.addObserver(self, selector: #selector(self.changed), name: supportChanged, object: nil)
        }
        OnStopObserving("supportChanged") { NotificationCenter.default.removeObserver(self, name: supportChanged, object: nil) }
        AsyncFunction("request") { (action: String, value: String) async throws -> String in
            let reply = try await SupportPurchases.shared.request(action, value: value)
            return String(decoding: try JSONEncoder().encode(reply), as: UTF8.self)
        }
    }

    @objc private func changed(_ notification: Notification) { sendEvent("supportChanged") }
}
