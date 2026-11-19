import DeviceActivity
import ItomaCore
import ItomaStorage
import ItomaControl
import ItomaScreenTime
import Dispatch

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
        guard name.hasPrefix("itoma.rule.") || (name.hasPrefix("itoma.deadline.") && ended) else { return }
        // Sample main before the synchronous actor join. Never main.sync from the actor.
        let authorization = AppleAuthorizationObservations.readForActivityCallback()
        NormalRuleDiagnostics.callback(name: name, ended: ended, authorization: authorization)
        let completed = DispatchSemaphore(value: 0)
        Task.detached { @ItomaControlActor in
            ScreenTimeRuntime.handleActivity(name, ended: ended, authorization: authorization)
            completed.signal()
        }
        completed.wait()
    }
}
