import Dispatch
import Foundation
import ItomaCore

/// Read on the callback's main queue before joining the Control actor. No database writer is
/// held, no main.sync is used, and a timeout never becomes a fabricated native observation.
public enum CallbackAuthorizationRead {
    public static func run(
        isMainThread: Bool, timeout: DispatchTimeInterval = .milliseconds(250),
        enqueue: @Sendable (@escaping @Sendable () -> Void) -> Void,
        read: @escaping @Sendable () -> AuthorizationObservation
    ) -> AuthorizationObservation? {
        if isMainThread { return read() }
        let window = Window()
        let completed = DispatchSemaphore(value: 0)
        enqueue {
            guard window.isOpen else { return }
            window.resolve(read())
            completed.signal()
        }
        let outcome = completed.wait(timeout: .now() + timeout)
        return window.close(discard: outcome == .timedOut)
    }

    private final class Window: @unchecked Sendable {
        private let lock = NSLock()
        private var open = true
        private var value: AuthorizationObservation?
        var isOpen: Bool { lock.lock(); defer { lock.unlock() }; return open }
        func resolve(_ observation: AuthorizationObservation) {
            lock.lock(); defer { lock.unlock() }
            if open { value = observation }
        }
        func close(discard: Bool) -> AuthorizationObservation? {
            lock.lock(); defer { lock.unlock() }
            open = false
            return discard ? nil : value
        }
    }
}
