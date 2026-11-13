#!/usr/bin/env python3
"""Copy actual host refresh bodies into a portable test package; Apple/private ports are fakes."""
import argparse
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--prepare', required=True, type=Path)
parser.add_argument('--packages', required=True, type=Path, help='Exact packages checkout path inside the test runtime')
args = parser.parse_args()
source = (ROOT / 'modules/itoma-native/ios/ProductController.swift').read_text()
body = source[source.index('    private func refreshForDisplay('):source.index('    private func cancelCandidate(')]
fingerprint = hashlib.sha256(body.encode()).hexdigest()
body = body.replace('private func refreshForDisplay(', 'func refreshForDisplay(', 1)
target = args.prepare / 'Tests/HostTests'
target.mkdir(parents=True, exist_ok=True)
(target / 'HostTests.swift').write_text((HERE / 'HostTests.swift').read_text().replace('// EXTRACT_DISPLAY_REFRESH', body))
deps = ', '.join(f'.package(path: {json.dumps(str(args.packages / name))})' for name in ['itoma-core','itoma-storage','itoma-control'])
(args.prepare / 'Package.swift').write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "DisplayPollHost", dependencies: [DEPENDENCIES], targets: [
.testTarget(name: "HostTests", dependencies: [.product(name: "ItomaCore", package: "itoma-core"),
.product(name: "ItomaStorage", package: "itoma-storage"),.product(name: "ItomaHistory", package: "itoma-storage"),
.product(name: "ItomaControl", package: "itoma-control")])])
'''.replace('DEPENDENCIES', deps))
print(json.dumps({'extractedMethodsSHA256': fingerprint, 'packages':str(args.packages), 'testPackage':str(args.prepare)}))
