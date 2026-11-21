import StoreKit
import UIKit

let supportChanged = Notification.Name("ItomaSupportChanged")

struct SupportPrice: Codable, Equatable, Sendable {
    let id: String
    let display: String
    let amount: String
    let currency: String
    let storefront: String

    init(_ product: Product, store: Storefront) {
        id = product.id
        display = product.displayPrice
        amount = NSDecimalNumber(decimal: product.price).stringValue
        currency = product.priceFormatStyle.currencyCode
        storefront = store.id
    }
}

struct SupportReply: Encodable, Sendable {
    var state: String
    var receipt: String?
    var products: [SupportPrice]?
    var canLeavePending = false
}

// Entire file is replaced atomically before finish(). Never placed in the Screen Time App Group.
private struct SupportLedger: Codable {
    struct Attempt: Codable {
        let id: UUID
        let started: Date
        var state: String
    }
    var attempt: Attempt?
    var purchasedProducts: Set<String> = []
    var processed: Set<String> = []
    var unread: [String] = []
}

@MainActor
final class SupportPurchases {
    static let shared = SupportPurchases()
    private let ids = Set(Bundle.main.object(forInfoDictionaryKey: "ITOMASupportProducts") as? [String] ?? [])
    private var ledger: SupportLedger?
    private var listening: Task<Void, Never>?
    private var recovery: Task<Void, Never>?
    private var purchasing = false
    private var unverified: Set<UInt64> = []
    private var storageProblem = false

    private let storageDirectory: URL?
    init(storageDirectory: URL? = nil) { self.storageDirectory = storageDirectory }

    private func file() throws -> URL {
        var directory = try storageDirectory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                    appropriateFor: nil, create: true).appendingPathComponent("ItomaSupport", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        return directory.appendingPathComponent("transactions.json")
    }

