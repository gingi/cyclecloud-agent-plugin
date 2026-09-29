"""Opt-in 8.10 artifact smoke tests, exclusively against a local fake backend.

Set CYCLECLOUD_TEST_CLI to the absolute official CLI executable to opt in.
The default suite never discovers/executes an external artifact or user config.
No network installs, real login, profile changes, or installed-code patches.
"""
import base64
import json
import os
import re
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
CLI = os.environ.get("CYCLECLOUD_TEST_CLI")


class FakeBackend(BaseHTTPRequestHandler):
    hits = []
    mode = "ok"

    def log_message(self, *args):
        pass

    @staticmethod
    def diagnostic_node():
        return {"ClusterName": "demo", "Name": "scheduler", "NodeId": "node-1", "Template": "scheduler",
                "InstanceId": "instance-1", "IsArray": False, "Abstract": False, "Status": "Failed",
                "StatusMessage": "Timeout awaiting system boot-up", "PhaseFailed": True, "InstallationStatus": None,
                "PhaseMap": {"Cloud.AwaitBootup": {"Status": "Failed", "StartTime": {"$date": "2026-09-15T18:03:22Z"},
                                                   "EndTime": {"$date": "2026-09-15T18:33:24Z"}}},
                "Configuration": {"password": "secret-canary"}}

    def do_GET(self):
        self.hits.append((self.path, dict(self.headers)))
        status = 200
        if self.mode == "unauthorized":
            status, body = 401, {"secret": "secret-canary"}
        elif self.mode == "large":
            body = {"secret": "secret-canary" * 800000}
        elif self.path.startswith("/prefix/cloud/api/clusters"):
            body = [{"ClusterName": "demo", "State": "Started", "Password": "secret-canary",
                     "Configuration": {"secret": "secret-canary"}}]
        elif self.path.startswith("/prefix/clusters/demo/status"):
            body = {"maxCount": 1, "maxCoreCount": 1, "nodearrays": [], "Secret": "secret-canary"}
        elif self.path.startswith("/prefix/exec/query/"):
            query = parse_qs(urlsplit(self.path).query)["q"][0]
            if "from Cloud.Node" in query and "order by NodeId" in query:
                body = [self.diagnostic_node(), {"ClusterName": "demo", "Name": "hpc-1", "NodeId": "node-2",
                                                "Template": "hpc", "IsArray": False, "Abstract": False, "Status": "Ready"}]
                if 'Status === "Failed"' in query:
                    body = [row for row in body if row.get("PhaseFailed") is True or row.get("Status") == "Failed"]
                if 'Template === "hpc"' in query:
                    body = [row for row in body if row["Template"] == "hpc"]
                cursor = re.search(r'NodeId > "([^"]+)"', query)
                if cursor:
                    body = [row for row in body if row["NodeId"] > cursor.group(1)]
                limit = re.search(r'limit (\d+)', query)
                if limit:
                    body = body[:int(limit.group(1))]
            elif "from Cloud.Node" in query and "PhaseMap" in query:
                body = [self.diagnostic_node()] if 'Name === "scheduler"' in query else []
            elif query.startswith("select ClusterName, Name, NodeId, IsArray, Abstract from Cloud.Node"):
                body = [{key: value for key, value in self.diagnostic_node().items()
                         if key in ("ClusterName", "Name", "NodeId", "IsArray", "Abstract")}]
                if 'Name === "scheduler"' not in query:
                    body = []
            elif "cloud.node.node_status" in query:
                if "NodeId" not in query:
                    body = []
                elif self.mode == "diagnostic-issues-denied":
                    status, body = 403, {"secret": "secret-canary"}
                else:
                    body = [{"Name": "Software Configuration", "Status": "Error", "Message": "Timeout awaiting system boot-up",
                             "Description": "No bootup message was received", "Secret": "secret-canary"}]
            elif "from Cloud.Instance" in query:
                body = [{"ClusterName": "demo", "InstanceId": "instance-1", "PowerState": "running",
                         "ProvisioningState": "succeeded", "StatusChecks": {"System": {"Status": "ok"}}, "Secret": "secret-canary"}]
            elif "cloud.cluster_event_log_datasource" in query:
                body = [{"_Timestamp": {"$date": "2026-09-15T18:04:51Z"}, "Level": "info",
                         "Message": "Reopened changed HTTPS tunnel", "Secret": "secret-canary"}]
            elif "from Activity" in query:
                body = [{"EventTime": {"$date": "2026-09-15T18:33:24Z"}, "EventType": "NodeCreated", "Status": "Failed"}]
            elif query in (
                    'select ClusterName, Name, State, TargetState from Cloud.Node where ClusterName === "demo"'
                    ' && IsArray === true && Abstract =!= true',
                    'select ClusterName, count(*) as Count from Cloud.Node where IsArray === true && Abstract =!= true'
                    ' && (ClusterName === "demo") group by ClusterName'):
                if self.mode == "definitions-denied":
                    status, body = 403, {"secret": "secret-canary"}
                elif "count(*)" in query:
                    body = [{"ClusterName": "demo", "Count": 6}]
                else:
                    body = [{"ClusterName": "demo", "Name": name, "State": "Activated"}
                            for name in ("scheduler-ha", "login", "htc", "hpc", "gpu", "dynamic")]
            elif "from Cloud.Node" in query:
                body = [{"Name": "scheduler", "Template": "scheduler", "State": "Started",
                         "ImageName": "fake-image", "AttachmentReference": "$Specs", "ClusterInitSpecs": {},
                         "Mounts": {}, "Volumes": {}, "Secret": "secret-canary"}]
            elif "from Cloud.ClusterParameter" in query:
                body = [{"Name": "Specs", "ParameterType": "Cloud.ClusterInitSpecs", "Value": {}, "Secret": "secret-canary"}]
            else:
                body = [{"Name": "fake-image", "PackageType": "image", "OS": "linux", "JetpackPlatform": "ubuntu-22.04", "Secret": "secret-canary"}]
        else:
            status, body = 404, {}
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


