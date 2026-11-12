"""Bounded Device Farm lifecycle. No AWS calls occur when importing this module."""

import argparse
import json
import os
from pathlib import Path
import re
import signal
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

from prepare import digest, write_json

REGION = "us-west-2"
MAX_DEVICES = 3
MAX_FILE_BYTES = 500 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024


def error_code(error):
    # Never persist HTTP exception text, AWS signed URLs, or request headers.
    code = getattr(error, "response", {}).get("Error", {}).get("Code", type(error).__name__)
    return re.sub(r"[^A-Za-z0-9_.-]", "_", code)[:80]


def validate_arns(project, pool):
    match = re.fullmatch(r"arn:aws:devicefarm:us-west-2:(\d{12}):project:([0-9a-f-]{36})", project)
    if not match or not re.fullmatch(
        re.escape(f"arn:aws:devicefarm:us-west-2:{match[1]}:devicepool:{match[2]}/") + r"[0-9a-f-]{36}", pool
    ):
        raise ValueError("Configure an owned us-west-2 project and a device pool in that project")


def pages(client, method, field, **parameters):
    token = None
    seen = set()
    while True:
        response = getattr(client, method)(**parameters, **({"nextToken": token} if token else {}))
        yield from response.get(field, [])
        token = response.get("nextToken")
        if not token:
            return
        if token in seen:
            raise RuntimeError("Repeated pagination token")
        seen.add(token)


def transfer(url, path, *, upload=False, limit=MAX_FILE_BYTES):
    if not url.startswith("https://"):
        raise ValueError("Device Farm transfers require HTTPS")
    if upload:
        with Path(path).open("rb") as source:
            request = urllib.request.Request(url, data=source, method="PUT", headers={
                "Content-Type": "application/octet-stream", "Content-Length": str(Path(path).stat().st_size),
            })
            with urllib.request.urlopen(request, timeout=120) as response:
                response.read(1024)
        return Path(path).stat().st_size
    total = 0
    try:
        with urllib.request.urlopen(url, timeout=60) as response, Path(path).open("wb") as destination:
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > limit:
                    raise ValueError("Artifact download exceeds the configured byte limit")
                destination.write(block)
    except BaseException:
        Path(path).unlink(missing_ok=True)
        raise
    return total


