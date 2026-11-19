import Dispatch
import FamilyControls
import Foundation
import ItomaCore
import ItomaControl

/// Current-process native observations only; no persisted approval is substituted here.
/// ProductUI publishes main-queue reads/notifications. Control never touches AuthorizationCenter
/// from its custom actor or waits for the main queue while holding a SQLite writer.
public final class AppleAuthorizationObservations: @unchecked Sendable {
    public static let shared = AppleAuthorizationObservations()
    private let lock = NSLock()
    private var observation: AuthorizationObservation?
    private init() {}

    public func current() -> AuthorizationObservation {
        lock.lock(); defer { lock.unlock() }
        return observation ?? AuthorizationObservation(status: .unknown, observedAt: Self.now())
    }

    @MainActor public func refresh() {
        record(AuthorizationCenter.shared.authorizationStatus)
    }

    @MainActor public func record(_ status: FamilyControls.AuthorizationStatus) {
        let value = Self.observation(status)
        lock.lock(); defer { lock.unlock() }
        observation = value
    }

    /// A main-thread callback reads inline before the actor join. A worker callback gives main
    /// at most 250ms; a late read has no authority and cannot mutate a completed evaluation.
    public static func readForActivityCallback() -> AuthorizationObservation? {
        CallbackAuthorizationRead.run(isMainThread: Thread.isMainThread,
            enqueue: { work in DispatchQueue.main.async(execute: work) },
            read: {
                MainActor.assumeIsolated { observation(AuthorizationCenter.shared.authorizationStatus) }
            })
    }

    @MainActor private static func observation(_ value: FamilyControls.AuthorizationStatus) -> AuthorizationObservation {
        let status: ItomaCore.AuthorizationStatus
        switch value {
        case .approved: status = .approved
        case .denied: status = .denied
        case .notDetermined: status = .unknown
        @unknown default: status = .unknown
        }
        return AuthorizationObservation(status: status, observedAt: now())
    }

    private static func now() -> Instant { try! NativeScheduleClock.instant(Date()) }
}
