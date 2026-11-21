import StoreKitTest
import XCTest
@testable import SupportHost

@MainActor
final class SupportTests: XCTestCase {
    func testPurchasingAndRecoveringVerifiedConsumables() async throws {
        let file = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Support", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: file)
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        session.storefront = "JPN"

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let backup = directory.appendingPathExtension("saved")
        let controller = SupportPurchases(storageDirectory: directory)
        let initial = try await controller.request("load", value: "")
        let prices = try XCTUnwrap(initial.products)
        XCTAssertEqual(prices.map(\.id), ["itoma.test.tip.1", "itoma.test.tip.2", "itoma.test.tip.3"])
        let price = try XCTUnwrap(prices.first)
        let data = try JSONEncoder().encode(price)
        let quote = String(decoding: data, as: UTF8.self)
        var changed = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        changed["display"] = "old price"
        let stale = String(decoding: try JSONSerialization.data(withJSONObject: changed), as: UTF8.self)
        let refused = try await controller.request("buy", value: stale)
        XCTAssertEqual(refused.state, "changed")
        XCTAssertEqual(session.allTransactions().count, 0)

        let first = try await controller.request("buy", value: quote)
        XCTAssertEqual(first.state, "verified")
        let firstID = try XCTUnwrap(first.receipt)
        let blocked = try await controller.request("buy", value: quote)
        XCTAssertEqual(blocked.receipt, firstID)
        XCTAssertEqual(session.allTransactions().count, 1)
        _ = try await controller.request("ack", value: firstID)

        session.askToBuyEnabled = true
        let pending = try await controller.request("buy", value: quote)
        XCTAssertEqual(pending.state, "pending")
        let pendingAgain = try await controller.request("buy", value: quote)
        XCTAssertEqual(pendingAgain.state, "pending")
        let last = try XCTUnwrap(session.allTransactions().max { $0.identifier < $1.identifier })
        // Simulate failure after Apple approves but before the durable receipt can be written.
        try FileManager.default.moveItem(at: directory, to: backup)
        try Data().write(to: directory)
        try session.approveAskToBuyTransaction(identifier: last.identifier)
        var failedSafely = false
        for _ in 0..<100 {
            if try await controller.request("status", value: "").state == "unknown" {
                failedSafely = true
                break
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertTrue(failedSafely, "Storage failure must not produce a success or finish the purchase")
        try FileManager.default.removeItem(at: directory)
        try FileManager.default.moveItem(at: backup, to: directory)
        _ = try await controller.request("retry", value: "")
        for _ in 0..<100 {
            let reply = try await controller.request("status", value: "")
            if reply.state == "verified" {
                XCTAssertNotEqual(try XCTUnwrap(reply.receipt), firstID)
                _ = try await controller.request("ack", value: try XCTUnwrap(reply.receipt))
                // No more writes on the original coordinator. Read the durable state afresh.
                let restored = try await SupportPurchases(storageDirectory: directory).request("load", value: "")
                XCTAssertEqual(restored.state, "idle")
                return
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTFail("An approved deferred purchase should be delivered while the support screen is closed")
    }
}
