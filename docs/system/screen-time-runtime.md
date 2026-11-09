# Screen Time native runtime

## CNG foundation (#125)

`ITOMA_SCREEN_TIME=1 ITOMA_APP_GROUP=group.<owner-controlled identifier>` enables
the local `plugins/with-itoma-screen-time.cjs` plugin. The group is an explicit
build input; missing/invalid inputs fail. This source configuration does not
register an App Group, enroll an account, select a Team, change a provisioning
profile, or distribute a build. The owner must configure the corresponding host
and Extension capabilities/profiles for a signed device build.

The plugin generates `ItomaActivityMonitor` with the DeviceActivity monitor
extension point, host embedding/dependency, matching group/Family Controls
entitlements, and an isolated Podfile target. It links Core/Storage/Control,
without Expo, React or the app-private ItomaHistory pod. Repeated prebuild reuses
the target/source/embed phase and preserves existing signing choices. Generated
`ios/` files are disposable; canonical sources live in `plugins/` and `extensions/`.
SDK 58 prebuild recreates native folders by default. Use `expo prebuild --platform
ios --no-install --no-clean` for incremental application and preservation of
existing private signing choices; the test also covers this mode. Any clean
regeneration must use the owner's original config/environment for private values.

The initial foundation registers no activities and performs no callbacks. It is
not evidence of automatic restrictions or completed product functionality.
The next slices connect durable weekday plans, grant deadlines, synchronous
Extension reconciliation, the typed product bridge and normal application UI.
The existing `itoma.poc.manual` store and private PoC database are separate;
tokens are not silently migrated and that store is never automatically cleared.

Unsigned Simulator QA enables this target with `group.com.example.itoma`, checks
the embedded `.appex`/extension point and dynamic dependency list, and records the
generated configuration digest. Static dependency isolation is checked through
the Podfile declaration and its Core/Storage/Control dependency closure, rather
than inferred from `otool -L` alone. This placeholder grants no real App Group
access. API receipts, callbacks after termination/reboot, shared-file protection,
and real app shielding remain physical-device gates (#48–#52).

Sources: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/),
[config plugins](https://docs.expo.dev/config-plugins/plugins/),
[Apple DeviceActivityMonitor](https://developer.apple.com/documentation/deviceactivity/deviceactivitymonitor).
