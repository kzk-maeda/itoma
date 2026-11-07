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

/// Initial bridge proof only. No authorization, OS restriction, or repository is opened here.
public final class ItomaNativeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ItomaNative")
        Constant("apiVersion") { 1 }
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
