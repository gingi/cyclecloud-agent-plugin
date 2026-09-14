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
        self.assertIn("--apply", text)
        self.assertIn(str(self.data.parent), text)
        self.assertTrue(all("list" in call for call in self.calls))

    def test_apply_removes_all_known_state_preserving_unrelated_data(self):
        self.seed()
        self.execute(apply=True)
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
        with sqlite3.connect(self.db) as con:
            rows = {key: json.loads(value) for key, value in con.execute("select key,value from ItemTable")}
            self.assertEqual(con.execute("pragma quick_check").fetchone()[0], "ok")
        self.assertEqual(rows["unrelated"], self.rows["unrelated"])
        self.assertEqual(rows["agentPlugins.enablement"], [["file:///other/plugin", False]])
        self.assertEqual(rows["mcpToolCache"], {"extensionServers": ["preserve"], "serverTools": [["mcp.config.user.other", {"tools": ["keep"]}]]})
        self.assertEqual(rows["chat.plugins.trustedMarketplaces.v1"], ["github:other/repo"])
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

    def test_refuses_active_editor_before_mutation(self):
        self.seed()
        self.reset.ensure_stopped.side_effect = reset_dev.ResetError("Close VS Code first")
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

    def test_refuses_unexpected_database_schema_before_mutation(self):
        self.seed()
        with sqlite3.connect(self.db) as con:
            con.execute("update ItemTable set value=? where key=?", (json.dumps({"cyclecloud-mcp": False}), "agentPlugins.enablement"))
        with self.assertRaises(reset_dev.ResetError):
            self.execute(apply=True)
        self.assertTrue(self.plugin)

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

    def test_windows_editor_detection_allows_only_known_helpers(self):
        self.assertFalse(reset_dev.is_windows_editor('"Code - Insiders.exe" --type=crashpad-handler'))
        self.assertFalse(reset_dev.is_windows_editor('"Code - Insiders.exe" c:\\extensions\\ms-vscode-remote.remote-wsl-0.1\\dist\\node\\wslDaemon.js'))
        self.assertTrue(reset_dev.is_windows_editor('"Code - Insiders.exe" --type=utility'))
        self.assertTrue(reset_dev.is_windows_editor('"Code.exe"'))
        self.assertTrue(reset_dev.is_windows_editor(None))

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

    def test_removes_an_old_workspace_only_tool_cache(self):
        self.seed()
        with sqlite3.connect(self.db) as con:
            con.execute("update ItemTable set value=? where key=?", (
                json.dumps({"serverTools": [["workspace-dot-mcp.0.cyclecloud", {"tools": []}]]}), "mcpToolCache"))
        self.execute(apply=True)
        with sqlite3.connect(self.db) as con:
            value = json.loads(con.execute("select value from ItemTable where key='mcpToolCache'").fetchone()[0])
        self.assertEqual(value["serverTools"], [])

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
        ps.write_text(f"#!{sys.executable}\n")
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

    def test_native_editor_and_cached_mcp_process_detection(self):
        self.guard.stop()
        with patch.dict(os.environ, {}, clear=True):
            self.reset.run = lambda args: "Electron /Applications/Visual Studio Code.app/Contents/MacOS/Electron\n"
            with self.assertRaises(reset_dev.ResetError):
                self.reset.ensure_stopped()
            cache = self.profile / "agentPlugins" / reset_dev.cache_name(self.installed)
            self.reset.run = lambda args: "node " + str(cache / "version/bin/cyclecloud-mcp.mjs")
            with self.assertRaises(reset_dev.ResetError):
                self.reset.ensure_stopped()

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