    private func read() throws -> SupportLedger {
        if let ledger { return ledger }
        let url = try file()
        do { ledger = try JSONDecoder().decode(SupportLedger.self, from: Data(contentsOf: url)) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { ledger = SupportLedger() }
        guard let ledger else { throw CocoaError(.fileReadCorruptFile) }
        return ledger
    }

    private func save(_ change: (inout SupportLedger) -> Void) throws {
        var next = try read()
        change(&next)
        try JSONEncoder().encode(next).write(to: file(), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        ledger = next
        NotificationCenter.default.post(name: supportChanged, object: nil)
    }

    func start() {
        guard listening == nil else { return }
        listening = Task {
            for await delivery in Transaction.updates { await self.handle(delivery) }
        }
        _ = recover()
    }

    private func recover() -> Task<Void, Never> {
        if let recovery { return recovery }
        let task = Task {
            for await delivery in Transaction.unfinished { await self.handle(delivery) }
            self.recovery = nil
        }
        recovery = task
        return task
    }

    private func handle(_ delivery: VerificationResult<Transaction>) async {
        switch delivery {
        case .unverified(let transaction, _):
            if ids.contains(transaction.productID) || (try? read().purchasedProducts.contains(transaction.productID)) == true {
                unverified.insert(transaction.id)
                NotificationCenter.default.post(name: supportChanged, object: nil)
            }
        case .verified(let transaction):
            guard transaction.productType == .consumable,
                  transaction.appBundleID == Bundle.main.bundleIdentifier else { return }
            unverified.remove(transaction.id)
            let key = transaction.environment.rawValue + "/" + String(transaction.id)
            do {
                let previous = try read()
                guard ids.contains(transaction.productID) || previous.purchasedProducts.contains(transaction.productID) else { return }
                let matches = previous.attempt != nil && previous.attempt?.id == transaction.appAccountToken
                let isNew = !previous.processed.contains(key)
                if isNew || matches {
                    try save {
                        if matches { $0.attempt = nil }
                        if isNew {
                            $0.processed.insert(key)
                            if transaction.revocationDate == nil { $0.unread.append(key) }
                        }
                        if transaction.revocationDate != nil { $0.unread.removeAll { $0 == key } }
                    }
                } else if transaction.revocationDate != nil && previous.unread.contains(key) {
                    try save { $0.unread.removeAll { $0 == key } }
                }
                storageProblem = false
                await transaction.finish()
            } catch { storageProblem = true }
            NotificationCenter.default.post(name: supportChanged, object: nil)
        }
    }

    private func snapshot() throws -> SupportReply {
        let value = try read()
        if let receipt = value.unread.first { return SupportReply(state: "verified", receipt: receipt) }
        if storageProblem || !unverified.isEmpty { return SupportReply(state: "unknown") }
        if purchasing { return SupportReply(state: "buying") }
        if let attempt = value.attempt {
            return SupportReply(state: attempt.state, canLeavePending: Date().timeIntervalSince(attempt.started) >= 86400)
        }
        return SupportReply(state: "idle")
    }

    private func catalog() async throws -> [(Product, SupportPrice)] {
        guard !ids.isEmpty, let store = await Storefront.current, store.countryCode == "JPN" else { return [] }
        let products = try await Product.products(for: ids)
        guard await Storefront.current?.id == store.id else { return [] }
        return products.filter { $0.type == .consumable && ids.contains($0.id) }
            .sorted { ($0.price, $0.id) < ($1.price, $1.id) }.map { ($0, SupportPrice($0, store: store)) }
    }

    private func buy(_ quote: SupportPrice) async throws -> SupportReply {
        guard try snapshot().state == "idle" else { return try snapshot() }
        purchasing = true
        defer {
            purchasing = false
            NotificationCenter.default.post(name: supportChanged, object: nil)
        }
        let available: [(Product, SupportPrice)]
        do { available = try await catalog() }
        catch { return SupportReply(state: "offline") }
        guard let (product, _) = available.first(where: { $0.1 == quote }) else {
            return SupportReply(state: "changed", products: available.map { $0.1 })
        }
        // A deferred transaction may have arrived during the catalog request.
        let current = try read()
        guard current.unread.isEmpty, current.attempt == nil, !storageProblem, unverified.isEmpty else { return try snapshot() }
        let attempt = SupportLedger.Attempt(id: UUID(), started: Date(), state: "unknown")
        try save {
            $0.attempt = attempt
            $0.purchasedProducts.insert(product.id)
        }
        let result: Product.PurchaseResult
        do {
            let options: Set<Product.PurchaseOption> = [.appAccountToken(attempt.id)]
            if #available(iOS 17.0, *) {
                guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                    try save { $0.attempt = nil }
                    return SupportReply(state: "unavailable")
                }
                result = try await product.purchase(confirmIn: scene, options: options)
            } else {
                result = try await product.purchase(options: options)
            }
        } catch StoreKitError.userCancelled {
            if try read().attempt?.id == attempt.id { try save { $0.attempt = nil } }
            return SupportReply(state: "cancelled")
        } catch {
            // Delivery can still arrive via updates. Reconciliation never starts a second purchase.
            return SupportReply(state: "unknown")
        }
        switch result {
        case .success(let delivery):
            await handle(delivery)
        case .pending, .userCancelled:
            if try read().attempt?.id == attempt.id {
                if case .pending = result { try save { $0.attempt?.state = "pending" } }
                else { try save { $0.attempt = nil }; return SupportReply(state: "cancelled") }
            }
        @unknown default: return SupportReply(state: "unknown")
        }
        purchasing = false
        return try snapshot()
    }

    func request(_ action: String, value: String) async throws -> SupportReply {
        start()
        switch action {
        case "load":
            await recovery?.value
            let status = try snapshot()
            guard status.state == "idle" else { return status }
            let products = try await catalog().map { $0.1 }
            var reply = try snapshot()
            reply.products = products
            return reply
        case "buy":
            guard let quote = try? JSONDecoder().decode(SupportPrice.self, from: Data(value.utf8)) else {
                return SupportReply(state: "changed")
            }
            return try await buy(quote)
        case "retry":
            await recover().value
            return try snapshot()
        case "ack":
            if try read().unread.first == value { try save { $0.unread.removeFirst() } }
        case "leavePending":
            if try snapshot().canLeavePending { try save { $0.attempt = nil } }
        default: break
        }
        return try snapshot()
    }
}
