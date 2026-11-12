# #155 recorded measurements

Source: `7642ebf657d97108e6825fef65dbe3a592a38625`; recorded 2026-11-12T13:27:00Z. Swift 6.2.3 / SQLite 3.37.2; x86_64, Linux 6.18.57, AMD EPYC 9V74 80-Core Processor; release --jobs 2.

Synthetic fixed live load: one active grant/receipt, two targets, one rule; optional reflection capture installed. The OS file cache was not flushed. Cold means fresh process/connection. All times include the counting shim. No CPU affinity or dedicated-host isolation was applied.

See README for the checked-in run's exact image provenance. Raw data records Dockerfile/harness hashes.

## Elapsed time

Milliseconds, per-operation median; the 100,000-row stress case has one observation. These are PC measurements, not iOS watchdog acceptance.

| operation | 1,000 terminal (n=3) | 10,000 terminal (n=3) | 100,000 terminal (n=1) |
| --- | --- | --- | --- |
| snapshot | 68.551 | 708.825 | 9,151.217 |
| snapshot-repeat | 67.896 | 693.009 | 8,258.079 |
| snapshot-cold | 77.449 | 756.421 | 8,814.367 |
| stop | 1,823.743 | 19,934.027 | 210,725.604 |
| callback-warm | 1,239.921 | 12,347.251 | 140,443.902 |
| callback-cold | 1,347.854 | 11,724.430 | 124,625.998 |
| recovery | 1,239.495 | 12,667.854 | 144,223.935 |
| open | 6.172 | 24.425 | 176.853 |
| quick-check | 4.088 | 19.536 | 176.198 |
| lightweight-sql-open | 0.585 | 0.773 | 0.722 |
| indexed-live-slice | 1.845 | 1.142 | 1.094 |

## Current payload and SQL work

Record-bearing result rows are observed materializations, not direct Swift JSONDecoder call counts. Medians are independent per metric. See README for probe scope.

| terminal | operation | statements | grant rows | command rows | registration rows | BLOB MiB | VM steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | snapshot-repeat | 3,052 | 1,001 | 1,001 | 0 | 0.92 | 51,729 |
| 1,000 | stop | 81,127 | 25,035 | 26,121 | 1,004 | 24.05 | 1,384,115 |
| 1,000 | callback-cold | 49,992 | 15,021 | 16,032 | 1,005 | 14.77 | 912,772 |
| 1,000 | recovery | 51,942 | 15,021 | 17,033 | 1,005 | 15.31 | 877,579 |
| 10,000 | snapshot-repeat | 30,052 | 10,001 | 10,001 | 0 | 9.22 | 510,729 |
| 10,000 | stop | 792,127 | 250,035 | 260,121 | 10,004 | 239.26 | 13,525,115 |
| 10,000 | callback-cold | 490,992 | 150,021 | 160,032 | 10,005 | 147.07 | 8,985,772 |
| 10,000 | recovery | 510,942 | 150,021 | 170,033 | 10,005 | 152.55 | 8,644,579 |
| 100,000 | snapshot-repeat | 300,052 | 100,001 | 100,001 | 0 | 92.13 | 5,100,729 |
| 100,000 | stop | 7,902,127 | 2,500,035 | 2,600,121 | 100,004 | 2,391.38 | 134,935,115 |
| 100,000 | callback-cold | 4,900,992 | 1,500,021 | 1,600,032 | 100,005 | 1,470.06 | 89,715,772 |
| 100,000 | recovery | 5,100,942 | 1,500,021 | 1,700,033 | 100,005 | 1,524.89 | 86,314,579 |

## Writer and memory observations

Writer time starts after successful BEGIN IMMEDIATE and includes commit/rollback. Memory is Linux process RSS high-water growth, not total allocations; reused memory can hide growth. Priming snapshot-repeat is excluded from memory growth.

