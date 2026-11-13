import json
import os
from pathlib import Path
import plistlib
import sys
import subprocess
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "device_farm"))
from prepare import digest, inspect_ipa, require_hex, scenario_ids, write_json
from run import Runner, pages, validate_arns, verify_evidence

PROJECT = "arn:aws:devicefarm:us-west-2:123456789012:project:" + "a" * 36
POOL = PROJECT.replace(":project:", ":devicepool:") + "/" + "b" * 36
RUN = PROJECT.replace(":project:", ":run:") + "/" + "c" * 36
DEVICE = {"arn": "device", "name": "iPhone", "platform": "IOS", "os": "27.0", "fleetType": "PUBLIC"}
SCENARIO_IDS = scenario_ids(Path(__file__).resolve().parents[2] / "e2e" / "scenarios.json")
META = {"appCommit": "a" * 40, "testCommit": "b" * 40, "bundleId": "com.example.itoma", "ipaSha256": "c" * 64,
        "scenarioIds": SCENARIO_IDS}


def evidence(path, *, count=None, skipped=False, metadata=None):
    registered = (metadata or META)["scenarioIds"]
    count = len(registered) if count is None else count
    ids = registered[:count] + ["DF999"] * max(0, count - len(registered))
    cases = "".join(f'<testcase name="{identity}: scenario">' + ('<skipped/>' if skipped else '') + '</testcase>' for identity in ids)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("logs/junit.xml", f"<testsuites><testsuite>{cases}</testsuite></testsuites>")
        archive.writestr("logs/session.json", json.dumps(metadata or META))


class Clock:
    now = 0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class FakeFarm:
    def __init__(self):
        self.calls = []
        self.upload_status = "SUCCEEDED"
        self.maximum = 1
        self.devices = [DEVICE.copy()]
        self.result = "PASSED"
        self.status = "COMPLETED"
        self.failed_download = False
        self.bad_evidence = False
        self.read_failure = False
        self.upload_counter = 0

    def create_upload(self, **args):
        self.upload_counter += 1
        self.calls.append(("upload", args))
        return {"upload": {"arn": f"upload-{self.upload_counter}", "url": "https://upload.invalid/?secret=NEVER_PERSIST"}}

    def get_upload(self, **_):
        return {"upload": {"status": self.upload_status}}

    def get_device_pool(self, **_):
        return {"devicePool": {"maxDevices": self.maximum}}

    def get_device_pool_compatibility(self, **_):
        return {"compatibleDevices": [{"device": device} for device in self.devices]}

    def schedule_run(self, **args):
        self.calls.append(("schedule", args))
        return {"run": {"arn": RUN}}

    def get_run(self, **_):
        if self.read_failure:
            raise OSError("https://signed.invalid/?secret=NEVER_PERSIST")
        return {"run": {"arn": RUN, "status": self.status, "result": self.result}}

    def stop_run(self, **args):
        self.calls.append(("stop", args))
        self.status, self.result = "COMPLETED", "STOPPED"

    def list_jobs(self, **_):
        return {"jobs": [{"arn": "job", "name": "iPhone", "device": DEVICE, "status": self.status, "result": self.result}]}

    def list_suites(self, **_):
        return {"suites": [{"arn": "suite"}]}

    def list_tests(self, **_):
        return {"tests": [{"arn": "test"}]}

    def list_artifacts(self, **args):
        return {"artifacts": [{"arn": "artifact", "name": "../Customer Artifacts", "type": "CUSTOMER_ARTIFACT", "extension": "zip",
                               "url": "https://download.invalid/?secret=NEVER_PERSIST"}] if args["type"] == "FILE" else []}

    def list_runs(self, **_):
        return {"runs": [{"arn": RUN, "name": "itoma-1-1"}]}

    def delete_upload(self, **args):
        self.calls.append(("delete", args))


