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
# Hosted iOS 26.4.1 rejects SKTestSession configuration with SKInternalErrorDomain Code=3.
# Only the StoreKit test pins a runtime in CI. Local developers may select an installed runtime.
read -r model runtime <<< "$(xcrun simctl list devices available --json | python3 -c '
import json, os, sys
expected = os.environ.get("ITOMA_STOREKIT_RUNTIME")
for runtime, devices in json.load(sys.stdin)["devices"].items():
    if expected and runtime != expected:
        continue
    for device in devices:
        if device["name"].startswith("iPhone"):
            print(device["deviceTypeIdentifier"], runtime)
            sys.exit(0)
sys.exit("No iPhone simulator for " + (expected or "StoreKit Test"))
')"
echo "StoreKit Test runtime $runtime"
device=$(xcrun simctl create "ITOMA support test $(uuidgen)" "$model" "$runtime")
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
xcodebuild test -scheme SupportHost -project SupportHost.xcodeproj -destination "id=$device" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 120
