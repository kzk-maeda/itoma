# #154 read lifecycle: current-source reproduction and proposed acceptance

Scope: **design/reproduction only** at main `7642ebf657d97108e6825fef65dbe3a592a38625`. See [Proposed ADR 0008](../../docs/adr/0008-control-read-recovery-maintenance.md) and the [operation/trigger/acceptance contract](../../docs/system/control-read-lifecycle.md). No production read/write API, schema, maintenance scheduler, or CI changes are introduced here.

`run.py` extracts the checked-out `ProductController.refresh` and `ProductRuleDetailsStore.read` method bodies into a throwaway Swift package. Their combined SHA-256 is pinned as `be77cc65a30a1c7e5af5167dcbfa16a96a4d90e2e0cd3e3111bc5e99ee6a6560`; drift fails before execution. Only the access modifier of `refresh` is widened so the test can invoke it. Both bodies otherwise remain unchanged. The runner also rejects tracked Core/Storage/Control changes from the pinned base. Core, Control, Storage and History are the actual path-dependent repository packages, with actual temporary SQLite databases. Clock, identifiers, monitor preparation/cleanup, history-import call, file protection and RestrictionAdapter are explicit portable fakes. Tests do **not** compile or invoke all of ProductController, ScreenTimeRuntime, Expo or Apple APIs. The fake private open supplies an already-open actual repository, so this probe excludes private open/quick_check/protection overhead.

The current-source tests deliberately expect amplification. A passing current test says the problem is reproducible; it does not say the future read contract is satisfied. The separate `contract.py` is a proposed trace acceptance checker, containing no host implementation. Its self-tests test the checker against synthetic good/bad traces. A future implementation leaf must connect actual host entry points/ports to the checker or equivalent assertions. A new evidence ID in a synthetic trace is not proof of a real readback.

## Run

Swift 6 and SQLite development headers:

```sh
python3 experiments/issue-154-read-lifecycle/run.py
python3 experiments/issue-154-read-lifecycle/contract.py
```

Using the repository's pinned Swift 6.2.3 Docker image (build with `.github/docker/swift-tests.Dockerfile` first):

```sh
python3 experiments/issue-154-read-lifecycle/run.py --prepare /tmp/issue-154-swift-probe
docker run --rm --network none \
  --mount "type=bind,src=$PWD,dst=$PWD,readonly" \
  --mount type=bind,src=/tmp/issue-154-swift-probe,dst=/probe,readonly \
  itoma-audit-swift-tests:6.2.3 \
  swift test --package-path /probe --scratch-path /tmp/issue-154-build \
    --cache-path /tmp/swift-cache --enable-index-store --jobs 2
```

The source mount must preserve its absolute path because the generated manifest uses absolute path dependencies. If a shared container mounts this same pinned checkout at another path, pass `--dependency-root /work/154` during host-side preparation and mount the generated package at the path used by `swift test`; this changes dependency paths only, not extracted source verification. SwiftPM test discovery in Swift 6.2.3 requires test-object index units; `--disable-index-store` failed before test execution, so the successful test command enables the index store. All build/DB outputs are under the container's `/tmp`. `--prepare` only generates the experiment package and does not require local Swift. No downloaded dependencies or production copies are committed.

For a future instrumented host, emit JSON events at each actual port and run:

```sh
python3 experiments/issue-154-read-lifecycle/contract.py /tmp/host-trace.json
```

Nonzero exit indicates a contract violation. The checker covers read mutations, repeated failure/unknown cause retry, in-flight coalescing, evidence renewal/expiry, prune revisions/deletion proof, maintenance batch/lock/ack/cutoff conditions, stable submitted/activated onboarding completion, and stale private delivery. It is an acceptance aid, not a complete temporal model or an implemented coordinator. Use the design's R01–R11 scenarios for complete leaf acceptance, including private delay/read response liveness and read/mutation interleaving.

## Evidence

Verified **2026-11-12 UTC: Swift 6/6 tests PASS; Python trace-checker 8/8 self-tests PASS**. Swift 6.2.3 / SQLite 3.37.2 / Linux, shared runtime derived from the pinned repository Dockerfile. The original image was `ffcff0e2ce2dcf42819f485d05794b112f86834babcb409f701041288553d63e`; the flattened runtime was `6a50ee2587249f9d75c94959ccc56808e46900f4b99a2091e3ddd9228eb93a93` with the same toolchain/libraries. Temporary VFS image-copy disk exhaustion prevented some earlier container launches; final verification used one shared container with read-only source, writable output, no network and two compiler jobs.

Exact successful shared-runtime invocation (host preparation followed by container execution):

```sh
python3 experiments/issue-154-read-lifecycle/run.py \
  --prepare /tmp/itoma-audit-outputs/154/probe --dependency-root /work/154
docker exec itoma-audit-swift-runtime swift test \
  --package-path /output/154/probe --scratch-path /output/154/build \
  --cache-path /output/154/cache --enable-index-store --jobs 2
```

Counters describe fake Adapter calls and actual temporary SQLite state, not measured iPhone API calls or latency. No Simulator, signed iPhone, App Groups, File Protection, callback delivery, wall-clock/timezone notification delivery or maximum-data timing was tested here.

- Ten unchanged **source-extracted host refresh** calls, after a baseline reconciliation already established valid evidence and reflection capture was enabled: observed 10 own-store Adapter applications, control sequence +20, reflection facts +20, 10 monitor prepares, 10 monitor cleanups and 10 awaited private import calls. Import is a counter fake; history transfer contents/performance are outside this probe.
- Actual `ControlRepository.readSnapshot` repeated ten times after reconciliation: no new Adapter call, sequence or reflection fact; stored application/evidence timestamps unchanged. This is the existing repository primitive, **not** the current product snapshot entry.
- Explicit real Control reconciliation with fake new `.ownStoreReadback`: new observedAt/evidence and a finite window bounded by the new evaluation boundary. In this fixture the window advances from 45000 to 45010 only after the new fake readback reconciliation. The fake evidence does not validate Apple readback.
- Event-gated fake import: control reconciliation is already committed/applied, but the source-extracted host refresh has not returned while private import is held. Releasing the port allows the host method to finish; no sleeps or latency thresholds are used. This verifies current await coupling, not the future independent-read guarantee.
- Existing private raw `RuleDetailsRepository.read` succeeds while another SQLite writer holds `BEGIN IMMEDIATE`; the source-extracted host private read fails because its no-op prune needs a writer. Private revision remains unchanged. This demonstrates writer acquisition even when there is nothing to delete, without claiming a DB write occurred.
- Real synchronous deadline callback with fake ports and no display/JS clock: logical grant end and baseline restriction targets, preserving original expiry. OS callback scheduling/delivery is unverified.
- Actual private completion repository: unsubmitted binding rejected; same draft/command IDs survive submission; later explicit empty metadata is preserved through completion. Activation verification in the full host and scheduling/mutation interleaving remain future host-port tests.

## Limits and follow-up

This reduces uncertainty about current source wiring, actual Control write amplification, and private writer coupling. It does not implement side-effect-free `readSnapshot`, prove all storage work is bounded, or change the existing read-triggered onboarding completion behavior. #155 owns historical/live traversal and integrity-validation cost. After human adoption of ADR 0008, split implementation into the design's L1–L5 leaves and replace the current-amplification assertions with actual-entry regression tests as those leaves land. Keep device/native-build validation separate.
