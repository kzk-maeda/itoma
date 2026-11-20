import Dispatch
import Foundation
import ItomaCore
import ItomaControl
import Testing

private func observation(_ status: AuthorizationStatus) throws -> AuthorizationObservation {
    AuthorizationObservation(status: status, observedAt: try Instant(secondsSince1970: 100))
}

@Test func mainCallbackReadsInlineWithoutEnqueueOrMainQueueJoin() throws {
    let denied = try observation(.denied)
    let value = CallbackAuthorizationRead.run(isMainThread: true,
        enqueue: { _ in Issue.record("A main callback must not wait for its own queue") }, read: { denied })
    #expect(value == denied)
}

@Test func workerCallbackUsesMainObservationWithoutChangingUnknownToApproved() throws {
    let raw = try observation(.unknown)
    let queue = DispatchQueue(label: "itoma.test.authorization.main")
    let value = CallbackAuthorizationRead.run(isMainThread: false, timeout: .seconds(1),
        enqueue: { work in queue.async(execute: work) }, read: { raw })
    #expect(value == raw)
}

@Test func timeoutIsUnreadAndLateClosureCannotProduceAnObservation() throws {
    let raw = try observation(.approved)
    let queue = DispatchQueue(label: "itoma.test.authorization.blocked")
    queue.suspend()
    let value = CallbackAuthorizationRead.run(isMainThread: false, timeout: .milliseconds(1),
        enqueue: { work in queue.async(execute: work) },
        read: { Issue.record("Timed-out work must not be used as a later observation"); return raw })
    #expect(value == nil)
    queue.resume()
    queue.sync {} // Drain delayed work; the closed window skips the read.
}
