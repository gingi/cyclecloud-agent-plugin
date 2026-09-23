"""Self-contained official-layout fixtures: no pip, network or user config."""
import base64
import hashlib
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import venv
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))
from cyclecloud_agent_inspect import command, launcher
from cyclecloud_agent_inspect.errors import InspectionError
from cyclecloud_agent_inspect.process import Deadline

SCRIPT = ROOT / "scripts" / "cyclecloud-inspect"


def probe(stdout=b"", stderr=b"", status=0):
    return SimpleNamespace(stdout=stdout, stderr=stderr, returncode=status, stderr_truncated=False)


def capabilities(version="8.11.0", schema=1, commands=None):
    return command.envelope("capabilities", result={"cliVersion": version, "inspectionContracts": [
        {"version": schema, "commands": list(command.COMMANDS) if commands is None else commands}]})


class RoutingTests(unittest.TestCase):
    def route(self, replies, args=None, version=(8, 10, 0)):
        args = args or ["clusters"]
        with patch.object(launcher, "verify_environment", return_value=version), patch.object(launcher, "run", side_effect=replies) as run:
            value = launcher.route("/fake/bin/cyclecloud", command.parse_args(args), args, Deadline(5), launcher.load_policy())
        return value, run

    def test_known_stock_absence_only(self):
        value, run = self.route([probe(b"CycleCloud 8.10.0\n"), probe(b"Usage: cyclecloud ...", b"**** Error: Unknown command 'inspect'\n", 1)], ["capabilities"])
        self.assertEqual(value["result"]["backend"], "compat")
        self.assertEqual(run.call_count, 2)

    def test_snapshot_is_explicit_development_build(self):
        value, _ = self.route([probe(b"CycleCloud 8.10.0-SNAPSHOT\n"), probe(b"Usage: cyclecloud ...", b"**** Error: Unknown command 'inspect'\n", 1)], ["capabilities"])
        self.assertFalse(value["result"]["developmentBuild"]["testedStableRelease"])

    def test_packaged_numeric_build_accepts_matching_810_distribution(self):
        value, run = self.route([probe(b"CycleCloud 8.10.0-3902\n"), probe(b"Usage: cyclecloud ...", b"**** Error: Unknown command 'inspect'\n", 1)], ["capabilities"], (8, 10, 0))
        self.assertEqual(value["result"]["backend"], "compat")
        self.assertEqual(value["result"]["cliVersion"], "8.10.0-3902")
        self.assertNotIn("developmentBuild", value["result"])
        self.assertEqual(run.call_count, 2)

    def test_packaged_numeric_build_does_not_enable_future_fallback(self):
        with self.assertRaises(InspectionError) as raised:
            self.route([probe(b"CycleCloud 8.11.0-3902"), probe(b"Usage: command", b"**** Error: Unknown command 'inspect'", 1)], ["capabilities"], (8, 11, 0))
        self.assertEqual(raised.exception.code, "unsupported_cli")

    def test_native_preferred_for_compatible_810(self):
        value, run = self.route([probe(b"CycleCloud 8.10.0\n"), probe(command.encode(capabilities("8.10.0"))),
                                 probe(command.encode(command.envelope("clusters", result={"clusters": []})))])
        self.assertEqual(value["result"], {"clusters": []})
        self.assertIn("inspect", run.call_args.args[0])
        self.assertNotIn("--worker", run.call_args.args[0])

    def test_future_native_accepted(self):
        value, _ = self.route([probe(b"incidental warning\nCycleCloud 9.0.1\n"), probe(command.encode(capabilities("9.0.1")))], ["capabilities"], (9, 0, 1))
        self.assertEqual(value["result"]["backend"], "native")

    def test_native_failure_never_falls_back(self):
        failures = [probe(b"not JSON", status=1), probe(b"", b"authentication secret-canary", 1),
                    probe(command.encode(capabilities(schema=2))),
                    probe(command.encode(capabilities(commands=["clusters"]))),
                    probe(b"Usage: command", b"Unknown command 'inspect'", 1),
                    probe(b"Usage: command", b"**** Error: Unknown command 'inspect'", 2)]
        for failure in failures:
            with self.subTest(failure=failure), patch.object(launcher, "verify_environment", return_value=(8, 11, 0)), patch.object(launcher, "run", side_effect=[probe(b"CycleCloud 8.11.0"), failure]) as run:
                with self.assertRaises(InspectionError) as raised:
                    launcher.route("/fake", command.parse_args(["clusters"]), ["clusters"], Deadline(5), launcher.load_policy())
                self.assertNotIn("secret-canary", str(raised.exception))
                self.assertEqual(run.call_count, 2)

    def test_native_auth_error_redacted_and_no_worker(self):
        native = {"schemaVersion": 1, "command": "capabilities", "error": {"code": "authentication_required", "message": "secret-canary"}}
        value, run = self.route([probe(b"CycleCloud 8.10.0"), probe(json.dumps(native).encode(), b"secret-canary", 1)])
        self.assertEqual(value["error"]["code"], "authentication_required")
        self.assertNotIn("secret-canary", json.dumps(value))
        self.assertEqual(run.call_count, 2)

    def test_native_operation_error_never_falls_back(self):
        native = command.envelope("clusters", error=InspectionError("permission_denied", "secret-canary"))
        value, run = self.route([probe(b"CycleCloud 8.10.0"), probe(command.encode(capabilities("8.10.0"))), probe(command.encode(native), status=1)])
        self.assertEqual(value["error"]["code"], "permission_denied")
        self.assertEqual(run.call_count, 3)

    def test_diagnostic_quotes_control_characters_in_executable_path(self):
        cli = '/fake/cli"\n\x1b[31m'
        output = io.BytesIO()
        with patch.object(launcher, "verify_environment", return_value=(8, 9, 0)), \
                patch.object(launcher, "run", return_value=probe(b"CycleCloud 8.9.0-SNAPSHOT\n")), \
                patch.object(launcher.signal, "signal"), \
                patch.object(sys, "stdout", SimpleNamespace(buffer=output)):
            code = launcher.main(cli, ["capabilities"])
        self.assertEqual(code, 1)
        value = json.loads(output.getvalue())
        message = value["error"]["message"]
        self.assertIn(json.dumps(cli), message)
        self.assertNotIn("\n", message)
        self.assertNotIn("\x1b", message)

    def test_unrecognized_prerelease_bridge_rejected(self):
        for version in (b"8.10.0-CUSTOM", b"8.10.0-3902-custom", b"8.10.0-rc1", b"8.10.0+3902"):
            with self.subTest(version=version), self.assertRaises(InspectionError) as raised:
                self.route([probe(b"CycleCloud " + version), probe(b"Usage: command", b"**** Error: Unknown command 'inspect'", 1)], ["capabilities"])
            self.assertEqual(raised.exception.code, "unsupported_cli")


class LayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="inspect-layout-")
        cls.directory = Path(cls.temporary.name)
        cls.install = cls.directory / "official cli with spaces"
        venv.EnvBuilder(with_pip=False).create(cls.install)
        cls.bin = cls.install / "bin"
        cls.python = cls.bin / "python3"
        cls.site = next((cls.install / "lib").glob("python*/site-packages"))
        cls.cli = cls.bin / "cyclecloud"
        cls.metadata = cls.site / "cyclecloud_cli-8.10.0.dist-info"
        cls.metadata.mkdir()
        (cls.metadata / "entry_points.txt").write_text("[console_scripts]\ncyclecloud = cyclecloud:main\n")
        cls.source = '''import json,sys

def main():
    if '--version' in sys.argv:
        print('CycleCloud 8.10.0-SNAPSHOT')
    else:
        print("**** Error: Unknown command 'inspect'", file=sys.stderr)
        print('Usage: cyclecloud COMMAND')
        return 1
'''

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        for name, source in (("cyclecloud", self.source), ("cyclecli", ""), ("projects", "")):
            package = self.site / name
            package.mkdir(exist_ok=True)
            (package / "__init__.py").write_text(source)
        self.metadata.joinpath("METADATA").write_text("Metadata-Version: 2.1\nName: cyclecloud-cli\nVersion: 8.10.0\n")
        self.record()
        self.cli.write_text('#!/bin/sh\n\'\'\'exec\' "' + str(self.python) + '" "$0" "$@"\n\' \'\'\'\nfrom cyclecloud import main\nraise SystemExit(main())\n')
        self.cli.chmod(0o755)

    def record(self):
        lines = []
        for name in ("cyclecloud", "cyclecli", "projects"):
            path = self.site / name / "__init__.py"
            data = path.read_bytes()
            digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            lines.append("%s/__init__.py,sha256=%s,%d" % (name, digest, len(data)))
        self.metadata.joinpath("RECORD").write_text("\n".join(lines) + "\n")

    def invoke(self, args=None, cli=None, environment=None, cwd=None):
        env = dict(os.environ, CYCLECLOUD_CLI=str(cli or self.cli))
        env.update(environment or {})
        result = subprocess.run(["/bin/sh", str(SCRIPT)] + (args or ["capabilities"]), env=env,
                                cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        self.assertEqual(result.stderr, b"")
        self.assertLessEqual(len(result.stdout), command.OUTPUT_LIMIT)
        return result, json.loads(result.stdout)

    def test_setuptools_space_layout_and_offline_capabilities(self):
        result, value = self.invoke()
        self.assertEqual(result.returncode, 0, value)
        self.assertEqual(value["result"]["backend"], "compat")
        self.assertFalse(list(self.site.glob("**/__pycache__")))

    def test_help_option_after_terminator_is_a_literal_cluster_name(self):
        source = '''import json,sys

def main():
    if '--version' in sys.argv:
        print('CycleCloud 8.10.0')
    elif sys.argv[-1] == 'capabilities':
        print(%r)
    else:
        print(json.dumps({'schemaVersion': 1, 'command': 'cluster', 'result': {'name': sys.argv[-1]}}))
''' % json.dumps(capabilities("8.10.0"))
        (self.site / "cyclecloud" / "__init__.py").write_text(source)
        self.record()
        result, value = self.invoke(["cluster", "--", "--help"])
        self.assertEqual(result.returncode, 0, value)
        self.assertEqual(value["result"]["name"], "--help")

    def test_numeric_packaged_version_matches_release_distribution_metadata(self):
        (self.site / "cyclecloud" / "__init__.py").write_text(self.source.replace("8.10.0-SNAPSHOT", "8.10.0-3902"))
        self.record()
        result, value = self.invoke()
        self.assertEqual(result.returncode, 0, value)
        self.assertEqual(value["result"]["cliVersion"], "8.10.0-3902")
        self.assertEqual(value["result"]["backend"], "compat")
        self.assertNotIn("developmentBuild", value["result"])

    def test_path_lookup_without_override(self):
        environment = dict(os.environ)
        environment.pop("CYCLECLOUD_CLI", None)
        environment["PATH"] = str(self.bin) + ":/usr/bin:/bin"
        result = subprocess.run(["/bin/sh", str(SCRIPT), "capabilities"], env=environment,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(result.stderr, b"")
        self.assertEqual(json.loads(result.stdout)["result"]["backend"], "compat")

    def test_python_sibling_fallback_preserves_venv(self):
        saved = self.bin / "python3.saved"
        alias = self.bin / "python"
        saved_alias = self.bin / "python.saved"
        alias.rename(saved_alias)
        alias.symlink_to(sys.executable)
        self.python.rename(saved)
        try:
            self.cli.write_text("""#!/bin/sh
'''exec' "{}" "$0" "$@"
' '''
from cyclecloud import main
raise SystemExit(main())
""".format(self.bin / "python"))
            result, value = self.invoke()
            self.assertEqual(result.returncode, 0, value)
        finally:
            saved.rename(self.python)
            alias.unlink()
            saved_alias.rename(alias)

    def test_plain_shebang_layout(self):
        plain = self.directory / "plain"
        if not plain.exists():
            plain.symlink_to(self.install, target_is_directory=True)
        self.cli.write_text("#!" + str(plain / "bin" / "python3") + "\nfrom cyclecloud import main\nraise SystemExit(main())\n")
        result, value = self.invoke()
        self.assertEqual(result.returncode, 0, value)

    def test_native_stdout_overflow_is_bounded_before_publication(self):
        source = '''import json,os,sys,time

def main():
    if '--version' in sys.argv:
        print('CycleCloud 8.10.0')
    elif sys.argv[-1] == 'capabilities':
        print(%r)
    else:
        os.write(1,b'x'*2000000)
        time.sleep(20)
''' % json.dumps(capabilities("8.10.0"))
        (self.site / "cyclecloud" / "__init__.py").write_text(source)
        self.record()
        before = time.monotonic()
        result, value = self.invoke(["clusters"])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(value["error"]["code"], "output_limit")
        self.assertLess(time.monotonic() - before, 3)

    def test_sigint_returns_130_and_kills_owned_descendants(self):
        self.check_signal_cleanup(signal.SIGINT)

    def test_sigterm_returns_130_and_kills_owned_descendants(self):
        self.check_signal_cleanup(signal.SIGTERM)

    def check_signal_cleanup(self, signum):
        ready = self.directory / ("signal-ready-%d" % signum)
        orphan = self.directory / ("signal-orphan-%d" % signum)
        child = "import time,pathlib; time.sleep(1); pathlib.Path(%r).write_text('orphan')" % str(orphan)
        source = '''import pathlib,subprocess,sys,time

def main():
    if '--version' in sys.argv:
        print('CycleCloud 8.10.0')
    else:
        subprocess.Popen([sys.executable,'-c',%r])
        pathlib.Path(%r).write_text('ready')
        time.sleep(20)
''' % (child, str(ready))
        (self.site / "cyclecloud" / "__init__.py").write_text(source)
        self.record()
        process = subprocess.Popen(["/bin/sh", str(SCRIPT), "clusters"], env=dict(os.environ, CYCLECLOUD_CLI=str(self.cli)), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            end = time.monotonic() + 5
            while not ready.exists() and process.poll() is None and time.monotonic() < end:
                time.sleep(.01)
            self.assertTrue(ready.exists())
            process.send_signal(signum)
            output, stderr = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 130)
            self.assertEqual(stderr, b"")
            self.assertEqual(json.loads(output)["error"]["code"], "cancelled")
            time.sleep(1.1)
            self.assertFalse(orphan.exists())
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate()

    def test_symlink_executable(self):
        link = self.directory / "selected-cli"
        if not link.exists():
            link.symlink_to(self.cli)
        result, value = self.invoke(cli=link)
        self.assertEqual(result.returncode, 0, value)

    def test_cwd_python_environment_hijack_ignored(self):
        poison = self.directory / "poison"
        poison.mkdir(exist_ok=True)
        (poison / "cyclecloud.py").write_text("raise RuntimeError('secret-canary')")
        (poison / "cyclecloud_agent_inspect.py").write_text("raise RuntimeError('secret-canary')")
        result, value = self.invoke(cwd=poison, environment={"PYTHONPATH": str(poison), "PYTHONHOME": str(poison)})
        self.assertEqual(result.returncode, 0, value)
        self.assertNotIn("secret-canary", result.stdout.decode())

    def test_override_rejects_command_strings(self):
        for cli in ("cyclecloud", str(self.cli) + " --version", "/no/such/cli"):
            result, value = self.invoke(cli=cli)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(value["error"]["code"], "missing_cli")

    def test_missing_sibling_and_bounded_symlink_loop(self):
        isolated = self.directory / "isolated"
        isolated.mkdir(exist_ok=True)
        script = isolated / "cyclecloud"
        script.write_text("#!/usr/bin/env python3\n")
        script.chmod(0o755)
        _, value = self.invoke(cli=script)
        self.assertEqual(value["error"]["code"], "unsupported_layout")
        # A chain longer than the OS resolution limit is rejected as unavailable.
        first = self.directory / "loop-a"
        second = self.directory / "loop-b"
        if not first.is_symlink():
            first.symlink_to(second)
            second.symlink_to(first)
        _, value = self.invoke(cli=first)
        self.assertIn(value["error"]["code"], ("missing_cli", "unsupported_layout"))

    def test_wrong_interpreter_is_not_substituted(self):
        self.cli.write_text("#!" + sys.executable + "\nfrom cyclecloud import main\nmain()\n")
        _, value = self.invoke()
        self.assertEqual(value["error"]["code"], "unsupported_layout")

    def test_sdk_overwrite_rejected(self):
        (self.site / "cyclecloud" / "__init__.py").write_text("class CycleCloud: pass\n")
        _, value = self.invoke()
        self.assertEqual(value["error"]["code"], "unsupported_layout")

    def test_sdk_overlap_rejected(self):
        sdk = self.site / "cyclecloud_api-1.0.dist-info"
        sdk.mkdir(exist_ok=True)
        try:
            (sdk / "METADATA").write_text("Name: cyclecloud-api\nVersion: 1.0\n")
            (sdk / "RECORD").write_text("cyclecloud/model.py,,\n")
            (self.site / "cyclecloud" / "model.py").write_text("class SDKModel: pass\n")
            _, value = self.invoke()
            self.assertEqual(value["error"]["code"], "unsupported_layout")
        finally:
            (self.site / "cyclecloud" / "model.py").unlink(missing_ok=True)
            for file in sdk.iterdir():
                file.unlink()
            sdk.rmdir()

    def test_89_rejection_reports_executable_and_version_without_inspection(self):
        self.metadata.joinpath("METADATA").write_text("Name: cyclecloud-cli\nVersion: 8.9.0\n")
        marker = self.directory / "unsupported-inspect-called"
        source = self.source.replace("8.10.0-SNAPSHOT", "8.9.0-SNAPSHOT").replace(
            "    else:\n", "    else:\n        open(%r, 'w').close()\n" % str(marker))
        (self.site / "cyclecloud" / "__init__.py").write_text(source)
        self.record()
        result, value = self.invoke()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(value["error"]["code"], "unsupported_cli")
        self.assertIn(str(self.cli), value["error"]["message"])
        self.assertIn('reports version "8.9.0-SNAPSHOT"', value["error"]["message"])
        self.assertIn("8.10.x", value["error"]["message"])
        self.assertFalse(marker.exists())

    def test_unsupported_build_reports_resolved_executable_and_version(self):
        (self.site / "cyclecloud" / "__init__.py").write_text(self.source.replace("8.10.0-SNAPSHOT", "8.10.0-CUSTOM"))
        self.record()
        link = self.directory / "unsupported-cli-link"
        if not link.is_symlink():
            link.symlink_to(self.cli)
        _, value = self.invoke(cli=link)
        self.assertEqual(value["error"]["code"], "unsupported_cli")
        self.assertIn(str(self.cli), value["error"]["message"])
        self.assertIn('reports version "8.10.0-CUSTOM"', value["error"]["message"])

    def test_incompatible_native_schema_reports_identity_not_native_message(self):
        source = '''import json,sys

def main():
    if '--version' in sys.argv:
        print('CycleCloud 8.10.0-SNAPSHOT')
    else:
        print(%r)
''' % json.dumps({"schemaVersion": 1, "command": "capabilities", "error": {
            "code": "incompatible_schema", "message": "secret-canary"}})
        (self.site / "cyclecloud" / "__init__.py").write_text(source)
        self.record()
        result, value = self.invoke()
        self.assertEqual(result.returncode, 2)
        self.assertEqual(value["error"]["code"], "incompatible_schema")
        self.assertIn(str(self.cli), value["error"]["message"])
        self.assertIn('reports version "8.10.0-SNAPSHOT"', value["error"]["message"])
        self.assertNotIn("secret-canary", result.stdout.decode())

    def test_malformed_version_is_not_echoed_as_a_diagnostic(self):
        (self.site / "cyclecloud" / "__init__.py").write_text(self.source.replace("8.10.0-SNAPSHOT", "secret-canary"))
        self.record()
        result, value = self.invoke()
        self.assertEqual(value["error"]["code"], "unsupported_cli")
        self.assertIn(str(self.cli), value["error"]["message"])
        self.assertIn("reported version could not be determined", value["error"]["message"])
        self.assertNotIn("secret-canary", result.stdout.decode())

    def test_invalid_input_precedes_layout_and_config(self):
        self.cli.write_text("#!/bin/sh\nexit 1\n")
        result, value = self.invoke(["cluster", "c", "--fixed-node-limit", "-1", "--config", "/secret-canary"])
        self.assertEqual(result.returncode, 2)
        self.assertEqual(value["error"]["code"], "invalid_arguments")
        self.assertNotIn("secret-canary", result.stdout.decode())

    def test_relative_config_is_rejected_before_cli_probing(self):
        self.cli.write_text("#!/bin/sh\nexit 1\n")
        result, value = self.invoke(["clusters", "--config", "secret-canary.ini"])
        self.assertEqual(result.returncode, 2)
        self.assertEqual(value["error"]["code"], "invalid_arguments")
        self.assertNotIn("secret-canary", result.stdout.decode())

    def test_help_without_cli(self):
        result = subprocess.run(["/bin/sh", str(SCRIPT), "--help"], env=dict(os.environ, CYCLECLOUD_CLI="/missing"),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b"application-context", result.stdout)
        self.assertEqual(result.stderr, b"")


if __name__ == "__main__":
    unittest.main()
