"""Opt-in 8.10 artifact smoke tests, exclusively against a local fake backend.

Set CYCLECLOUD_TEST_CLI to the absolute official CLI executable to opt in.
The default suite never discovers/executes an external artifact or user config.
No network installs, real login, profile changes, or installed-code patches.
"""
import base64
import json
import os
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
            if "cloud.node.node_status" in query:
                body = []
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