class InputTests(unittest.TestCase):
    def test_real_node_report_contract_and_partial_suite_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tests").mkdir()
            source = Path(__file__).resolve().parents[2] / "e2e" / "run.mjs"
            (root / "run.mjs").write_text(source.read_text())
            for ids in (SCENARIO_IDS, ["DF10", "DF20", "DF30", "DF40", "DF50"]):
                write_json(root / "scenarios.json", [{"id": value, "name": "contract"} for value in ids])
                for reported in (ids, [], ids[:-1], [ids[0]] * len(ids)):
                    (root / "tests" / "smoke.test.mjs").write_text("import { test, before, beforeEach, afterEach, after } from 'node:test';\n" +
                        "before(() => {}); beforeEach(() => {}); afterEach(() => {}); after(() => {});\n" +
                        "\n".join(f"test('{identity}: contract', () => {{}});" for identity in reported))
                    result = subprocess.run(["node", "run.mjs"], cwd=root, env={**os.environ, "DEVICEFARM_LOG_DIR": str(root)},
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode == 0, reported == ids, result.stderr)

    def test_scenario_catalog_requires_valid_unique_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "scenarios.json"
            for invalid in ([], [{"id": "DF01", "name": ""}], [{"id": "bad", "name": "case"}],
                            [{"id": "DF01", "name": "case"}] * 2):
                write_json(path, invalid)
                with self.assertRaises(ValueError):
                    scenario_ids(path)
            write_json(path, [{"id": "DF10", "name": "new case"}])
            self.assertEqual(scenario_ids(path), ["DF10"])

    def test_immutable_identifiers_and_pool_ownership(self):
        require_hex("a" * 40, 40, "SHA")
        validate_arns(PROJECT, POOL)
        for invalid in ("main", "a" * 7, "A" * 40, "a" * 40 + "\n"):
            with self.assertRaises(ValueError):
                require_hex(invalid, 40, "SHA")
        with self.assertRaises(ValueError):
            validate_arns(PROJECT, POOL.replace("123456789012", "123456789013"))
        with self.assertRaises(ValueError):
            validate_arns(PROJECT.replace("us-west-2", "ap-northeast-1"), POOL)

    def test_ipa_hash_bundle_platform_and_duplicate_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.ipa"
            info = {"CFBundleIdentifier": META["bundleId"], "CFBundleSupportedPlatforms": ["iPhoneOS"]}
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Payload/itoma.app/Info.plist", plistlib.dumps(info))
            inspect_ipa(directory, digest(path), META["bundleId"])
            for sha, bundle in (("0" * 64, META["bundleId"]), (digest(path), "com.wrong.app")):
                with self.assertRaises(ValueError):
                    inspect_ipa(directory, sha, bundle)
            info["CFBundleSupportedPlatforms"] = ["iPhoneSimulator"]
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Payload/itoma.app/Info.plist", plistlib.dumps(info))
            with self.assertRaises(ValueError):
                inspect_ipa(directory, digest(path), META["bundleId"])
            (Path(directory) / "other.ipa").touch()
            with self.assertRaises(ValueError):
                inspect_ipa(directory, digest(path), META["bundleId"])

    def test_report_rejects_zero_partial_skipped_and_wrong_build(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.zip"
            for count in (0, len(SCENARIO_IDS) - 1, len(SCENARIO_IDS) + 1):
                evidence(path, count=count)
                with self.assertRaises(ValueError):
                    verify_evidence(path, META)
            evidence(path, skipped=True)
            with self.assertRaises(ValueError):
                verify_evidence(path, META)
            evidence(path, metadata={**META, "appCommit": "d" * 40})
            with self.assertRaises(ValueError):
                verify_evidence(path, META)
            evidence(path)
            self.assertTrue(verify_evidence(path, META))
            expanded = {**META, "scenarioIds": ["DF10", "DF20", "DF30", "DF40", "DF50"]}
            evidence(path, metadata=expanded)
            self.assertTrue(verify_evidence(path, expanded))
            with self.assertRaises(ValueError):
                verify_evidence(path, {**expanded, "scenarioIds": ["DF10", "DF20", "DF30", "DF40", "DF60"]})

    def test_pagination_and_loop_guard(self):
        class Client:
            def read(self, **args):
                return {"items": [2]} if args.get("nextToken") else {"items": [1], "nextToken": "next"}
        self.assertEqual(list(pages(Client(), "read", "items")), [1, 2])
        class Loop:
            def read(self, **_):
                return {"items": [], "nextToken": "same"}
        with self.assertRaises(RuntimeError):
            list(pages(Loop(), "read", "items"))


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.client, self.clock = FakeFarm(), Clock()
        for name in ("app.ipa", "tests.zip", "test-spec.yml"):
            (self.directory / name).write_bytes(b"input")
        self.metadata = {**META, "ipaPath": str(self.directory / "app.ipa"), "ipaSha256": digest(self.directory / "app.ipa"),
                         "testPackageSha256": digest(self.directory / "tests.zip"), "testSpecSha256": digest(self.directory / "test-spec.yml")}
        write_json(self.directory / "input.json", self.metadata)
        self.runner = Runner(self.client, self.directory, clock=self.clock, sleep=self.clock.sleep, transfer_file=self.transfer)

    def transfer(self, _url, path, *, upload=False, **_):
        if not upload:
            if self.client.failed_download:
                raise OSError("https://signed.invalid/?secret=NEVER_PERSIST")
            evidence(path, count=0 if self.client.bad_evidence else None, metadata={**self.metadata, "runArn": RUN, "deviceArn": DEVICE["arn"]})
        return Path(path).stat().st_size

    def start(self):
        self.runner.start(PROJECT, POOL, "itoma-1-1", self.directory / "test-spec.yml")

    def test_success_requires_device_reports_and_cleans_all_uploads(self):
        self.start()
        self.assertTrue(self.runner.finalize())
        self.assertEqual(len([call for call in self.client.calls if call[0] == "delete"]), 3)
        self.assertEqual(len(self.runner.state["artifacts"]), 1)  # Job/suite/test duplicate artifact.
        self.assertEqual(len([call for call in self.client.calls if call[0] == "schedule"]), 1)
        scheduled = next(args for method, args in self.client.calls if method == "schedule")
        self.assertNotIn("devicePoolArn", scheduled)
        self.assertEqual(scheduled["deviceSelectionConfiguration"]["maxDevices"], 1)
        self.assertEqual(scheduled["deviceSelectionConfiguration"]["filters"][0]["values"], [DEVICE["arn"]])
        self.assertNotIn("NEVER_PERSIST", (self.directory / "run.json").read_text())
        self.assertTrue(self.runner.finalize())  # Re-reading a finalized run cannot create another run.
        with self.assertRaises(ValueError):
            self.start()

    def test_rejected_upload_never_schedules(self):
        self.client.upload_status = "FAILED"
        with self.assertRaises(RuntimeError):
            self.start()
        self.assertFalse(self.runner.finalize())
        self.assertFalse(any(call[0] == "schedule" for call in self.client.calls))
        self.assertTrue(any(call[0] == "delete" for call in self.client.calls))

    def test_pool_limits_and_private_or_old_devices_never_schedule(self):
        for changes in ({"maximum": 4}, {"maximum": 0}, {"devices": [{**DEVICE, "fleetType": "PRIVATE"}]},
                        {"devices": [{**DEVICE, "os": "17.0"}]}, {"devices": []}):
            with self.subTest(changes=changes):
                self.runner.state["phase"] = "not-started"
                self.client.maximum, self.client.devices = 1, [DEVICE.copy()]
                for key, value in changes.items():
                    setattr(self.client, key, value)
                with self.assertRaises(ValueError):
                    self.start()
                self.assertFalse(any(call[0] == "schedule" for call in self.client.calls))

    def test_remote_failure_still_collects_evidence(self):
        self.client.result = "FAILED"
        with self.assertRaises(RuntimeError):
            self.start()
        self.assertFalse(self.runner.finalize())
        self.assertTrue(self.runner.state["artifacts"])

    def test_suite_listing_error_still_collects_job_artifacts(self):
        self.start()
        def broken(**_):
            raise OSError("https://signed.invalid/?secret=NEVER_PERSIST")
        self.client.list_suites = broken
        self.assertFalse(self.runner.finalize())
        self.assertTrue(self.runner.state["artifacts"])
        self.assertNotIn("NEVER_PERSIST", (self.directory / "run.json").read_text())

    def test_queue_timeout_stops_and_collects(self):
        self.client.status = "RUNNING"
        with self.assertRaises(TimeoutError):
            self.start()
        self.assertFalse(self.runner.finalize())
        self.assertTrue(any(call[0] == "stop" for call in self.client.calls))
        self.assertTrue(self.runner.state["artifacts"])

    def test_read_failure_does_not_prevent_stop_and_cleanup(self):
        self.runner.state.update(runArn=RUN, status="RUNNING", uploads=["upload-1"], phase="running")
        self.client.read_failure = True
        self.assertFalse(self.runner.finalize())
        self.assertTrue(any(call[0] == "stop" for call in self.client.calls))
        self.assertTrue(any(call[0] == "delete" for call in self.client.calls))
        self.assertNotIn("NEVER_PERSIST", (self.directory / "run.json").read_text())

    def test_ambiguous_schedule_response_is_recovered_without_rescheduling(self):
        self.runner.state.update(projectArn=PROJECT, phase="scheduling", name="itoma-1-1", input=self.metadata, expectedJobs=1)
        self.assertTrue(self.runner.finalize())
        self.assertEqual(self.runner.state["runArn"], RUN)
        self.assertFalse(any(call[0] == "schedule" for call in self.client.calls))

    def test_missing_or_unavailable_artifacts_cannot_pass(self):
        for flag in ("failed_download", "bad_evidence"):
            with self.subTest(flag=flag):
                self.runner.state["phase"] = "not-started"
                setattr(self.client, flag, True)
                self.start()
                self.assertFalse(self.runner.finalize())
                self.assertNotIn("NEVER_PERSIST", (self.directory / "run.json").read_text())
                setattr(self.client, flag, False)


if __name__ == "__main__":
    unittest.main()
