#!/usr/bin/env python3
"""Generate a throwaway Swift package using current host methods and real packages.
Does not modify application/package sources; requires Swift 6 + SQLite headers.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BASE_SHA = '7642ebf657d97108e6825fef65dbe3a592a38625'
EXPECTED_METHOD_SHA256 = 'be77cc65a30a1c7e5af5167dcbfa16a96a4d90e2e0cd3e3111bc5e99ee6a6560'


def method(path, start, end):
    source = (ROOT / path).read_text()
    return source[source.index(start):source.index(end, source.index(start))].rstrip()


def prepare(destination, dependency_root=ROOT):
    # Pin the real implementation dependencies as well as the two extracted host methods.
    checked = subprocess.run(['git', 'diff', '--quiet', BASE_SHA, '--',
                              'packages/itoma-core', 'packages/itoma-storage', 'packages/itoma-control'], cwd=ROOT)
    if checked.returncode:
        raise SystemExit('Core/Storage/Control differ from the audited base; reproduce on the pinned checkout')
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / 'Tests' / 'LifecycleTests'
    target.mkdir(parents=True, exist_ok=True)
    fixture = (HERE / 'LifecycleTests.swift').read_text()
    refresh = method('modules/itoma-native/ios/ProductController.swift',
                     '    private func refresh(', '    private func cancelCandidate(')
    private_read = method('modules/itoma-native/ios/ProductRuleDetails.swift',
                          '    static func read(activeRuleIDs:', '    static func save(')
    fingerprint = hashlib.sha256((refresh + private_read).encode()).hexdigest()
    if fingerprint != EXPECTED_METHOD_SHA256:
        raise SystemExit('Host method source drift: inspect the change, rerun acceptance, then update the pinned fingerprint')
    # Visibility only: the method body is copied unchanged, never replaced with an ideal read.
    fixture = fixture.replace('// EXTRACT_CURRENT_REFRESH', refresh.replace('private func refresh(', 'func refresh(', 1))
    fixture = fixture.replace('// EXTRACT_CURRENT_PRIVATE_READ', private_read)
    (target / 'LifecycleTests.swift').write_text(fixture)
    dependencies = [f'.package(path: {json.dumps(str(dependency_root / "packages" / name))})'
                    for name in ['itoma-core', 'itoma-storage', 'itoma-control']]
    manifest = '''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "ReadLifecycleReproduction", dependencies: [DEPENDENCIES], targets: [
    .systemLibrary(name: "CSQLiteProbe", pkgConfig: "sqlite3"),
    .testTarget(name: "LifecycleTests", dependencies: ["CSQLiteProbe",
        .product(name: "ItomaCore", package: "itoma-core"),
        .product(name: "ItomaStorage", package: "itoma-storage"),
        .product(name: "ItomaHistory", package: "itoma-storage"),
        .product(name: "ItomaControl", package: "itoma-control")])])
'''.replace('DEPENDENCIES', ', '.join(dependencies))
    (destination / 'Package.swift').write_text(manifest)
    c = destination / 'Sources' / 'CSQLiteProbe'
    c.mkdir(parents=True, exist_ok=True)
    (c / 'module.modulemap').write_text('module CSQLiteProbe [system] { header "shim.h" link "sqlite3" export * }\n')
    (c / 'shim.h').write_text('#include <sqlite3.h>\n')
    print(json.dumps({'sourceRoot': str(ROOT), 'dependencyRoot': str(dependency_root), 'auditedBaseCommit': BASE_SHA, 'extractedMethodsSHA256': fingerprint,
                      'package': str(destination)}, sort_keys=True), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', type=Path, help='Generate only, then run Swift at this path')
    parser.add_argument('--dependency-root', type=Path, default=ROOT,
                        help='Path where this exact checkout will be mounted during Swift execution')
    args = parser.parse_args()
    if args.prepare:
        prepare(args.prepare.resolve(), args.dependency_root)
        return
    if not shutil.which('swift'):
        parser.error('Swift is unavailable; use --prepare under the pinned Docker image (see README)')
    with tempfile.TemporaryDirectory(prefix='itoma-read-lifecycle-') as directory:
        prepare(Path(directory), args.dependency_root)
        subprocess.run(['swift', 'test', '--package-path', directory, '--jobs', '2'], check=True)


if __name__ == '__main__':
    main()