| terminal | operation | writer total ms | max hold ms | peak growth MiB | absolute peak MiB |
| --- | --- | --- | --- | --- | --- |
| 1,000 | stop | 1,820.315 | 772.673 | 6.79 | 32.33 |
| 1,000 | callback-warm | 1,239.070 | 827.380 | 6.43 | 32.10 |
| 1,000 | callback-cold | 1,288.861 | 863.016 | 12.32 | 32.27 |
| 1,000 | recovery | 1,238.855 | 793.948 | 6.57 | 32.24 |
| 10,000 | stop | 19,926.873 | 8,485.155 | 18.82 | 44.41 |
| 10,000 | callback-warm | 12,345.408 | 8,646.024 | 17.49 | 43.30 |
| 10,000 | callback-cold | 11,698.682 | 8,112.000 | 23.05 | 43.35 |
| 10,000 | recovery | 12,666.436 | 8,272.675 | 18.26 | 43.70 |
| 100,000 | stop | 210,722.431 | 91,752.646 | 133.85 | 159.77 |
| 100,000 | callback-warm | 140,442.644 | 99,056.108 | 133.57 | 159.35 |
| 100,000 | callback-cold | 124,440.987 | 87,392.387 | 139.37 | 159.61 |
| 100,000 | recovery | 144,222.591 | 96,919.000 | 134.58 | 160.56 |

Snapshot memory (growth / absolute peak MiB); repeated-snapshot growth excludes the priming call:

| terminal | snapshot | snapshot-repeat | snapshot-cold |
| --- | --- | --- | --- |
| 1,000 | 1.53 / 27.30 | 0.86 / 27.43 | 7.36 / 27.32 |
| 10,000 | 11.03 / 36.66 | 0.95 / 37.79 | 16.70 / 36.46 |
| 100,000 | 112.63 / 138.41 | 1.30 / 139.61 | 118.64 / 138.81 |

## Remaining storage and index cost

The separate experimental ledger has only command ID, grant ID and ended flag. It excludes required full proposed headers/receipts, so its size/query time is a lower bound, not proposed-schema acceptance. Main-DB current measurements do not include this sidecar. Historical per-clone transferred event-ID ledgers/private history and selection growth are omitted; this is a controlled terminal-grant axis, not a full lifetime storage estimate.

| terminal | current fixture DB MiB | partial reservation index KiB | prototype ledger MiB | ledger ID index MiB |
| --- | --- | --- | --- | --- |
| 1,000 | 2.52 | 4 | 0.14 | 0.05 |
| 10,000 | 23.81 | 4 | 1.28 | 0.49 |
| 100,000 | 237.23 | 4 | 12.89 | 4.91 |

The prototype returned one grant payload and one terminal header using the existing partial reservation index and a command-ID B-tree lookup. Its constant payload count does not validate completeness: the live-reservation corruption would be hidden by reserved=1 alone. Index pages, B-tree lookup depth, insertion, checkpoint and whole-DB diagnostics still grow.

## Current fault boundary

| injection | open/snapshot | unfinished | callback | stop | OS-equivalent calls (callback / stop) |
| --- | --- | --- | --- | --- | --- |
| terminal-json | ok / ok | corrupt | uncertain:Optional(ItomaCore.OperationFailure.storageFailure) | corrupt | 0 / 0 |
| live-owner | ok / ok | corrupt | uncertain:Optional(ItomaCore.OperationFailure.storageFailure) | corrupt | 0 / 0 |
| live-reservation | ok / ok | corrupt | uncertain:Optional(ItomaCore.OperationFailure.storageFailure) | corrupt | 0 / 0 |
| live-receipt | ok / ok | ok | uncertain:Optional(ItomaCore.OperationFailure.storageFailure) | corrupt | 0 / 0 |

Second-connection held writer: callback 100.878 ms, begin wait 100.780 ms, uncertain:storageFailure, 0 OS-equivalent calls. This is not an iOS process test.

Replay assertions passed: obsolete callback preserved the newer live grant; terminal request registered zero times; old stop did not override newer resume; resume did not revive a grant.

The proposed isolation is not implemented here. Current terminal JSON corruption still blocks stop/callback, while current owner/reservation/receipt checks reject live inconsistency before an OS-equivalent write. Migration/compact-ledger/old-reader/device acceptance remains in the proposed dependent leaves.
