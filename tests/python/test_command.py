"""Public parsing and envelope boundaries, independent of an installed CLI."""
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
from cyclecloud_agent_inspect.errors import InspectionError
from cyclecloud_agent_inspect import command


class CommandTests(unittest.TestCase):
    def test_strict_arguments_are_sanitized(self):
        for argv in (["clusters", "--password", "secret-canary"],
                     ["cluster"], ["clusters", "--limit", "secret-canary"],
                     ["clusters", "--lim", "2"], ["destroy", "secret-canary"],
                     ["clusters", "--limit", "0"],
                     ["application-context", "c", "--view", "details"],
                     ["status", "c", "--issue-limit", "101"]):
            with self.subTest(argv=argv), self.assertRaises(InspectionError) as raised:
                command.parse_args(argv)
            self.assertEqual(raised.exception.code, "invalid_arguments")
            self.assertNotIn("secret-canary", str(raised.exception))

    def test_config_requires_an_absolute_posix_path(self):
        for operation in ("capabilities",) + command.COMMANDS:
            argv = [operation] + ([] if operation in ("capabilities", "clusters") else ["c"])
            for path in ("profile.ini", "../profile.ini", "~/profile.ini", "C:\\profile.ini", "\\\\server\\profile.ini",
                         "", "/secret-canary\n", "/" + "a" * 4096):
                with self.subTest(operation=operation, path=path):
                    with self.assertRaises(InspectionError) as raised:
                        command.parse_args(argv + ["--config", path])
                    self.assertEqual(raised.exception.code, "invalid_arguments")
                    self.assertNotIn("secret-canary", str(raised.exception))
            for path in ("/existing/profile.ini", "/path with spaces/profile.ini", "/mnt/c/profile.ini"):
                with self.subTest(operation=operation, path=path):
                    self.assertEqual(command.parse_args(argv + ["--config", path]).config, path)
            self.assertIsNone(command.parse_args(argv).config)

    def test_mapping(self):
        parsed = command.parse_args(["application-context", " c ", "--target-name", "n",
                                     "--view", "details", "--section", "storage",
                                     "--item-limit", "2", "--offset", "3", "--config", "/fake"])
        self.assertEqual(parsed.input["clusterName"], "c")
        self.assertEqual(parsed.input["targetNames"], ["n"])
        self.assertEqual(parsed.input["itemLimit"], 2)
        self.assertEqual(parsed.input["offset"], 3)
        self.assertEqual(parsed.config, "/fake")
        self.assertEqual(command.parse_args(["cluster", "c", "--fixed-node-limit", "0"]).input["fixedNodeLimit"], 0)
        self.assertEqual(command.parse_args(["status", "c", "--bucket-limit", "1"]).input["bucketLimit"], 1)
        self.assertEqual(command.parse_args(["clusters"]).input, {"limit": 50})

    def test_application_prefix_defaults_and_overrides_across_views_and_pages(self):
        requests = [[], ["--view", "details", "--target-name", "scheduler", "--section", "storage"],
                    ["--view", "details", "--target-name", "scheduler", "--section", "storage", "--offset", "5"]]
        for options in requests:
            with self.subTest(options=options):
                argv = ["application-context", "demo", "--schema-version", "1"] + options
                implicit = command.parse_args(argv)
                explicit = command.parse_args(argv + ["--install-path", "/shared/apps"])
                self.assertEqual(implicit.input, explicit.input)
                self.assertEqual(implicit.input["installPath"], "/shared/apps")
                custom = command.parse_args(argv + ["--install-path", "/opt/cluster-apps"])
                self.assertEqual(custom.input["installPath"], "/opt/cluster-apps")

    def test_schema_rejected_before_execution(self):
        with self.assertRaises(InspectionError) as raised:
            command.parse_args(["clusters", "--schema-version", "2"])
        self.assertEqual(raised.exception.code, "incompatible_schema")

    def test_help_is_human_and_offline(self):
        with patch("sys.stdout", new_callable=io.StringIO) as output:
            with self.assertRaises(SystemExit) as raised:
                command.parse_args(["--help"])
        self.assertEqual(raised.exception.code, 0)
        self.assertIn("application-context", output.getvalue())

    def test_envelopes_and_native_error_redaction(self):
        envelope = command.envelope("clusters", result={"clusters": []})
        self.assertEqual(command.validate_envelope(json.dumps(envelope).encode(), "clusters"), envelope)
        for malformed in (b"noise", b'{}', b'{"schemaVersion":true,"command":"clusters","result":{}}',
                          b'{"schemaVersion":1,"command":"status","result":{}}',
                          b'{"schemaVersion":1,"command":"clusters","result":{},"error":{}}'):
            with self.assertRaises(InspectionError):
                command.validate_envelope(malformed, "clusters")
        incoming = command.envelope("clusters", error=InspectionError("authentication_required", "secret-canary"))
        validated = command.validate_envelope(json.dumps(incoming).encode(), "clusters")
        self.assertNotIn("secret-canary", json.dumps(validated))
        self.assertEqual(validated["error"]["code"], "authentication_required")

    def test_all_operations_dispatch_to_core(self):
        routes = {"clusters": "read_cluster_list", "cluster": "read_cluster",
                  "status": "read_cluster_status", "application-context": "read_application_context"}
        for operation, method in routes.items():
            argv = [operation] + ([] if operation == "clusters" else ["c"])
            parsed = command.parse_args(argv)
            client = object()
            with patch("cyclecloud_agent_inspect.context_reader." + method, return_value={"safe": True}) as read:
                self.assertEqual(command.execute(parsed, client), {"safe": True})
            read.assert_called_once_with(client, parsed.input)


if __name__ == "__main__":
    unittest.main()
