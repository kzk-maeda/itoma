import Foundation
import Dispatch

private final class Box<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T
    init(_ value: T) { self.value = value }
    func access<R>(_ work: (inout T) -> R) -> R {
        lock.lock(); defer { lock.unlock() }; return work(&value)
    }
}

@main struct WindowTests {
    static func main() {
        var checks = 0
        func check(_ value: @autoclosure () -> Bool) { precondition(value()); checks += 1 }
        let calls = Box(0)
        let skipped = AuthorizationProbeWindow.run(isMainThread: true, timeout: .milliseconds(1),
            enqueue: { _ in calls.access { $0 += 1 } }, observe: { _ in calls.access { $0 += 1 } },
            trace: { _, _, _ in calls.access { $0 += 1 } })
        check(skipped.events == 0 && skipped.last == nil)
        check(calls.access { $0 } == 0) // Main callback must not queue a job and wait on itself.

        let pending = Box<(@Sendable () -> Void)?>(nil)
        let timed = AuthorizationProbeWindow.run(isMainThread: false, timeout: .milliseconds(0),
            enqueue: { work in pending.access { $0 = work } }, observe: { _ in calls.access { $0 += 1 } },
            trace: { _, _, _ in calls.access { $0 += 1 } })
        check(timed.events == 0 && timed.last == nil)
        pending.access { $0 }?() // Queued read after return must never initialize OS state.
        check(calls.access { $0 } == 0)

        for status in [ProbeAuthorization.approved, .denied] {
            let cancelled = Box(0)
            let outcome = AuthorizationProbeWindow.run(isMainThread: false, timeout: .milliseconds(20),
                enqueue: { $0() }, observe: { window in
                    window.installCancellation { cancelled.access { $0 += 1 } }
                    window.observe(.notDetermined, initial: true)
                    window.observe(status, initial: false)
                }, trace: { _, _, _ in })
            check(outcome.last == status && outcome.events == 2)
            check(cancelled.access { $0 } == 1)
        }

        let retained = Box<AuthorizationProbeWindow?>(nil)
        let records = Box(0)
        let noisy = AuthorizationProbeWindow.run(isMainThread: false, timeout: .milliseconds(0),
            enqueue: { $0() }, observe: { window in
                retained.access { $0 = window }
                for n in 0..<1000 { window.observe(.notDetermined, initial: n == 0) }
            }, trace: { _, _, _ in records.access { $0 += 1 } })
        check(noisy.events == 4 && noisy.last == .notDetermined)
        check(records.access { $0 } == 4)
        retained.access { $0 }?.observe(.approved, initial: false)
        check(records.access { $0 } == 4) // No late observation/log after closed window.
        let lateCancel = Box(0)
        retained.access { $0 }?.installCancellation { lateCancel.access { $0 += 1 } }
        check(lateCancel.access { $0 } == 1) // Covers cancellation installed after early completion.

        let queue = DispatchQueue(label: "itoma.probe.fixture")
        let delivered = AuthorizationProbeWindow.run(isMainThread: false, timeout: .seconds(2),
            enqueue: { work in queue.async(execute: work) }, observe: { window in
                window.observe(.notDetermined, initial: true)
                queue.async { window.observe(.approved, initial: false) }
            }, trace: { _, _, _ in })
        check(delivered.last == .approved && delivered.events == 2)
        print("Authorization probe lifecycle: \(checks) assertions PASS (fake source; no iOS API)")
    }
}
