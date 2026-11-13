#!/usr/bin/env python3
"""Run inside the pinned Swift image, or with its compiler/SQLite environment.

All fixtures are synthetic. Copying, seeding, and process startup are outside timers.
Never use this runner on an application database.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import sqlite3
import subprocess
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent


def run(*args, env=None):
    return subprocess.check_output(args, cwd=HERE, env=env, text=True).strip()


def remove_fixture(path):
    for suffix in ["", "-wal", "-shm", ".ledger.sqlite", ".ledger.sqlite-wal", ".ledger.sqlite-shm"]:
        Path(str(path) + suffix).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--counts", nargs="+", type=int, default=[1000, 10000, 100000])
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--long-repeats", type=int, default=1)
    parser.add_argument("--output", default="results/current.ndjson")
    parser.add_argument("--work-root", default="work")
    parser.add_argument("--source-sha", help="Host-verified HEAD when a worktree's external .git directory is not mounted")
    args = parser.parse_args()
    source_sha = args.source_sha or run("git", "-C", str(REPO), "rev-parse", "HEAD")
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        parser.error("--source-sha must be a full lowercase commit SHA")
    work = (HERE / args.work_root).resolve()
    work.mkdir(exist_ok=True, parents=True)
    run("clang", "-Wall", "-Wextra", "-O2", "-shared", "-fPIC", "probe/sqlite-probe.c", "-o", str(work / "sqlite-probe.so"), "-ldl", "-lsqlite3")
    run("swift", "build", "-c", "release", "--jobs", "2", "--scratch-path", str(work / "build"))
    binary = work / "build/release/RetentionBench"
    env = dict(os.environ, LD_PRELOAD=str(work / "sqlite-probe.so"))
    output = HERE / args.output
    output.parent.mkdir(exist_ok=True, parents=True)
    with output.open("w") as stream:
        def emit(value):
            text = json.dumps(value, sort_keys=True)
            stream.write(text + "\n")
            stream.flush()
            print(text, flush=True)

        emit({"kind": "environment", "source_sha": source_sha,
              "swift": run("swift", "--version"), "sqlite": sqlite3.sqlite_version,
              "kernel": platform.release(), "machine": platform.machine(),
              "cpu": next((line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")), "unknown"),
              "build": "release --jobs 2", "file_cache": "OS cache not flushed; cold=fresh process/connection",
              "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "dockerfile_sha256": hashlib.sha256((REPO / ".github/docker/swift-tests.Dockerfile").read_bytes()).hexdigest(),
              "harness_sha256": {str(path.relative_to(HERE)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in [HERE / "Package.swift", HERE / "run.py", HERE / "probe/sqlite-probe.c", HERE / "Sources/RetentionBench/Bench.swift"]}})
        for count in args.counts:
            base = work / f"seed-{count}.sqlite"
            remove_fixture(base)
            emit(dict(json.loads(run(str(binary), "seed", str(base), str(count))), kind="fixture"))
            with closing(sqlite3.connect(base)) as db:
                footprint = {name: size for name, size in db.execute("SELECT name,SUM(pgsize) FROM dbstat GROUP BY name")}
                plans = [row[3] for row in db.execute("EXPLAIN QUERY PLAN SELECT grant_id,command_id,target_ref,record FROM grants WHERE reserved=1")]
                with closing(sqlite3.connect(str(base) + ".ledger.sqlite")) as ledger:
                    ledger_footprint = {name: size for name, size in ledger.execute("SELECT name,SUM(pgsize) FROM dbstat GROUP BY name")}
                    plans += [row[3] for row in ledger.execute("EXPLAIN QUERY PLAN SELECT command_id,grant_id,ended FROM terminal_ids WHERE command_id='00000000-0000-0000-0000-000000000101'")]
                emit({"kind": "footprint", "terminal_count": count, "database_bytes": base.stat().st_size,
                      "table_index_bytes": footprint, "prototype_query_plans": plans,
                      "prototype_ledger_bytes": Path(str(base) + ".ledger.sqlite").stat().st_size,
                      "prototype_ledger_table_index_bytes": ledger_footprint})
            repeats = args.long_repeats if count == max(args.counts) and count >= 100000 else args.repeats
            operations = ["snapshot", "snapshot-repeat", "snapshot-cold", "stop", "callback-warm", "callback-cold", "recovery",
                          "open", "quick-check", "lightweight-sql-open", "indexed-live-slice"]
            for operation in operations:
                for repeat in range(repeats):
                    target = work / "measurement.sqlite"
                    remove_fixture(target)
                    shutil.copyfile(base, target)
                    if operation == "indexed-live-slice":
                        shutil.copyfile(str(base) + ".ledger.sqlite", str(target) + ".ledger.sqlite")
                    result = json.loads(run(str(binary), "measure", str(target), operation, env=env))
                    emit(dict(result, kind="measurement", terminal_count=count, repeat=repeat))
                    remove_fixture(target)
            if count == min(args.counts):
                contention_target = work / "contention.sqlite"
                remove_fixture(contention_target)
                shutil.copyfile(base, contention_target)
                emit(dict(json.loads(run(str(binary), "contention", str(contention_target), "writer", env=env)), kind="contention"))
                remove_fixture(contention_target)
                replay_target = work / "replay.sqlite"
                remove_fixture(replay_target)
                shutil.copyfile(base, replay_target)
                emit(dict(json.loads(run(str(binary), "replay", str(replay_target), "all")), kind="replay"))
                remove_fixture(replay_target)
                for corruption in ["terminal-json", "live-owner", "live-reservation", "live-receipt"]:
                    target = work / "corruption.sqlite"
                    remove_fixture(target)
                    shutil.copyfile(base, target)
                    emit(dict(json.loads(run(str(binary), "corrupt", str(target), corruption)), kind="corruption"))
                    remove_fixture(target)


if __name__ == "__main__":
    main()
