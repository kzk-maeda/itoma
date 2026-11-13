#!/usr/bin/env python3
"""Render the checked-in NDJSON as Markdown; stdlib only, no remeasurement."""
import json
from pathlib import Path
import statistics
import sys

records = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines() if line]
env = next(row for row in records if row["kind"] == "environment")
samples = [row for row in records if row["kind"] == "measurement"]
counts = sorted({row["terminal_count"] for row in samples})
operations = list(dict.fromkeys(row["operation"] for row in samples))


def group(operation, count):
    return [row for row in samples if row["operation"] == operation and row["terminal_count"] == count]


def median(operation, count, key):
    return statistics.median(row[key] for row in group(operation, count))


def table(headers, rows):
    print("| " + " | ".join(headers) + " |")
    print("| " + " | ".join("---" for _ in headers) + " |")
    for row in rows:
        print("| " + " | ".join(map(str, row)) + " |")
    print()


print("# #155 recorded measurements\n")
print(f"Source: `{env['source_sha']}`; recorded {env['time_utc']}. "
      f"Swift 6.2.3 / SQLite {env['sqlite']}; {env['machine']}, Linux {env['kernel']}, "
      f"{env['cpu']}; {env['build']}.\n")
print("Synthetic fixed live load: one active grant/receipt, two targets, one rule; "
      "optional reflection capture installed. The OS file cache was not flushed. "
      "Cold means fresh process/connection. All times include the counting shim. "
      "No CPU affinity or dedicated-host isolation was applied.\n")
print("See README for the checked-in run's exact image provenance. "
      "Raw data records Dockerfile/harness hashes.\n")
print("## Elapsed time\n")
print("Milliseconds, per-operation median; the 100,000-row stress case has one observation. "
      "These are PC measurements, not iOS watchdog acceptance.\n")
table(["operation"] + [f"{count:,} terminal (n={len(group(operations[0], count))})" for count in counts],
      [[operation] + [f"{median(operation, count, 'elapsed_ms'):,.3f}" for count in counts] for operation in operations])
print("## Current payload and SQL work\n")
print("Record-bearing result rows are observed materializations, not direct Swift JSONDecoder call counts. "
      "Medians are independent per metric. See README for probe scope.\n")
selected = ["snapshot-repeat", "stop", "callback-cold", "recovery"]
table(["terminal", "operation", "statements", "grant rows", "command rows", "registration rows", "BLOB MiB", "VM steps"],
      [[f"{count:,}", op] + [f"{median(op, count, key):,.0f}" for key in ["statements", "grant_payload_rows", "command_payload_rows", "registration_payload_rows"]]
       + [f"{median(op, count, 'blob_bytes') / 2**20:,.2f}", f"{median(op, count, 'vm_steps'):,.0f}"]
       for count in counts for op in selected])
print("## Writer and memory observations\n")
print("Writer time starts after successful BEGIN IMMEDIATE and includes commit/rollback. "
      "Memory is Linux process RSS high-water growth, not total allocations; reused memory can hide growth. "
      "Priming snapshot-repeat is excluded from memory growth.\n")
table(["terminal", "operation", "writer total ms", "max hold ms", "peak growth MiB", "absolute peak MiB"],
      [[f"{count:,}", op, f"{median(op, count, 'writer_total_ms'):,.3f}", f"{median(op, count, 'writer_max_ms'):,.3f}",
        f"{median(op, count, 'peak_growth_kib') / 1024:,.2f}", f"{median(op, count, 'peak_rss_kib') / 1024:,.2f}"]
       for count in counts for op in ["stop", "callback-warm", "callback-cold", "recovery"]])
print("Snapshot memory (growth / absolute peak MiB); repeated-snapshot growth excludes the priming call:\n")
table(["terminal", "snapshot", "snapshot-repeat", "snapshot-cold"],
      [[f"{count:,}"] + [f"{median(op, count, 'peak_growth_kib') / 1024:.2f} / {median(op, count, 'peak_rss_kib') / 1024:.2f}"
                         for op in ["snapshot", "snapshot-repeat", "snapshot-cold"]] for count in counts])
print("## Remaining storage and index cost\n")
print("The separate experimental ledger has only command ID, grant ID and ended flag. "
      "It excludes required full proposed headers/receipts, so its size/query time is a lower bound, "
      "not proposed-schema acceptance. Main-DB current measurements do not include this sidecar. "
      "Historical per-clone transferred event-ID ledgers/private history and selection growth are omitted; "
      "this is a controlled terminal-grant axis, not a full lifetime storage estimate.\n")
footprints = [row for row in records if row["kind"] == "footprint"]
table(["terminal", "current fixture DB MiB", "partial reservation index KiB", "prototype ledger MiB", "ledger ID index MiB"],
      [[f"{row['terminal_count']:,}", f"{row['database_bytes'] / 2**20:.2f}",
        f"{row['table_index_bytes']['grants_one_reserved_target'] / 1024:.0f}",
        f"{row['prototype_ledger_bytes'] / 2**20:.2f}",
        f"{row['prototype_ledger_table_index_bytes']['sqlite_autoindex_terminal_ids_1'] / 2**20:.2f}"] for row in footprints])
print("The prototype returned one grant payload and one terminal header using the existing "
      "partial reservation index and a command-ID B-tree lookup. Its constant payload count does "
      "not validate completeness: the live-reservation corruption would be hidden by reserved=1 alone. "
      "Index pages, B-tree lookup depth, insertion, checkpoint and whole-DB diagnostics still grow.\n")
print("## Current fault boundary\n")
table(["injection", "open/snapshot", "unfinished", "callback", "stop", "OS-equivalent calls (callback / stop)"],
      [[row["corruption"], f"{row['open']} / {row['snapshot']}", row["unfinished"], row["callback"], row["stop"],
        f"{row['callback_restriction_calls']} / {row['stop_restriction_calls']}"]
       for row in records if row["kind"] == "corruption"])
for row in records:
    if row["kind"] == "contention":
        print(f"Second-connection held writer: callback {row['callback_elapsed_ms']:.3f} ms, "
              f"begin wait {row['writer_begin_wait_ms']:.3f} ms, {row['outcome']}, "
              f"{row['restriction_calls']} OS-equivalent calls. This is not an iOS process test.\n")
    if row["kind"] == "replay":
        print("Replay assertions passed: obsolete callback preserved the newer live grant; terminal "
              "request registered zero times; old stop did not override newer resume; resume did not revive a grant.\n")
print("The proposed isolation is not implemented here. Current terminal JSON corruption still blocks stop/callback, "
      "while current owner/reservation/receipt checks reject live inconsistency before an OS-equivalent write. "
      "Migration/compact-ledger/old-reader/device acceptance remains in the proposed dependent leaves.")
