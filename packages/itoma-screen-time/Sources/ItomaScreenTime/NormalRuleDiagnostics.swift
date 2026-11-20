import Foundation
import OSLog
import ItomaCore
import ItomaControl

/// Fixed vocabulary only. No rule/activity/command identifiers, tokens, reasons or raw errors.
public enum NormalRuleDiagnostics {
    private static let logger = Logger(subsystem: "itoma.screen-time", category: "normal-rules")
    public static func callback(name: String, ended: Bool, authorization: AuthorizationObservation?) {
        let kind = name.hasPrefix("itoma.deadline.") ? "deadline" : "rule"
        let raw = authorization?.status.rawValue ?? "notRead"
        logger.notice("v=1 phase=callback role=extension kind=\(kind, privacy: .public) ended=\(ended) authorization=\(raw, privacy: .public) main=\(Thread.isMainThread)")
    }
    static func result(_ result: ReconciliationResult) {
        let disposition = String(describing: result.disposition)
        let failure = result.failure?.rawValue ?? "none"
        logger.notice("v=1 phase=reconciliation role=extension result=\(disposition, privacy: .public) failure=\(failure, privacy: .public)")
    }
    static func unavailable() {
        logger.notice("v=1 phase=runtime role=extension result=unavailable")
    }
}