class Runner:
    def __init__(self, client, directory, *, clock=time.monotonic, sleep=time.sleep, transfer_file=transfer):
        self.client = client
        self.directory = Path(directory)
        self.clock, self.sleep, self.transfer = clock, sleep, transfer_file
        self.state_path = self.directory / "run.json"
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {
            "phase": "not-started", "runArn": None, "uploads": [], "errors": [], "artifacts": [], "jobs": [],
        }

    def save(self):
        write_json(self.state_path, self.state)

    def error(self, stage, error):
        entry = {"stage": stage, "code": error_code(error)}
        if type(error) in (ValueError, RuntimeError, TimeoutError):
            entry["detail"] = str(error)
        self.state["errors"].append(entry)
        self.save()

    def wait(self, read, done, deadline):
        while self.clock() < deadline:
            value = read()
            if done(value):
                return value
            self.sleep(min(15, max(0, deadline - self.clock())))
        raise TimeoutError("Device Farm deadline reached")

    def upload(self, path, kind, deadline):
        created = self.client.create_upload(projectArn=self.state["projectArn"], name=Path(path).name,
                                            type=kind, contentType="application/octet-stream")["upload"]
        self.state["uploads"].append(created["arn"])
        self.save()
        self.transfer(created["url"], path, upload=True)
        upload = self.wait(lambda: self.client.get_upload(arn=created["arn"])["upload"],
                           lambda value: value["status"] in ("SUCCEEDED", "FAILED"), min(deadline, self.clock() + 600))
        if upload["status"] != "SUCCEEDED":
            raise RuntimeError("Device Farm rejected an upload")
        return created["arn"]

    def start(self, project, pool, name, test_spec):
        validate_arns(project, pool)
        if self.state["phase"] != "not-started":
            raise ValueError("Refusing to schedule a second run in an existing output directory")
        deadline = self.clock() + 45 * 60  # Includes upload processing and the device queue.
        metadata = json.loads((self.directory / "input.json").read_text())
        for path, expected in ((metadata["ipaPath"], metadata["ipaSha256"]),
                               (self.directory / "tests.zip", metadata["testPackageSha256"]),
                               (test_spec, metadata["testSpecSha256"])):
            if digest(path) != expected:
                raise ValueError("Input changed after packaging")
        self.state.update(projectArn=project, poolArn=pool, name=name, input=metadata, phase="uploading")
        self.save()
        maximum = self.client.get_device_pool(arn=pool)["devicePool"].get("maxDevices", 0)
        if not 1 <= maximum <= MAX_DEVICES:
            raise ValueError("The device pool must explicitly set maxDevices between 1 and 3")
        app = self.upload(metadata["ipaPath"], "IOS_APP", deadline)
        package = self.upload(self.directory / "tests.zip", "APPIUM_NODE_TEST_PACKAGE", deadline)
        spec = self.upload(test_spec, "APPIUM_NODE_TEST_SPEC", deadline)
        test = {"type": "APPIUM_NODE", "testPackageArn": package, "testSpecArn": spec}
        compatibility = self.client.get_device_pool_compatibility(projectArn=project, devicePoolArn=pool,
                                                                 appArn=app, test=test)
        devices = [item["device"] for item in compatibility.get("compatibleDevices", [])]
        if not devices or len(devices) > maximum or compatibility.get("incompatibleDevices"):
            raise ValueError("The selected pool must have 1-3 compatible devices and no incompatible devices")
        if any(device["platform"] != "IOS" or device.get("fleetType") != "PUBLIC"
               or int(device["os"].split(".")[0]) < 18 for device in devices):
            raise ValueError("This suite requires public iOS 18+ devices")
        self.state["expectedJobs"] = len(devices)
        self.state["phase"] = "scheduling"
        self.save()
        # No automatic retries: ScheduleRun has no idempotency token and starts billable work.
        run = self.client.schedule_run(
            projectArn=project, appArn=app, name=name, test=test,
            # Freeze the checked device identities so a pool edit cannot expand this run.
            deviceSelectionConfiguration={"filters": [{"attribute": "ARN", "operator": "IN",
                                                       "values": [device["arn"] for device in devices]}],
                                          "maxDevices": len(devices)},
            configuration={"billingMethod": "METERED", "locale": "ja_JP"},
            executionConfiguration={"jobTimeoutMinutes": 10, "videoCapture": True,
                                    "accountsCleanup": True, "appPackagesCleanup": True, "skipAppResign": False},
        )["run"]
        self.state.update(runArn=run["arn"], phase="running")
        self.save()
        self.record_run(self.wait(lambda: self.client.get_run(arn=run["arn"])["run"],
                                  lambda value: value["status"] == "COMPLETED", deadline))
        if self.state["result"] != "PASSED":
            raise RuntimeError("Device Farm run did not pass")

    def record_run(self, run):
        self.state.update(status=run["status"], result=run.get("result"), counters=run.get("counters"),
                          deviceMinutes=run.get("deviceMinutes"))
        self.save()

    def stop(self):
        if self.state.get("runArn") and self.state.get("status") != "COMPLETED":
            self.client.stop_run(arn=self.state["runArn"])
            self.state["stopRequested"] = True
            self.save()

    def collect_job(self, job, index, deadline):
        device = job.get("device", {})
        record = {key: job.get(key) for key in ("arn", "name", "status", "result", "counters", "deviceMinutes")}
        record["device"] = {key: device.get(key) for key in ("arn", "name", "platform", "os", "fleetType")}
        record["scenarioEvidence"] = False
        self.state["jobs"].append(record)
        scopes = [job["arn"]]
        # Include suite/test artifacts as well as job logs/video; deduplicate by artifact ARN.
        try:
            for suite in pages(self.client, "list_suites", "suites", arn=job["arn"]):
                scopes.append(suite["arn"])
                scopes.extend(test["arn"] for test in pages(self.client, "list_tests", "tests", arn=suite["arn"]))
        except Exception as error:
            self.error("list-suites-or-tests", error)
        seen = set()
        for scope in scopes:
            for kind in ("FILE", "LOG", "SCREENSHOT"):
                try:
                    artifacts = list(pages(self.client, "list_artifacts", "artifacts", arn=scope, type=kind))
                except Exception as error:
                    self.error("list-artifacts", error)
                    continue
                for artifact in artifacts:
                    if artifact["arn"] in seen:
                        continue
                    seen.add(artifact["arn"])
                    entry = {key: artifact.get(key) for key in ("arn", "name", "type", "extension")}
                    entry["jobArn"] = job["arn"]
                    self.state["artifacts"].append(entry)
                    try:
                        if self.clock() > deadline:
                            raise TimeoutError("Artifact collection deadline reached")
                        remaining = MAX_TOTAL_BYTES - sum(item.get("bytes", 0) for item in self.state["artifacts"])
                        if remaining <= 0:
                            raise ValueError("Total artifact byte limit reached")
                        extension = re.sub(r"[^a-zA-Z0-9]", "", artifact.get("extension", "bin"))[:12] or "bin"
                        name = re.sub(r"[^a-zA-Z0-9_.-]", "_", artifact.get("name", "artifact"))[:80]
                        relative = Path("artifacts") / str(index) / f"{len(seen):04d}-{name}.{extension}"
                        path = self.directory / relative
                        path.parent.mkdir(parents=True, exist_ok=True)
                        entry["bytes"] = self.transfer(artifact["url"], path, limit=min(MAX_FILE_BYTES, remaining))
                        entry["path"], entry["sha256"] = str(relative), digest(path)
                        expected = {**self.state["input"], "runArn": self.state["runArn"], "deviceArn": device["arn"]}
                        if zipfile.is_zipfile(path) and verify_evidence(path, expected):
                            record["scenarioEvidence"] = True
                    except Exception as error:
                        entry["error"] = error_code(error)
                        self.error("download-artifact", error)
        self.save()

    def finalize(self):
        if self.state["phase"] == "finalized":
            return self.state["passed"]
        # Recover the ARN if ScheduleRun was accepted but its response/checkpoint was lost.
        if self.state["phase"] == "scheduling" and not self.state.get("runArn"):
            try:
                matches = [run for run in pages(self.client, "list_runs", "runs", projectArn=self.state["projectArn"])
                           if run.get("name") == self.state["name"]]
                if len(matches) == 1:
                    self.state["runArn"] = matches[0]["arn"]
                    self.save()
                else:
                    for run in matches:
                        self.client.stop_run(arn=run["arn"])
                    raise RuntimeError("Unable to uniquely recover the scheduled run; inspect the AWS console")
            except Exception as error:
                self.error("recover-schedule-arn", error)
        try:
            if self.state.get("runArn"):
                self.record_run(self.client.get_run(arn=self.state["runArn"])["run"])
                self.stop()
                if self.state["status"] != "COMPLETED":
                    self.record_run(self.wait(lambda: self.client.get_run(arn=self.state["runArn"])["run"],
                                              lambda run: run["status"] == "COMPLETED", self.clock() + 120))
        except Exception as error:
            self.error("stop-or-read-run", error)
            # A read failure must not prevent the independent stop attempt.
            try:
                self.stop()
            except Exception as stop_error:
                self.error("stop-run", stop_error)
        try:
            if self.state.get("runArn"):
                deadline = self.clock() + 600
                for index, job in enumerate(pages(self.client, "list_jobs", "jobs", arn=self.state["runArn"])):
                    try:
                        self.collect_job(job, index, deadline)
                    except Exception as error:
                        self.error("collect-job", error)
        except Exception as error:
            self.error("list-jobs", error)
        finally:
            # Only our uploads; never delete projects, pools, or the run's result records.
            for arn in self.state["uploads"]:
                try:
                    self.client.delete_upload(arn=arn)
                except Exception as error:
                    self.error("delete-upload", error)
        jobs = self.state["jobs"]
        self.state["passed"] = (self.state.get("result") == "PASSED" and not self.state["errors"]
                                and len(jobs) == self.state.get("expectedJobs") and bool(jobs)
                                and all(job["status"] == "COMPLETED" and job["result"] == "PASSED"
                                        and job["scenarioEvidence"] for job in jobs))
        self.state["phase"] = "finalized"
        self.save()
        return self.state["passed"]


