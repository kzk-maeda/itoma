import Foundation
import ItomaCore
import ItomaStorage
import ItomaHistory

struct ProductHistoryRequest: Decodable, Sendable {
    var kind: String?
    var day: String?
    var afterAt: Double?
    var afterKey: String?
    var direction: String?
    var revision: String?
    var commandID: String?
}
struct ProductHistoryRow: Encodable, Sendable {
    let key: String
    let at: Double
    let action: String
    let status: String
    var commandID: String?
    var grantStatus: String?
    var expiresAt: Double?
    var reasonDeleted: Bool?
}
struct ProductHistoryCursor: Encodable, Sendable { let at: Double; let key: String }
struct ProductHistoryPage: Encodable, Sendable {
    let revision: String
    let asOf: Double
    let timeZone: String
    let rows: [ProductHistoryRow]
    let next: ProductHistoryCursor?
    let previous: ProductHistoryCursor?
    let logicalBytes: String
    let warningBytes: String
    let maximumBytes: String
    let warningReached: Bool
    let limitReached: Bool
    let databaseBytes: String?
    let walBytes: String?
    let sharedMemoryBytes: String?
    let incomplete: Bool
    let transfer: String
}
struct ProductHistoryReason: Encodable, Sendable {
    let revision: String
    let state: String
    let body: String?
}
struct ProductHistoryResponse: Encodable, Sendable {
    var status = "ok"
    var code: String?
    var storage = "ready"
    var page: ProductHistoryPage?
    var reason: ProductHistoryReason?
    func json() -> String { (try? String(data: JSONEncoder().encode(self), encoding: .utf8)) ?? #"{"status":"error","code":"unavailable","storage":"unknown"}"# }
}

extension ProductController {
    /// No authorization prompt, picker, monitor registration, or restriction mutation is performed.
    func performHistory(_ action: String, request: ProductHistoryRequest) -> ProductHistoryResponse {
        do {
            guard let kind = HistoryRecordKind(rawValue: request.kind ?? "event") else { throw HistoryError.invalidPage }
            let expected: Int64?
            if let raw = request.revision {
                guard let number = Int64(raw), number >= 0, String(number) == raw else { throw HistoryError.invalidPage }
                expected = number
            } else { expected = nil }
            let range = try historyDay(request.day)
            guard request.direction == nil || ["older", "newer"].contains(request.direction!) else { throw HistoryError.invalidPage }
            let cursor: HistoryPageKey?
            if request.afterAt != nil || request.afterKey != nil {
                guard let at = request.afterAt, let key = request.afterKey, UUID(uuidString: key) != nil, expected != nil else { throw HistoryError.invalidPage }
                cursor = HistoryPageKey(at: try Instant(secondsSince1970: at), key: key)
            } else { cursor = nil }
            return try withHistory(createIfMissing: false) { history in
                if action == "reason" {
                    guard let raw = request.commandID, let id = UUID(uuidString: raw) else { throw HistoryError.invalidPage }
                    let detail = try history.readReason(for: CommandID(id), expectedRevision: expected)
                    let state: String
                    if let reason = detail.reason {
                        if reason.isDeleted { state = "deleted" }
                        else if let control = try? open().repository {
                            switch try? history.reconcileReason(for: CommandID(id), in: control) {
                            case .preparedOnly: state = "prepared-only"
                            case .sharedAccepted: state = "shared-accepted"
                            default: state = "unavailable"
                            }
                        } else { state = "unavailable" }
                    } else { state = "missing" }
                    return ProductHistoryResponse(reason: ProductHistoryReason(revision: String(detail.revision), state: state, body: detail.reason?.body))
                }
                switch action {
                case "page": break
                case "deleteReasons": try history.deleteReasons()
                case "deleteHistory": try history.deleteHistory(from: open().repository)
                case "import": _ = try open().repository.transferHistory(to: history, limit: 500)
                default: throw HistoryError.invalidPage
                }
                // Snapshot is private-DB consistent. Shared pending/gap is a separate bounded sample.
                let page = try history.readPage(kind: kind,
                    after: action == "page" && request.direction != "newer" ? cursor : nil,
                    before: action == "page" && request.direction == "newer" ? cursor : nil,
                    expectedRevision: action == "page" ? expected : nil, from: range?.0, until: range?.1)
                var transfer = "unavailable", controlGap = false
                if let repository = try? open().repository {
                    do {
                        let batch = try repository.historyBatch(limit: 1)
                        transfer = batch.entries.isEmpty ? "current" : "pending"
                        controlGap = batch.boundary.historyIncomplete
                    } catch { transfer = "unavailable" }
                }
                let rows = page.rows.map { row -> ProductHistoryRow in
                    if let record = row.record {
                        switch record {
                        case let .control(event):
                            return ProductHistoryRow(key: row.key.lowercased(), at: row.occurredAt.secondsSince1970,
                                action: event.command.kind.rawValue, status: event.command.status.rawValue,
                                commandID: event.command.id.rawValue.uuidString.lowercased(), grantStatus: event.grant?.status.rawValue,
                                expiresAt: event.grant?.effectiveExpiresAt.secondsSince1970)
                        case .cancelled: return ProductHistoryRow(key: row.key.lowercased(), at: row.occurredAt.secondsSince1970, action: "cancelled", status: "cancelled")
                        }
                    }
                    return ProductHistoryRow(key: row.key.lowercased(), at: row.occurredAt.secondsSince1970,
                        action: "reason", status: "prepared", commandID: row.commandID?.rawValue.uuidString.lowercased(), reasonDeleted: row.reasonDeleted)
                }
                let usage = history.fileUsage()
                guard let warning = Bundle.main.object(forInfoDictionaryKey: "ITOMAHistoryWarningBytes") as? Int64,
                      let maximum = Bundle.main.object(forInfoDictionaryKey: "ITOMAHistoryMaximumBytes") as? Int64 else { throw HistoryError.invalidCapacity }
                return ProductHistoryResponse(page: ProductHistoryPage(revision: String(page.revision), asOf: Date().timeIntervalSince1970,
                    timeZone: TimeZone.current.identifier, rows: rows,
                    next: page.next.map { ProductHistoryCursor(at: $0.at.secondsSince1970, key: $0.key.lowercased()) },
                    previous: page.previous.map { ProductHistoryCursor(at: $0.at.secondsSince1970, key: $0.key.lowercased()) },
                    logicalBytes: String(page.capacity.logicalPayloadBytes), warningBytes: String(warning), maximumBytes: String(maximum),
                    warningReached: page.capacity.warningReached, limitReached: page.capacity.limitReached,
                    databaseBytes: usage.databaseBytes.map { String($0) }, walBytes: usage.walBytes.map { String($0) }, sharedMemoryBytes: usage.sharedMemoryBytes.map { String($0) },
                    incomplete: page.incomplete || controlGap, transfer: transfer))
            }
        } catch HistoryError.missingDatabase { return ProductHistoryResponse(storage: "not-created") }
        catch HistoryError.conflict { return ProductHistoryResponse(status: "error", code: "changed", storage: "unknown") }
        catch HistoryError.invalidPage { return ProductHistoryResponse(status: "error", code: "invalid-input", storage: "unknown") }
        catch HistoryError.capacityExceeded { return ProductHistoryResponse(status: "error", code: "capacity-full", storage: "unknown") }
        catch HistoryError.busy { return ProductHistoryResponse(status: "error", code: "busy", storage: "unknown") }
        catch { return ProductHistoryResponse(status: "error", code: "storage-failed", storage: "unknown") }
    }