@unittest.skipUnless(CLI, "Opt in with an explicitly approved CYCLECLOUD_TEST_CLI artifact")
class OfficialCLI810Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not Path(CLI).is_absolute():
            raise AssertionError("CYCLECLOUD_TEST_CLI must be an absolute executable path")
        cls.temporary = tempfile.TemporaryDirectory(prefix="inspect-official-smoke-")
        cls.directory = Path(cls.temporary.name)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeBackend)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        # Reuse the CLI's existing encoding primitive for synthetic credentials.
        python = Path(CLI).resolve().parent / "python3"
        encoded = subprocess.run([str(python), "-I", "-B", "-c",
                                  "from cyclecli.util import encode; print(encode('fake-password'))"],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=True).stdout.decode().strip()
        cls.config = cls.directory / "fake-config.ini"
        cls.config.write_text("[cycleserver]\nurl=http://127.0.0.1:%d/prefix\nusername=fake-user\nkey=%s\nauth_option=username_password\nverify_certificates=true\n" % (cls.server.server_port, encoded))
        cls.original_config = cls.config.read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temporary.cleanup()

    def setUp(self):
        FakeBackend.hits.clear()
        FakeBackend.mode = "ok"

    def invoke(self, args, config=True):
        if config:
            args = list(args) + ["--config", str(self.config)]
        process = subprocess.run(["/bin/sh", str(ROOT / "scripts/cyclecloud-inspect")] + args,
                                 env=dict(os.environ, CYCLECLOUD_CLI=CLI),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        self.assertEqual(process.stderr, b"")
        self.assertLessEqual(len(process.stdout), 1024 * 1024)
        self.assertNotIn(b"secret-canary", process.stdout)
        self.assertNotIn(b"fake-password", process.stdout)
        self.assertEqual(self.config.read_bytes(), self.original_config)
        return process.returncode, json.loads(process.stdout)

    def test_offline_capabilities_do_not_load_config_or_contact_backend(self):
        code, value = self.invoke(["capabilities", "--config", str(self.directory / "does-not-exist")], config=False)
        self.assertEqual(code, 0, value)
        self.assertEqual(value["result"]["backend"], "compat")
        self.assertTrue(value["result"]["cliVersion"].startswith("8.10."))
        self.assertEqual(FakeBackend.hits, [])
        if "SNAPSHOT" in value["result"]["cliVersion"]:
            self.assertFalse(value["result"]["developmentBuild"]["testedStableRelease"])

    def test_all_read_commands_and_application_sections(self):
        commands = [["clusters"], ["cluster", "demo"], ["status", "demo"], ["application-context", "demo"]]
        commands += [["application-context", "demo", "--view", "details", "--target-name", "scheduler", "--section", section]
                     for section in ("environment", "storage", "attachments")]
        for args in commands:
            with self.subTest(command=args):
                code, value = self.invoke(args)
                self.assertEqual(code, 0, value)
                self.assertEqual(value["command"], args[0])
                self.assertIn("result", value)
        expected = "Basic " + base64.b64encode(b"fake-user:fake-password").decode()
        for path, headers in FakeBackend.hits:
            self.assertTrue(path.startswith("/prefix/"))
            self.assertEqual(headers["Authorization"], expected)
            self.assertNotIn("fake-password", path)
            if "/exec/query/" in path:
                self.assertEqual(headers["Accept"], "*/*")
                self.assertNotIn("select *", parse_qs(urlsplit(path).query)["q"][0])

    def test_discovery_pages_and_selected_node_diagnostics(self):
        code, value = self.invoke(["nodes", "demo", "--limit", "1"])
        self.assertEqual(code, 0, value)
        page = value["result"]["nodes"]
        self.assertEqual([row["name"] for row in page["items"]], ["scheduler"])
        self.assertTrue(page["truncated"])
        self.assertEqual(page["nextAfterNodeId"], "node-1")
        self.assertNotIn("total", page)
        code, value = self.invoke(["nodes", "demo", "--limit", "1", "--after-node-id", page["nextAfterNodeId"]])
        self.assertEqual(code, 0, value)
        self.assertEqual([row["name"] for row in value["result"]["nodes"]["items"]], ["hpc-1"])
        self.assertFalse(value["result"]["nodes"]["truncated"])
        for flags, expected in ((["--problems-only"], "scheduler"), (["--node-array", "hpc"], "hpc-1")):
            code, value = self.invoke(["nodes", "demo"] + flags)
            self.assertEqual(code, 0, value)
            self.assertEqual([row["name"] for row in value["result"]["nodes"]["items"]], [expected])
        queries = [parse_qs(urlsplit(path).query)["q"][0] for path, _ in FakeBackend.hits if "/exec/query/" in path]
        self.assertTrue(all("order by NodeId" in query and "limit" in query for query in queries))
        self.assertTrue(all("PhaseMap" not in query and "Cloud.Instance" not in query for query in queries))
        code, value = self.invoke(["node-diagnostics", "demo", "--node-name", "scheduler"])
        self.assertEqual(code, 0, value)
        evidence = value["result"]["diagnostics"]
        self.assertIsNone(evidence["node"]["installationStatus"])
        self.assertEqual(evidence["issues"]["items"][0]["description"], "No bootup message was received")
        self.assertEqual(evidence["phases"]["items"][0]["elapsedSeconds"], 1802)
        self.assertEqual(evidence["vm"]["powerState"], "running")

    def test_diagnostic_partial_denial_and_cluster_wide_recovery_events(self):
        FakeBackend.mode = "diagnostic-issues-denied"
        code, value = self.invoke(["node-diagnostics", "demo", "--node-name", "scheduler"])
        self.assertEqual(code, 0, value)
        evidence = value["result"]["diagnostics"]
        self.assertFalse(evidence["issues"]["available"])
        self.assertTrue(evidence["vm"]["available"])
        FakeBackend.hits.clear()
        code, value = self.invoke(["cluster-events", "demo", "--node-name", "scheduler"])
        self.assertEqual(code, 0, value)
        events = value["result"]["events"]
        self.assertEqual(events["clusterEvents"]["items"][0]["message"], "Reopened changed HTTPS tunnel")
        self.assertTrue(events["nodeActivity"]["available"])
        self.assertNotIn("total", events["clusterEvents"])
        self.assertNotIn("total", events["nodeActivity"])
        queries = [parse_qs(urlsplit(path).query)["q"][0] for path, _ in FakeBackend.hits if "/exec/query/" in path]
        self.assertEqual(len(queries), 3)
        self.assertTrue(queries[0].startswith("select ClusterName, Name, NodeId, IsArray, Abstract from Cloud.Node"))
        self.assertTrue(all("PhaseMap" not in query for query in queries))
        FakeBackend.hits.clear()
        code, value = self.invoke(["node-diagnostics", "demo", "--node-name", "missing"])
        self.assertEqual(code, 1, value)
        self.assertEqual(value["error"]["code"], "node_not_found")
        self.assertEqual(len(FakeBackend.hits), 2)

    def test_definition_evidence_is_independent_of_legacy_groups_and_detail_limit(self):
        code, value = self.invoke(["clusters"])
        self.assertEqual(code, 0, value)
        summary = value["result"]["clusters"][0]
        self.assertEqual(summary["nodeArrayCount"], 0)
        self.assertEqual(summary["nodeArraySummarySemantics"], "instantiated-node-groups")
        self.assertEqual(summary["nodeArrayDefinitions"], {"available": True, "total": 6})
        for limit in (0, 2):
            with self.subTest(limit=limit):
                code, value = self.invoke(["cluster", "demo", "--node-array-limit", str(limit)])
                self.assertEqual(code, 0, value)
                detail = value["result"]["cluster"]
                self.assertEqual(detail["nodeArrayTotal"], 0)
                self.assertEqual(detail["nodeArraySummarySemantics"], "instantiated-node-groups")
                self.assertEqual(detail["nodeArrayDefinitions"], {
                    "available": True, "total": 6, "returned": limit, "truncated": True,
                    "items": [{"name": name, "state": "Activated"} for name in ("dynamic", "gpu")[:limit]],
                })

    def test_denied_definitions_preserve_primary_success_without_inventing_zero(self):
        FakeBackend.mode = "definitions-denied"
        for args, key in ((["clusters"], "clusters"), (["cluster", "demo"], "cluster")):
            with self.subTest(command=args):
                code, value = self.invoke(args)
                self.assertEqual(code, 0, value)
                result = value["result"][key]
                row = result[0] if key == "clusters" else result
                self.assertEqual(row["nodeArrayDefinitions"], {
                    "available": False, "warning": "Configured node-array definitions could not be retrieved or validated.",
                })

    def test_unconfigured_and_invalid_input_are_noninteractive(self):
        code, value = self.invoke(["clusters", "--config", str(self.directory / "does-not-exist")], config=False)
        self.assertEqual(code, 1)
        self.assertEqual(value["error"]["code"], "configuration_required")
        code, value = self.invoke(["clusters", "--limit", "0"])
        self.assertEqual(code, 2)
        self.assertEqual(value["error"]["code"], "invalid_arguments")
        self.assertEqual(FakeBackend.hits, [])

    def test_auth_and_oversized_errors_are_bounded_and_sanitized(self):
        for mode, expected in (("unauthorized", "authentication_required"), ("large", "invalid_response")):
            FakeBackend.mode = mode
            code, value = self.invoke(["clusters"])
            self.assertEqual(code, 1)
            self.assertEqual(value["error"]["code"], expected)


if __name__ == "__main__":
    unittest.main()