def verify_evidence(path, expected):
    """Require per-device reports, four non-skipped scenarios and matching build metadata."""
    with zipfile.ZipFile(path) as archive:
        reports = [name for name in archive.namelist() if Path(name).name == "junit.xml"]
        sessions = [name for name in archive.namelist() if Path(name).name == "session.json"]
        if not reports and not sessions:
            return False
        if len(reports) != 1 or len(sessions) != 1:
            raise ValueError("Missing or ambiguous E2E evidence")
        if any(archive.getinfo(name).file_size > 1024 * 1024 for name in reports + sessions):
            raise ValueError("Unexpectedly large E2E report")
        root = ET.fromstring(archive.read(reports[0]))
        cases = root.findall(".//testcase")
        if len(cases) != 4 or any(case.find(tag) is not None for case in cases for tag in ("skipped", "failure", "error")):
            raise ValueError("Four passing E2E cases are required")
        if {case.get("name", "").split(":")[0] for case in cases} != {"DF01", "DF02", "DF03", "DF04"}:
            raise ValueError("Unexpected scenario set")
        session = json.loads(archive.read(sessions[0]))
        keys = ("appCommit", "testCommit", "ipaSha256", "bundleId") + tuple(key for key in ("runArn", "deviceArn") if key in expected)
        if any(session.get(key) != expected[key] for key in keys):
            raise ValueError("E2E evidence does not match the requested build")
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "finalize"))
    parser.add_argument("--output-dir", default=os.environ.get("ITOMA_OUTPUT_DIR"), required=False)
    args = parser.parse_args()
    if not args.output_dir:
        parser.error("--output-dir or ITOMA_OUTPUT_DIR is required")
    import boto3
    from botocore.config import Config
    client = boto3.client("devicefarm", region_name=REGION, config=Config(
        connect_timeout=10, read_timeout=30, retries={"mode": "standard", "total_max_attempts": 1}))
    runner = Runner(client, args.output_dir)
    if args.command == "finalize":
        passed = runner.finalize()
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a") as stream:
                stream.write(f"Device Farm: **{'PASS' if passed else 'FAIL'}**\n\n")
                stream.write(f"- Run ARN: `{runner.state.get('runArn')}`\n")
                stream.write("- Scope: public iOS UI smoke; Screen Time enforcement remains unverified.\n")
                stream.write("- Evidence: run.json and per-device logs/video/JUnit in the Actions artifact.\n")
        return 0 if passed else 1

    def interrupted(_signum, _frame):
        raise InterruptedError("Runner interrupted")

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        runner.start(os.environ["DEVICE_FARM_PROJECT_ARN"], os.environ["DEVICE_FARM_DEVICE_POOL_ARN"],
                     f"itoma-{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}",
                     Path(__file__).resolve().parents[2] / "e2e" / "device-farm.yml")
        return 0
    except Exception as error:
        runner.error("run", error)
        print(f"Device Farm run failed: {error_code(error)}; see run.json", file=sys.stderr)
        return 1
    finally:
        try:
            runner.stop()
        except Exception as error:
            runner.error("stop-run", error)


if __name__ == "__main__":
    sys.exit(main())
