"""Validate an existing device IPA and build the Appium package, without AWS access."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import zipfile


def require_hex(value, length, label):
    if not re.fullmatch(r"[0-9a-f]{%d}" % length, value):
        raise ValueError(f"{label} must be {length} lowercase hex characters")
    return value


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, value):
    # Atomic checkpoints also survive a signal between ScheduleRun and polling.
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n")
    temporary.replace(path)


def inspect_ipa(directory, expected_digest, bundle_id):
    require_hex(expected_digest, 64, "IPA SHA256")
    paths = list(Path(directory).rglob("*.ipa"))
    if len(paths) != 1 or paths[0].is_symlink():
        raise ValueError("The input artifact must contain exactly one regular IPA")
    path = paths[0].resolve()
    if digest(path) != expected_digest:
        raise ValueError("IPA SHA256 does not match the requested binary")
    with zipfile.ZipFile(path) as archive:
        plists = [name for name in archive.namelist() if re.fullmatch(r"Payload/[^/]+\.app/Info.plist", name)]
        if len(plists) != 1:
            raise ValueError("Expected one iOS application in Payload")
        info = plistlib.loads(archive.read(plists[0]))
        if info.get("CFBundleIdentifier") != bundle_id:
            raise ValueError("IPA bundle identifier does not match configuration")
        if info.get("CFBundleSupportedPlatforms") != ["iPhoneOS"]:
            raise ValueError("Device Farm requires an iPhoneOS IPA, not a Simulator build")
    return path, {
        "bundleId": bundle_id, "ipaSha256": expected_digest,
        "version": info.get("CFBundleShortVersionString"), "buildNumber": info.get("CFBundleVersion"),
    }


def prepare(args):
    require_hex(args.app_commit, 40, "App commit")
    require_hex(args.test_commit, 40, "Test commit")
    if not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", args.bundle_id):
        raise ValueError("Invalid bundle identifier")
    ipa, metadata = inspect_ipa(args.app_dir, args.ipa_sha256, args.bundle_id)
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    metadata.update(appCommit=args.app_commit, testCommit=args.test_commit,
                    sourceRunId=args.app_run_id, sourceArtifact=args.app_artifact,
                    binarySourceProof="artifact-run metadata plus runtime JS build marker; native source not attested")
    e2e = Path(__file__).resolve().parents[2] / "e2e"
    target = e2e / "target.json"
    if target.exists():
        raise ValueError("Refusing to overwrite an existing e2e/target.json")
    write_json(target, metadata)
    try:
        packed = subprocess.run(["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", str(output)],
                                cwd=e2e, check=True, text=True, capture_output=True)
        package = output / json.loads(packed.stdout)[0]["filename"]
    finally:
        target.unlink()
    with zipfile.ZipFile(output / "tests.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(package, package.name)
    package.unlink()
    metadata["testPackageSha256"] = digest(output / "tests.zip")
    metadata["testSpecSha256"] = digest(e2e / "device-farm.yml")
    metadata["ipaPath"] = str(ipa)
    write_json(output / "input.json", metadata)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app-dir", "app-commit", "test-commit", "ipa-sha256", "bundle-id", "output-dir", "app-run-id", "app-artifact"):
        parser.add_argument("--" + name, default=os.environ.get("ITOMA_" + name.upper().replace("-", "_")), required=False)
    arguments = parser.parse_args()
    if any(not value for value in vars(arguments).values()):
        parser.error("All inputs are required (flags or ITOMA_* environment variables)")
    prepare(arguments)
