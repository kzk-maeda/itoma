import DeviceActivity
import ItomaCore
import ItomaStorage
import ItomaControl
import ItomaScreenTime
import Dispatch
import Foundation

// This target links no Expo/React/private history. DeviceActivity's callbacks are synchronous.
// The detached native actor job performs only bounded synchronous database/own-store operations.
// Join it before returning: the OS may terminate the Extension immediately after the callback.
final class ItomaActivityMonitor: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity); reconcile(activity, ended: false)
    }
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity); reconcile(activity, ended: true)
    }
    private func reconcile(_ activity: DeviceActivityName, ended: Bool) {
        let name = activity.rawValue
        let kind = ScreenTimeDiagnostics.activity(name)
        let started = ProcessInfo.processInfo.systemUptime
        ScreenTimeDiagnostics.record(.callbackEntry, activity: kind, ended: ended)
        // Before the actor job/join, with no Control transaction held. Probe owns no OS writes.
        if kind == .rule || (kind == .deadline && ended) {
            MainQueueAuthorizationProbe.runIfEnabled(activity: kind, ended: ended)
        }
        let completed = DispatchSemaphore(value: 0)
        Task.detached { @ItomaControlActor in
            ScreenTimeDiagnostics.record(.actorEntry, activity: kind, ended: ended)
            ScreenTimeRuntime.handleActivity(name, ended: ended)
            completed.signal()
        }
        completed.wait()
        ScreenTimeDiagnostics.record(.callbackExit, activity: kind, ended: ended,
            elapsedMilliseconds: Int((ProcessInfo.processInfo.systemUptime - started) * 1000))
    }
}
