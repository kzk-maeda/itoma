# #155 control retention design experiment

This is a synthetic, standalone experiment and **Proposed design evidence**, not a production migration or retention change. It calls the repository's real `ItomaStorage`, `ItomaControl`, and `ItomaCore` via local Swift package dependencies. No production source is patched or copied. The small SQL index experiment is explicitly a lower bound, not an implementation of the proposed complete live set.

See [ADR 0009](../../docs/adr/0009-live-control-terminal-records.md) and the [proposed contract](../../docs/system/live-control-retention.md). Current behavior below must not be read as the proposed behavior already working.

## Reproduce

Use the pinned [.github/docker/swift-tests.Dockerfile](../../.github/docker/swift-tests.Dockerfile), with no network during compilation or execution:

```bash
docker build -f .github/docker/swift-tests.Dockerfile -t itoma-audit-swift-tests:6.2.3 .
mkdir -p /tmp/itoma-155-run
docker run --rm --network none \
  -v "$PWD:/workspace:ro" -v /tmp/itoma-155-run:/bench-output \
  -w /workspace/experiments/issue-155-control-retention \
  itoma-audit-swift-tests:6.2.3 \
  python3 run.py --work-root /bench-output --output /bench-output/current.ndjson \
    --source-sha "$(git rev-parse HEAD)"
```

The build may need the managed environment's public CA build secret as documented in the Dockerfile. It is not needed for the offline run. Avoid launching several full Swift images concurrently on a Docker VFS daemon with limited disk; a shared long-lived container and separate scratch directories also works. No Docker cleanup is part of this runner.

The checked-in run used a shared container built from original image `sha256:ffcff0e2ce2dcf42819f485d05794b112f86834babcb409f701041288553d63e` (`itoma-audit-swift-tests:6.2.3`). To fit this environment's Docker VFS disk limits, the runtime flattened its layers and normalized equivalent symlink representation into `sha256:6a50ee2587249f9d75c94959ccc56808e46900f4b99a2091e3ddd9228eb93a93` (`itoma-audit-swift-flat:6.2.3`). Compiler/library contents were preserved; the runtime verified Swift 6.2.3, SQLite 3.37.2, clang 17 and Python 3.10.12. The repository was mounted read-only and each experiment used a separate writable output directory. No new toolchain or SQLite version was substituted.

`run.py` compiles a release binary with two jobs and a Linux `LD_PRELOAD` SQLite counting shim. Every measurement runs in a fresh process. Each operation starts from an independent copy of a checkpointed synthetic database; copying, process startup, fixture creation, and validation are outside its timer. The default runs 3 repetitions at 1,000/10,000 terminal grants and one stress observation at 100,000. Override with `--counts`, `--repeats`, and `--long-repeats`.

Fixtures have one enabled all-days rule, two selected targets, one live active grant, one live registered receipt, and N reconciled grants with succeeded owner commands, result mappings, one attempt, and obsolete registrations. Optional reflection capture is installed through the real host API, with a fixed combined outbox capacity of 100; historical clones do not add pending outbox work. They contain no user text or real token. A terminal and live pair are first created through the actual accept/execute/end APIs. Bulk terminal rows clone those real persisted encodings with distinct IDs. The actual `unfinishedGrants` decoder validates all clones before measurement. 100,000 terminal grants is a synthetic stress count (50 per day for about 5.5 years), not a measured usage distribution. Live-load limits beyond this one-live fixture are unverified.

The clones omit per-clone transferred history/reflection event-ID ledgers and private history. Storage footprint/quick_check observations isolate the terminal command/grant/registration axis; a real lifetime database with those additional ledgers and historical selections can cost more. No pending history workload is extrapolated from this fixture.

## What each measurement includes

| Operation | Timed code and boundary |
| --- | --- |
| `snapshot` | Actual `readSnapshot` + `unfinishedGrants` on an opened connection. This is the repository slice used for host snapshot construction, not the entire ProductController UI/refresh flow |
| `snapshot-repeat` | Prime that exact slice once, then time the second call on the same connection, demonstrating scans that remain after runtime/connection caching. Priming is outside time/count/memory-growth measurements |
| `snapshot-cold` | Fresh actual `ControlRepository.open` plus the same slice |
| `stop` | Actual asynchronous `CommandService.stop` with durable acceptance, reconciliation, fake own-store write, and obsolete-monitor cleanup |
| `callback-warm` | Actual `reconcileSynchronously` on an opened connection, with no deadline identity |
| `callback-cold` | Fresh actual open + makeService-equivalent snapshot read + `reconcileSynchronously`. Apple token decoding, monitor journal, actor bridge, file protection and real OS writes are excluded |
| `recovery` | Actual `reconcile(recoverInterruptedCommands: true)`, exercising full command selection and asynchronous cleanup |
| `open` | Actual `ControlRepository.open`, including the whole-DB quick_check and snapshot validation |
| `quick-check` | Actual low-level repository SQLite wrapper open + `PRAGMA quick_check(1)` only |
| `lightweight-sql-open` | SQLite wrapper open + schema/application/WAL header queries only. **Not** the proposed complete open validation |
| `indexed-live-slice` | Existing `reserved=1` partial index query + an experimental three-column terminal ID point lookup in a separate sidecar DB. **Does not prove completeness or safe Control behavior**. Its size excludes the full proposed ledger fields; the sidecar does not inflate current open/quick_check measurements |

