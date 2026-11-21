#!/bin/bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
project=$(mktemp -d)
device=""
cleanup() {
  if [[ -n "$device" ]]; then xcrun simctl delete "$device"; fi
  rm -rf "$project"
}
trap cleanup EXIT
cp "$root/tests/ios/support/"{Host.swift,SupportTests.swift,project.yml} "$project/"
cp "$root/modules/itoma-native/ios/SupportPurchases.swift" "$root/docs/qa/support-purchases/Support.storekit" "$project/"
cd "$project"
xcodegen generate
read -r model runtime <<< "$(xcrun simctl list devices available --json | python3 -c 'import json,sys; print(next(d["deviceTypeIdentifier"]+" "+r for r,ds in json.load(sys.stdin)["devices"].items() for d in ds if d["name"].startswith("iPhone")))')"
device=$(xcrun simctl create "ITOMA support test $(uuidgen)" "$model" "$runtime")
xcodebuild test -scheme SupportHost -project SupportHost.xcodeproj -destination "id=$device" -parallel-testing-enabled NO