    private func historyDay(_ text: String?) throws -> (Instant, Instant)? {
        guard let text, !text.isEmpty else { return nil }
        guard text.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { throw HistoryError.invalidPage }
        let numbers = text.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = .current
        guard numbers.count == 3, (1900...9998).contains(numbers[0]),
              let date = calendar.date(from: DateComponents(year: numbers[0], month: numbers[1], day: numbers[2])),
              calendar.component(.year, from: date) == numbers[0], calendar.component(.month, from: date) == numbers[1],
              calendar.component(.day, from: date) == numbers[2], let day = calendar.dateInterval(of: .day, for: date) else { throw HistoryError.invalidPage }
        return (try Instant(day.start), try Instant(day.end))
    }
}

@available(iOS 16.0, *)
extension ProductUI {
    func performHistory(_ action: String, payload: String?, complete: @escaping (String) -> Void) {
        guard Bundle.main.object(forInfoDictionaryKey: "ITOMAScreenTime") as? Bool == true else {
            complete(ProductHistoryResponse(status: "error", code: "unavailable", storage: "unknown").json()); return
        }
        let request: ProductHistoryRequest
        do { request = try JSONDecoder().decode(ProductHistoryRequest.self, from: Data((payload ?? "{}").utf8)) }
        catch { complete(ProductHistoryResponse(status: "error", code: "invalid-input", storage: "unknown").json()); return }
        Task { let result = await ProductController.shared.performHistory(action, request: request); complete(result.json()) }
    }
}
