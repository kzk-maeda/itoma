import Foundation
import Dispatch

// Standalone observation lifecycle. No Screen Time, storage, permissions or restriction APIs.
enum ProbeAuthorization: String, Sendable { case approved, denied, notDetermined, unrecognized }

final class AuthorizationProbeWindow: @unchecked Sendable {
    // All mutable fields are protected by lock. Never hold it around an OS property read/cancel.
    private let lock = NSLock()
    private let signal = DispatchSemaphore(value: 0)
    private var started = false
    private var closed = false
    private var last: ProbeAuthorization?
    private var emitted = 0
    private var cancellation: (@Sendable () -> Void)?
    private let trace: @Sendable (ProbeAuthorization, Bool, Int) -> Void

    struct Outcome: Sendable {
        enum End: Sendable { case skippedMainThread, resolved, timedOut }
        let end: End
        let last: ProbeAuthorization?
        let events: Int
    }

    init(trace: @escaping @Sendable (ProbeAuthorization, Bool, Int) -> Void) { self.trace = trace }

    func beginRead() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !closed, !started else { return false }
        started = true
        return true
    }

    func observe(_ status: ProbeAuthorization, initial: Bool) {
        lock.lock()
        guard started, !closed else { lock.unlock(); return }
        last = status
        // At most four fixed diagnostic records per callback, even with a noisy publisher.
        if emitted < 4 {
            emitted += 1
            trace(status, initial, emitted)
        }
        lock.unlock()
        if status == .approved || status == .denied { signal.signal() }
    }

    func installCancellation(_ cancel: @escaping @Sendable () -> Void) {
        lock.lock()
        if closed { lock.unlock(); cancel(); return }
        cancellation = cancel
        lock.unlock()
    }

    private func finish(_ end: Outcome.End) -> Outcome {
        lock.lock()
        closed = true
        let outcome = Outcome(end: end, last: last, events: emitted)
        let cancel = cancellation; cancellation = nil
        lock.unlock()
        cancel?()
        return outcome
    }

    static func run(isMainThread: Bool, timeout: DispatchTimeInterval,
                    enqueue: @Sendable (@escaping @Sendable () -> Void) -> Void,
                    observe: @escaping @Sendable (AuthorizationProbeWindow) -> Void,
                    trace: @escaping @Sendable (ProbeAuthorization, Bool, Int) -> Void) -> Outcome {
        // Never block main waiting for a job that requires main to run.
        if isMainThread { return Outcome(end: .skippedMainThread, last: nil, events: 0) }
        let window = AuthorizationProbeWindow(trace: trace)
        enqueue {
            // A timed-out, not-yet-started job must not initialize AuthorizationCenter later.
            guard window.beginRead() else { return }
            observe(window)
        }
        let completed = window.signal.wait(timeout: .now() + timeout) == .success
        // Closing the gate rejects queued notifications. This never starts control work.
        return window.finish(completed ? .resolved : .timedOut)
    }
}
