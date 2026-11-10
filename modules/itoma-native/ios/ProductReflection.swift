import Foundation
import ItomaCore
import ItomaHistory
import ItomaStorage

struct ProductReflectionRequest: Decodable, Sendable {
    struct Clip: Decodable, Sendable { let from: Double; let until: Double }
    var period: String?
    var day: String?
    var expectedToken: String?
    var clippedTo: Clip?
}
struct ProductReflectionResponse: Encodable, Sendable {
    var status = "ok"
    var code: String?
    var storage = "ready"
    var transfer = "unavailable"
    var sharedIncomplete: Bool?
    var snapshot: ReflectionReadSnapshot?
    func json() -> String {
        (try? String(data: JSONEncoder().encode(self), encoding: .utf8))
            ?? #"{"status":"error","code":"unavailable","storage":"unknown","transfer":"unavailable"}"#
    }
}

extension ProductHistoryController {
    /// Private reads/import/deletion only. This never prompts, schedules, shields or unshields.
    func performReflection(_ action: String, request: ProductReflectionRequest) -> ProductReflectionResponse {
        do {
            guard ["read", "import", "deleteAll"].contains(action),
                  let period = ReflectionPrototypePeriod(rawValue: request.period ?? "week"),
                  (request.expectedToken?.utf8.count ?? 0) <= 1_024 else { throw HistoryError.invalidPage }
            let clip = try request.clippedTo.map {
                try ReflectionPrototypeInterval(from: Instant(secondsSince1970: $0.from), until: Instant(secondsSince1970: $0.until))
            }
            // A destructive operation requires a readable shared boundary before private creation.
            let control: ControlRepository? = try action == "read" ? nil : controlRepository()
            if action == "import", let control { try? prepareReflectionCapture(in: control) }
            return try withHistory(createIfMissing: action != "read") { history in
                if action == "import", let control {
                    _ = try control.transferHistory(to: history, limit: 100)
                    try control.transferReflection(to: history, limit: 100)
                }
                if action == "deleteAll", let control {
                    try history.deleteAllRecords(from: control)
                    // Deletion has committed. Baseline failure leaves deleted/unknown, never restores
                    // an old fact or changes a restriction. The point waits in the normal outbox.
                    try? control.recordReflectionBaseline()
                }
                let snapshot = try history.readReflection(period: action == "read" ? period : .week,
                    day: action == "read" ? request.day ?? "" : "", timeZone: TimeZone.current.identifier,
                    expectedToken: action == "read" ? request.expectedToken : nil, clippedTo: action == "read" ? clip : nil)
                var transfer = "unavailable"
                var sharedIncomplete: Bool?
                if let control = try? controlRepository(), let batch = try? control.reflectionBatch(limit: 1) {
                    transfer = batch.facts.isEmpty ? "current" : "pending"
                    sharedIncomplete = batch.boundary.incomplete
                }
                return ProductReflectionResponse(transfer: transfer, sharedIncomplete: sharedIncomplete, snapshot: snapshot)
            }
        } catch HistoryError.missingDatabase { return ProductReflectionResponse(storage: "not-created") }
        catch HistoryError.conflict { return ProductReflectionResponse(status: "error", code: "changed", storage: "unknown") }
        catch HistoryError.invalidPage, ReflectionPrototypeError.invalidInput, ReflectionPrototypeError.invalidInterval {
            return ProductReflectionResponse(status: "error", code: "invalid-input", storage: "unknown")
        } catch HistoryError.capacityExceeded { return ProductReflectionResponse(status: "error", code: "capacity-full", storage: "unknown") }
        catch HistoryError.busy, StorageError.busy { return ProductReflectionResponse(status: "error", code: "busy", storage: "unknown") }
        catch { return ProductReflectionResponse(status: "error", code: "storage-failed", storage: "unknown") }
    }
}

@available(iOS 16.0, *)
extension ProductUI {
    func performReflection(_ action: String, payload: String?, complete: @escaping (String) -> Void) {
        guard Bundle.main.object(forInfoDictionaryKey: "ITOMAScreenTime") as? Bool == true else {
            complete(ProductReflectionResponse(status: "error", code: "unavailable", storage: "unknown").json()); return
        }
        guard (payload?.utf8.count ?? 0) <= 8_192,
              let data = (payload ?? "{}").data(using: .utf8),
              let request = try? JSONDecoder().decode(ProductReflectionRequest.self, from: data) else {
            complete(ProductReflectionResponse(status: "error", code: "invalid-input", storage: "unknown").json()); return
        }
        Task { let result = await ProductHistoryController.shared.performReflection(action, request: request); complete(result.json()) }
    }
}
