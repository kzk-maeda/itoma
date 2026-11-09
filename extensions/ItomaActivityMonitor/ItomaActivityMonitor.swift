import DeviceActivity
import ItomaCore
import ItomaStorage
import ItomaControl

// This target deliberately links no Expo/React or private ItomaHistory database.
// OS scheduling and synchronous reconciliation are connected in the next slice.
// Until then no activity is registered, and no callback claims an OS write.
final class ItomaActivityMonitor: DeviceActivityMonitor {}
