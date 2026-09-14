import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("reset_dev", ROOT / "scripts/reset-dev.py")
reset_dev = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reset_dev)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    path.chmod(0o600)


class ResetTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="cyclecloud reset (test) ")
        self.home = Path(self.temporary.name).resolve()
        self.profile = self.home / "editor-profile"
        self.installed = self.home / ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp"
        self.managed = self.home / ".local/share/cyclecloud-mcp/marketplace"
        self.data = self.home / ".copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp"
        self.settings = self.home / ".copilot/settings.json"
        self.cli_config = self.home / ".copilot/config.json"
        self.mcp = self.profile / "User/mcp.json"
        self.db = self.profile / "User/globalStorage/state.vscdb"
        self.plugin = True
        self.marketplace = True
        self.live = True
        self.legacy_inventory = False
        self.fail_command = None
        self.calls = []
        self.source = "Local: " + str(self.managed)
        self.reset = reset_dev.Reset(self.home, [self.profile], run=self.run_cli)
        self.guard = patch.object(self.reset, "ensure_stopped")
        self.guard.start()
        self.addCleanup(self.guard.stop)
        self.addCleanup(self.temporary.cleanup)

    def run_cli(self, args):
        self.calls.append(args)
        if args == self.fail_command:
            raise reset_dev.ResetError("Simulated CLI failure")
        if args == ["copilot", "plugins", "list", "--json"]:
            plugin = {"name": "cyclecloud-mcp", "marketplace": "cyclecloud-mcp", "enabled": True,
                      "source": "live" if self.live else "installed", "installedFrom": str(self.managed)}
            other = {"name": "other", "marketplace": "other", "source": "installed", "enabled": True}
            plugins = [plugin, other] if self.plugin else [other]
            if self.legacy_inventory:
                return json.dumps({"plugins": [{**p, "kind": "plugin", "scope": "user",
                                                "source": "marketplace:" + p["marketplace"]} for p in plugins], "errors": []})
            return json.dumps(plugins)
        if args == ["copilot", "plugin", "marketplace", "list"]:
            return "  • cyclecloud-mcp (" + self.source + ")\n" if self.marketplace else ""
        if args == ["copilot", "plugin", "uninstall", reset_dev.PLUGIN_ID]:
            self.plugin = False
            # Real CLI uninstall leaves a disablement flag, even for live plugins.
            current = json.loads(self.settings.read_text())
            current.setdefault("enabledPlugins", {})[reset_dev.PLUGIN_ID] = False
            current["addedByCli"] = "preserve this fresh value"
            write_json(self.settings, current)
            return ""
        if args == ["copilot", "plugin", "marketplace", "remove", "cyclecloud-mcp"]:
            self.marketplace = False
            return ""
        raise AssertionError("Unexpected command: " + repr(args))

    def seed(self):
        for root in [self.installed, self.managed]:
            write_json(root / "plugin.json", {"name": "cyclecloud-mcp"})
        write_json(self.data / "cyclecloud.json", {"password": "NEVER-PRINT-CREDENTIAL"})
        write_json(self.managed.parent / "cyclecloud.json", {"password": "OLD-PRIVATE-CREDENTIAL"})
        write_json(self.managed.parent / "installation.json", {"version": 1})
        write_json(self.settings, {"enabledPlugins": {reset_dev.PLUGIN_ID: True, "other@other": False}, "theme": "keep"})
        write_json(self.mcp, {"servers": {
            "cyclecloud-local": {"command": "node", "args": [str(self.installed / "bin/cyclecloud-mcp.mjs")]},
            "other": {"url": "https://other.example/mcp", "headers": {"Authorization": "secret-other"}},
        }, "inputs": [{"id": "keep"}]})
        self.cache = self.profile / "agentPlugins" / reset_dev.cache_name(self.installed)
        write_json(self.cache / "version/plugin.json", {"name": "cyclecloud-mcp"})
        self.other_file = self.home / ".copilot/installed-plugins/other/other/plugin.json"
        write_json(self.other_file, {"name": "other"})
        self.db.parent.mkdir(parents=True, exist_ok=True)
        self.plugin_uri = self.installed.as_uri()
        self.rows = {
            "agentPlugins.enablement": [[self.plugin_uri, False], ["file:///other/plugin", False]],
            "mcpToolCache": {"extensionServers": ["preserve"], "serverTools": [
                ["mcp.config.usrremote.cyclecloud-local", {"tools": ["private diagnostic"]}],
                ["workspace-dot-mcp.0.cyclecloud", {"tools": []}],
                ["mcp.config.user.other", {"tools": ["keep"]}],
            ]},
            "chat.plugins.trustedMarketplaces.v1": ["github:gingi/cyclecloud-mcp", "github:other/repo"],
            "unrelated": {"value": "cyclecloud-mcp appears in unrelated user data"},
        }
        with sqlite3.connect(self.db) as con:
            con.execute("create table ItemTable (key text primary key, value blob)")
            con.executemany("insert into ItemTable values (?, ?)",
                            [(key, json.dumps(value).encode()) for key, value in self.rows.items()])

    def execute(self, apply=False):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.reset.execute(apply=apply)
        self.assertNotIn("NEVER-PRINT-CREDENTIAL", output.getvalue())
        self.assertNotIn("OLD-PRIVATE-CREDENTIAL", output.getvalue())
        self.assertNotIn("secret-other", output.getvalue())
        return output.getvalue()

    def snapshot(self):
        return {str(p.relative_to(self.home)): p.read_bytes() for p in self.home.rglob("*") if p.is_file()}

    def test_preview_does_not_mutate_any_file_or_registration(self):
        self.seed()
        before = self.snapshot()
        text = self.execute()
        self.assertEqual(before, self.snapshot())
        self.assertTrue(self.plugin)
        self.assertTrue(self.marketplace)
        self.assertIn("reset:dev:apply", text)
        self.assertIn("VS Code can remain open", text)
        self.assertNotIn("Fully quit", text)
        self.assertIn(str(self.data.parent), text)
        self.assertTrue(all("list" in call for call in self.calls))

    def test_preview_ignores_copilot_cli_owned_jsonc_config(self):
        self.seed()
        contents = """{
  // Copilot CLI owns and updates this inventory.
  "installed_plugins": [
    { "name": "cyclecloud-mcp", "enabled": true }
  ]
}
"""
        self.cli_config.write_text(contents)
        self.cli_config.chmod(0o600)
        self.execute()
        self.assertEqual(self.cli_config.read_text(), contents)

    def test_apply_removes_artifacts_preserving_editor_state_and_unrelated_data(self):
        self.seed()
        database_before = self.db.read_bytes()
        output = self.execute(apply=True)
        self.assertIn("state database was left untouched", output)
        self.assertIn("disposable VS Code profile", output)
        self.assertIn('enable cyclecloud-mcp in "Agent Plugins: Installed"', output)
        for path in [self.installed.parent, self.managed.parent, self.data.parent, self.cache]:
            self.assertFalse(path.exists(), path)
        settings = json.loads(self.settings.read_text())
        self.assertEqual(settings["enabledPlugins"], {"other@other": False})
        self.assertEqual(settings["addedByCli"], "preserve this fresh value")
        self.assertEqual(self.settings.stat().st_mode & 0o777, 0o600)
        mcp = json.loads(self.mcp.read_text())
        self.assertEqual(list(mcp["servers"]), ["other"])
        self.assertEqual(mcp["inputs"], [{"id": "keep"}])
        self.assertTrue(self.other_file.exists())
        self.assertEqual(self.db.read_bytes(), database_before)
        before = self.snapshot()
        self.execute(apply=True)
        self.assertEqual(before, self.snapshot())

    def test_supports_older_copied_installation_inventory(self):
        self.seed()
        self.live = False
        self.legacy_inventory = True
        self.source = "GitHub: gingi/cyclecloud-mcp"
        self.execute(apply=True)
        self.assertFalse(self.installed.exists())

    def test_rejects_conflicting_marketplace_before_mutation(self):
        self.seed()
        self.source = "GitHub: unrelated/project"
        before = self.snapshot()
        with self.assertRaises(reset_dev.ResetError):
            self.execute(apply=True)
        self.assertEqual(before, self.snapshot())
        self.assertTrue(self.plugin)

    def test_refuses_active_mcp_before_mutation(self):
        self.seed()
        self.reset.ensure_stopped.side_effect = reset_dev.ResetError("Stop the installed CycleCloud MCP process")
        before = self.snapshot()
        with self.assertRaises(reset_dev.ResetError):
            self.execute(apply=True)
        self.assertEqual(before, self.snapshot())
        self.assertTrue(self.plugin)

    def test_refuses_symlinked_target_parent(self):
        self.seed()
        alternate = self.home / "elsewhere"
        (self.home / ".local").rename(alternate)
        (self.home / ".local").symlink_to(alternate, target_is_directory=True)
        with self.assertRaises(reset_dev.ResetError):
            self.execute(apply=True)
        self.assertTrue((alternate / "share/cyclecloud-mcp/cyclecloud.json").exists())
        self.assertTrue(self.plugin)

    def test_refuses_jsonc_without_partially_uninstalling(self):
        self.seed()
        original = self.mcp.read_text()
        self.mcp.write_text("// retain user comments\n" + original)
        with self.assertRaisesRegex(reset_dev.ResetError, "JSON"):
            self.execute(apply=True)
        self.assertTrue(self.plugin)
        self.assertEqual(self.mcp.read_text(), "// retain user comments\n" + original)

    def test_never_opens_editor_databases_in_preview_or_apply(self):
        self.seed()
        named_profile = self.profile / "User/profiles/named"
        named_db = named_profile / "globalStorage/state.vscdb"
        named_db.parent.mkdir(parents=True)
        named_db.write_bytes(b"opaque editor state: cyclecloud-mcp")
        write_json(named_profile / "mcp.json", {"servers": {
            "cyclecloud": {"command": "node", "args": [str(self.installed / "bin/cyclecloud-mcp.mjs")]},
        }})
        before = {path: path.read_bytes() for path in (self.db, named_db)}
        with patch("sqlite3.connect", side_effect=AssertionError("Reset must not open editor databases")):
            preview = self.execute()
            self.assertNotIn("state.vscdb", preview)
            self.execute(apply=True)
        for path, contents in before.items():
            self.assertEqual(path.read_bytes(), contents)
        self.assertEqual(json.loads((named_profile / "mcp.json").read_text()), {"servers": {}})

    def test_ignores_unreadable_or_non_sqlite_editor_state(self):
        self.seed()
        self.db.write_bytes(b"not a SQLite database: cyclecloud-mcp")
        self.db.chmod(0o000)
        try:
            self.execute(apply=True)
            self.assertEqual(self.db.stat().st_mode & 0o777, 0o000)
        finally:
            self.db.chmod(0o600)
        self.assertEqual(self.db.read_bytes(), b"not a SQLite database: cyclecloud-mcp")

    def test_rechecks_active_mcp_after_cli_operations(self):
        self.seed()
        self.reset.ensure_stopped.side_effect = [None, reset_dev.ResetError("Stop the installed CycleCloud MCP process")]
        with self.assertRaisesRegex(reset_dev.ResetError, "Stop the installed"):
            self.execute(apply=True)
        self.assertTrue(self.installed.exists())
        self.assertTrue(self.data.exists())

    def test_cli_failure_keeps_files_and_allows_retry(self):
        self.seed()
        self.fail_command = ["copilot", "plugin", "marketplace", "remove", "cyclecloud-mcp"]
        with self.assertRaises(reset_dev.ResetError):
            self.execute(apply=True)
        self.assertTrue(self.managed.exists())
        self.assertTrue(self.data.exists())
        self.fail_command = None
        self.execute(apply=True)
        self.assertFalse(self.managed.exists())

    def test_same_name_unrelated_mcp_server_is_not_deleted(self):
        self.seed()
        write_json(self.mcp, {"servers": {"cyclecloud": {"url": "https://unrelated.example"}}})
        with self.assertRaises(reset_dev.ResetError):
            self.execute(apply=True)
        self.assertTrue(self.plugin)

    def test_wsl_guard_does_not_query_windows_editors(self):
        self.guard.stop()
        with patch.dict(os.environ, {"WSL_DISTRO_NAME": "Test-Distro"}):
            with patch.object(self.reset, "run", return_value="code /usr/bin/code\n") as run:
                self.reset.ensure_stopped()
            run.assert_called_once_with(["ps", "-u", str(os.getuid()), "-o", "comm=,args="])

    def test_already_absent_install_is_safe(self):
        self.plugin = False
        self.marketplace = False
        self.execute(apply=True)
        self.assertEqual(self.snapshot(), {})

    def test_preserves_sibling_files_in_marketplace_directories(self):
        self.seed()
        sibling = self.installed.parent / "unrelated/plugin.json"
        sibling_data = self.data.parent / "unrelated/config.json"
        write_json(sibling, {"name": "unrelated"})
        write_json(sibling_data, {"value": "keep"})
        self.execute(apply=True)
        self.assertTrue(sibling.exists())
        self.assertTrue(sibling_data.exists())
        self.assertFalse(self.installed.exists())
        self.assertFalse(self.data.exists())

    def test_editor_database_alone_does_not_require_reset(self):
        self.plugin = False
        self.marketplace = False
        self.db.parent.mkdir(parents=True)
        self.db.write_bytes(b"remembered cyclecloud-mcp trust and enablement")
        before = self.snapshot()
        text = self.execute(apply=True)
        self.assertIn("No CycleCloud installation state remains", text)
        self.assertEqual(before, self.snapshot())
        self.reset.ensure_stopped.assert_not_called()

    def test_rejects_other_registered_plugins_in_the_same_marketplace(self):
        self.seed()
        original = self.reset.run
        def with_sibling(args):
            text = original(args)
            if args == ["copilot", "plugins", "list", "--json"]:
                items = json.loads(text)
                items.append({"name": "unrelated", "marketplace": "cyclecloud-mcp", "source": "installed", "enabled": True})
                return json.dumps(items)
            return text
        self.reset.run = with_sibling
        with self.assertRaises(reset_dev.ResetError):
            self.execute(apply=True)
        self.assertTrue(self.plugin)

    @unittest.skipIf(os.getuid() == 0, "The command intentionally refuses sudo/root")
    def test_command_line_preview_and_apply_with_an_isolated_fake_cli(self):
        self.seed()
        commands = self.home / "commands"
        commands.mkdir()
        cli = commands / "copilot"
        cli.write_text(f"#!{sys.executable}\n" + '''import json, os, pathlib, sys
home = pathlib.Path(os.environ["HOME"])
args = sys.argv[1:]
state = home / "cli.json"
value = json.loads(state.read_text())
if args == ["plugins", "list", "--json"]:
    print(json.dumps([{"name":"cyclecloud-mcp","marketplace":"cyclecloud-mcp","source":"live","installedFrom":str(home / ".local/share/cyclecloud-mcp/marketplace")} ] if value["plugin"] else []))
elif args == ["plugin", "marketplace", "list"]:
    if value["marketplace"]: print("  • cyclecloud-mcp (Local: " + str(home / ".local/share/cyclecloud-mcp/marketplace") + ")")
elif args == ["plugin", "uninstall", "cyclecloud-mcp@cyclecloud-mcp"]:
    value["plugin"] = False
elif args == ["plugin", "marketplace", "remove", "cyclecloud-mcp"]:
    value["marketplace"] = False
else:
    raise SystemExit(1)
if "list" not in args: state.write_text(json.dumps(value))
''')
        cli.chmod(0o700)
        ps = commands / "ps"
        ps.write_text(f"#!{sys.executable}\nprint('code /usr/bin/code')\n")
        ps.chmod(0o700)
        write_json(self.home / "cli.json", {"plugin": True, "marketplace": True})
        env = {"HOME": str(self.home), "PATH": str(commands)}
        command = [sys.executable, "-B", str(ROOT / "scripts/reset-dev.py"), "--vscode-data-dir", str(self.profile)]
        before = self.snapshot()
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), before)
        result = subprocess.run([*command, "--apply"], env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Reset verified", result.stdout)
        self.assertNotIn("NEVER-PRINT-CREDENTIAL", result.stdout + result.stderr)
        self.assertFalse(self.data.exists())
        result = subprocess.run([*command, "--apply"], env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_allows_native_editors_and_unrelated_mcp_processes(self):
        self.guard.stop()
        with patch.dict(os.environ, {}, clear=True):
            for line in ["code /usr/bin/code", "code-insiders /usr/bin/code-insiders",
                         "Electron /Applications/Visual Studio Code.app/Contents/MacOS/Electron",
                         "node /other/project/bin/cyclecloud-mcp.mjs"]:
                with self.subTest(process=line):
                    self.reset.run = lambda args: line
                    self.reset.ensure_stopped()

    def test_refuses_installed_managed_and_cached_mcp_processes(self):
        self.guard.stop()
        with patch.dict(os.environ, {}, clear=True):
            for root in [self.installed, self.managed, *(
                    self.profile / "agentPlugins" / reset_dev.cache_name(root) / "version"
                    for root in (self.installed, self.managed))]:
                with self.subTest(root=root):
                    self.reset.run = lambda args: "node " + str(root / "bin/cyclecloud-mcp.mjs")
                    with self.assertRaisesRegex(reset_dev.ResetError, "Stop the installed"):
                        self.reset.ensure_stopped()

    def test_npm_apply_task_adds_the_apply_flag(self):
        scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
        self.assertEqual(scripts["reset:dev:apply"], scripts["reset:dev"] + " --apply")

    def test_remote_enablement_is_scoped_to_the_current_wsl_distribution(self):
        self.reset.wsl_distribution = "Test-Distro"
        path = str(self.installed)
        self.assertTrue(self.reset.plugin_reference("vscode-remote://wsl%2Btest-distro" + path))
        self.assertFalse(self.reset.plugin_reference("vscode-remote://wsl%2Bother-distro" + path))
        self.assertFalse(self.reset.plugin_reference("vscode-remote://ssh-remote+host" + path))
        self.assertFalse(self.reset.plugin_reference("https://example.com" + path))
        self.assertTrue(self.reset.plugin_reference("~/.local/share/cyclecloud-mcp/marketplace"))

    def test_reset_is_not_in_distributable_package(self):
        package_script = (ROOT / "scripts/package-local.mjs").read_text()
        self.assertNotIn('"scripts/reset-dev.py"', package_script)
        self.assertNotIn('"reset-dev.py"', package_script)


if __name__ == "__main__":
    unittest.main()