Warm means a live connection whose open/quick_check cost is excluded. Cold means a fresh process/connection; **the OS file cache is not flushed**. Database copies and fixture validation can warm it. These observations do not establish cold physical I/O latency.

The fake context holds time, timezone and authorization fixed to keep live load constant. Deadline/clock/authorization crossings and real native scheduler/write latency are separate tests; elapsed benchmark time does not advance that synthetic clock.

The shim reports prepared statement calls, result rows, grant/command/registration record-bearing result rows, copied BLOB bytes and SQLite VM steps. It does **not** interpose Swift JSONDecoder. In successful current paths these record rows feed the source's decoding calls, but they are not direct decoder invocation measurements; on an early corruption failure, materialized rows can exceed decodes reached. Probe instrumentation adds overhead, especially for row-heavy paths, so absolute times are instrumented observations.

Writer duration is measured from successful `BEGIN IMMEDIATE` completion until `COMMIT`/`ROLLBACK` completion. Sum and maximum include synchronous fake own-store execution and commit I/O; begin wait is recorded separately. It is not an iOS process-lock benchmark or a guarantee of uncontended duration. No scheduler registration/cancellation await is included in a writer hold.

Memory uses Linux `VmRSS` before the operation and `VmHWM` afterwards. `peak_growth_kib` is the high-water increase above the pre-operation high-water mark, not total allocations or exact temporary bytes. Reused allocator memory and earlier open allocations can hide temporary growth. Absolute peak is also retained. This method is a coarse lower-bound observation, not a Swift allocation profiler.

## Current failures and replay checks

The runner executes the actual repository/control APIs after four distinct injections into fresh database copies:

- corrupt only a reconciled terminal grant's JSON BLOB;
- corrupt only the live owner's immutable intent;
- flip the live reservation column to zero while leaving its JSON live;
- change a live receipt's deadline to a different, validly encoded Instant.

It records open/snapshot/unfinished results, synchronous reconcile, stop, and fake restriction call counts. This demonstrates the **current** boundary, including whether an OS-equivalent call happened before a failure; it does not prove the new schema's proposed isolation. Each case retains database structure and unrelated payloads.

The separate replay case asserts that an obsolete old callback cannot modify a newer live grant on the same target, replaying the terminal grant command never registers again, repeating an old stop cannot override a newer resume, and resume cannot revive the ended grant. These use actual command/reconcile logic. The future compact-ledger implementation must rerun equivalent tests, including joined requests/candidates/late receipts and interrupted migrations, before claiming equivalent protection.

The contention case holds an actual SQLite writer on a second connection while the synchronous callback tries to run. It measures the callback's busy failure and asserts no fake OS write. This is a same-process, two-connection lock injection, not an iOS two-process/lifetime measurement. The competing holder starts before the measurement reset; its duration is deliberately excluded.

## Recorded evidence

Raw data: [results/current.ndjson](results/current.ndjson); tables: [results/summary.md](results/summary.md). The run completed 77 timed observations (11 operations, 3/3/1 repetitions across the three sizes), four corruption injections, a writer-lock case, and the replay assertions. Repository code SHA, toolchain version, SQLite version, CPU/kernel and time are emitted in the first record. The experiment changes only its own files plus the two proposed design documents.

At 10,000 terminal grants, a primed repeated snapshot still materialized 10,001 grant records; stop materialized 250,035 and the cold callback 150,021, plus 10,005 registration records. Their instrumented PC elapsed observations were respectively 0.693s, 19.934s and 11.724s (medians of three). At 100,000, stop took 210.726s with a 91.753s maximum writer hold; the cold callback took 124.626s. These are single stress observations with fake OS adapters. The three-column index prototype returned one grant payload plus one header at all sizes, while its ledger grew to 12.89MiB. It does not implement safe live classification or the proposed complete ledger.

Regenerate the tables without rerunning the experiment:

```bash
python3 experiments/issue-155-control-retention/summarize.py \
  experiments/issue-155-control-retention/results/current.ndjson \
  > experiments/issue-155-control-retention/results/summary.md
```

No Simulator/device/Screen Time API, App Groups, File Protection, background process lifetime, watchdog budget, migration, archive compression/deletion, or proposed schema was validated. This PC experiment cannot accept/reject an iOS watchdog budget. The full callback, cold open, shared writer contention and long-lived database must be measured on the matching native build through #49/#50/#52/#131.

Historical selections and policy size are held fixed. Current `loadSnapshot` also reads all stored selections; growth on that independent axis is not measured here and must be included in the future live reference closure and capacity gates.
