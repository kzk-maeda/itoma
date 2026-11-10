import ExpoModulesCore
import Darwin
import Foundation
import ItomaCore
import ItomaStorage
import ItomaControl
import ItomaHistory

struct DurationValidationRecord: Record {
    @Field var status: String = "error"
    @Field var minutes: Int? = nil
    @Field var code: String? = nil
}

/// The product bridge remains separate from the explicitly invoked manual Screen Time PoC.
public final class ItomaNativeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ItomaNative")
        Constant("apiVersion") { 1 }
        Constant("screenTimePoCUIVersion") { 2 }
        Constant("screenTimeVersion") { 1 }
        Constant("historyVersion") { 1 }
        Constant("reflectionVersion") { 1 }
        View(SavedApplicationsView.self) {
            Events("onContentSize", "onSelect")
            Prop("selectionRef") { (view: SavedApplicationsView, ref: String) in
                view.selectionRef = ref
            }
            Prop("refreshKey") { (view: SavedApplicationsView, value: Int) in
                view.refreshKey = value
            }
            Prop("source") { (view: SavedApplicationsView, source: String) in view.source = source }
            Prop("targetRef") { (view: SavedApplicationsView, target: String) in view.targetRef = target }
            Prop("selectable") { (view: SavedApplicationsView, value: Bool) in view.selectable = value }
            Prop("selected") { (view: SavedApplicationsView, value: Bool) in view.selected = value }
        }
        AsyncFunction("screenTimePoC") { (action: String, selectionRef: String?, promise: Promise) in
            // Expo's AppContext is Sendable; the Module itself must not cross actor isolation.
            let context = self.appContext
            MainActor.assumeIsolated {
                guard #available(iOS 16.0, *) else {
                    promise.resolve(#"{"availability":"unsupported-os","authorization":"unknown","storage":"not-created","selections":[],"operation":"failed","code":"unavailable","observation":"unknown"}"#)
                    return
                }
                ScreenTimePoC.shared.perform(action, ref: selectionRef,
                    presenter: context?.utilities?.currentViewController()) { result in
                    // Serialize on the actor that owns the dictionary. Only a value-type String
                    // crosses Expo's sending Promise API; no mutable Any graph crosses runtimes.
                    do {
                        let data = try JSONSerialization.data(withJSONObject: result)
                        guard let json = String(data: data, encoding: .utf8) else {
                            promise.reject("ERR_ITOMA_POC_RESPONSE", "Native PoC response unavailable"); return
                        }
                        promise.resolve(json)
                    } catch { promise.reject("ERR_ITOMA_POC_RESPONSE", "Native PoC response unavailable") }
                }
            }
        }.runOnQueue(.main)
        AsyncFunction("screenTime") { (action: String, payload: String?, promise: Promise) in
            let context = self.appContext
            MainActor.assumeIsolated {
                guard #available(iOS 16.0, *) else {
                    promise.resolve(#"{"status":"error","code":"unavailable"}"#); return
                }
                ProductUI.shared.perform(action, payload: payload, presenter: context?.utilities?.currentViewController()) { json in
                    promise.resolve(json)
                }
            }
        }.runOnQueue(.main)
        AsyncFunction("history") { (action: String, payload: String?, promise: Promise) in
            MainActor.assumeIsolated {
                guard #available(iOS 16.0, *) else {
                    promise.resolve(#"{"status":"error","code":"unavailable","storage":"unknown"}"#); return
                }
                ProductUI.shared.performHistory(action, payload: payload) { promise.resolve($0) }
            }
        }.runOnQueue(.main)
        AsyncFunction("reflection") { (action: String, payload: String?, promise: Promise) in
            MainActor.assumeIsolated {
                guard #available(iOS 16.0, *) else {
                    promise.resolve(#"{"status":"error","code":"unavailable","storage":"unknown","transfer":"unavailable"}"#); return
                }
                ProductUI.shared.performReflection(action, payload: payload) { promise.resolve($0) }
            }
        }.runOnQueue(.main)
        Function("validateDuration") { (minutes: Int) -> DurationValidationRecord in
            var record = DurationValidationRecord()
            do {
                let duration = try UnlockDuration(minutes: minutes)
                record.status = "valid"; record.minutes = duration.minutes
            } catch ModelError.invalidUnlockDuration {
                record.status = "invalid"; record.code = "invalid-duration"
            } catch {
                record.status = "error"; record.code = "native-error"
            }
            return record
        }
        // Explicit QA opt-in in BOTH JS bundle and native launch environment. Only a synthetic
        // commit/boolean is accepted, never user data. Normal app launches cannot emit this marker.
        Function("reportSmokeResult") { (commit: String, passed: Bool) -> Bool in
            guard ProcessInfo.processInfo.environment["ITOMA_NATIVE_QA"] == "1",
                  commit.utf8.count == 40,
                  commit.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil else { return false }
            print("ITOMA_NATIVE_SMOKE_\(passed ? "PASS" : "FAIL"):\(commit)")
            fflush(nil)
            return true
        }
    }
}
