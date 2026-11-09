# Screen Time native runtime

## CNG foundation (#125) and runtime (#127)

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

The foundation PR #126 only generates/builds the target. #127 connects the shared
`ItomaScreenTime` pod and typed product bridge; normal application UI follows.
The existing `itoma.poc.manual` store and private PoC database are separate;
tokens are not silently migrated and that store is never automatically cleared.

Unsigned Simulator QA enables this target with `group.com.example.itoma`, checks
the embedded `.appex`/extension point and dynamic dependency list, and records the
generated configuration digest. Static dependency isolation is checked through
the Podfile declaration and its Core/Storage/Control/ScreenTime dependency closure, rather
than inferred from `otool -L` alone. This placeholder grants no real App Group
access. API receipts, callbacks after termination/reboot, shared-file protection,
and real app shielding remain physical-device gates (#48–#52).

## Boundary and deadline adapters

The host exclusively creates the shared Control schema6 DB and a separate
PolicyMonitor schema1 SQLite journal. The Extension opens existing stores only.
Both use the same Core evaluator and Control actor; private History schema2 is
host-only with **Complete** protection for its directory/DB/WAL/SHM. Only shared
control/monitor files use UntilFirstUserAuthentication protection and
backup exclusion. This source setup does not prove access before first unlock,
protected-data behavior or coordination on a physical device.

Each distinct enabled-rule start/end minute has a repeating **daily 15-minute
monitor beginning at that boundary**. Both interval callbacks reevaluate the
latest policy, including its weekday/overnight/DST/priority rules. The extra end
callback is harmless. This avoids treating Core's finite query horizon as an OS
wakeup, relying on undocumented weekly-repeat matching, or rejecting a short
rule only because Apple's monitoring minimum is 15 minutes. Registration counts,
closely spaced activities, timezone changes and missed/late callbacks still need
real-device verification. Rejection leaves the old active policy and monitors.

Plan preparation is durable before each OS call, with separate receipt commits.
A partial plan cannot activate a candidate. `previewCandidate` and
`executeAcceptedCandidate` preserve P2's confirmation and grant-deadline ordering.
Old monitors are stopped only after the new policy commits and its complete
plan is observed. The journal deletes an old plan only after **all** its activities
are absent. Startup can restore configured policy monitoring; it never silently
retries an unlock command.

The grant adapter registers a one-shot absolute interval ending at Core's fixed
deadline. To represent grants shorter than 15 minutes, the interval starts in
the past; `intervalDidStart` is deliberately ignored for grant monitors. Core
context and receipt timestamps share second precision so a receipt cannot appear
later than an immediately following context merely because of different
precision. Calendar serialization does not round a deadline later. Confirmation
captures an absolute expiry cap and exact reason in native RAM; acceptance may
shorten, never extend that cap. The optional cap is also bound into the immutable
shared request intent (without the reason). Old intents with no cap still decode.
An API receipt is not delivery/timing proof.
Any registration failure prevents new unshielding (P1). A physical-device PoC
must accept/reject this representation and measure early/late delivery; no JS
timer substitutes for an unavailable OS deadline.

The synchronous OS callback joins an independent native actor job before
returning. Its critical path contains synchronous SQLite transactions (100ms
busy timeout) and short own-store writes, with no network/prompt/await. Async
obsolete-monitor cleanup is left for the host. Tokens are strictly decoded into
an immutable registry **outside** Control's final writer. Missing/ambiguous token
identities or aggregates exceeding the OS application limit fail before an OS
write; no compactMap silently loses a target. New grants/candidates require
complete policy monitoring. Current-state reconciliation and explicit stop try
their own-store operation even when the policy journal or registration fails;
future-schedule readiness is reported separately. The journal is opened lazily,
so it cannot prevent a stop backed by a healthy Control DB. The host may rebuild
a missing derived monitor journal; a corrupt journal is never reset. Stale callbacks only reevaluate
current durable policy, never replay a captured old plan.

Explicit stop clears `itoma.product` under durable paused intent. Early return
retires just the chosen grant before reconciliation; duplicates cannot end a
later grant or another app's grant. Authorization denial invalidates grants and
requires explicit resume/new selection after approval. Native authorization
epochs invalidate confirmation资格 even when approval returns before the actor
handles the captured denial. Revocation/reapproval
entirely between observations remains an unverified platform limitation.

## Build-only bounds and product bridge

There are no shipping capacity defaults. Opt-in builds must explicitly supply
`ITOMA_HISTORY_WARNING_BYTES`, `ITOMA_HISTORY_MAXIMUM_BYTES`, and
`ITOMA_PENDING_EVENT_LIMIT`; the plugin validates and injects them. CI uses the
**experimental** 80/100MiB and 10,000-event candidates solely for QA. The final
release capacity remains a measurement/review gate (#42).

`screenTimeVersion=1` gates the typed bridge. Snapshots contain safe references,
counts, settings, bounded observations and absolute deadlines. Native Apple
Labels display app identity; neither identity data nor reasons appear in RN
events, URLs or logs. The confirmed reason is committed privately via
`acceptReasonGrant` before the shared grant command, then existing
`executeAcceptedGrant` enforces P1. Review/cancel keeps drafts outside storage.
Command disposition and durable command status jointly determine success;
`requiresExplicitRetry` is never returned as successful merely because its
failure field is nil. Failed/uncertain grants retain their command identity,
status and fixed deadline in snapshots, with explicit retry/end operations.
Saving settings is distinguished from OS application. Unsupported builds and
Simulator return explicit unavailable snapshots and perform no product I/O.

An active legacy manual PoC store prevents product activation/unlock/resume
until the user explicitly stops that store. It is not silently cleared, and
its selection/token DB is never imported into the product database.

Sources: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/),
[config plugins](https://docs.expo.dev/config-plugins/plugins/),
[Apple DeviceActivityMonitor](https://developer.apple.com/documentation/deviceactivity/deviceactivitymonitor).
