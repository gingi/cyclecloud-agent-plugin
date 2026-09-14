#!/usr/bin/env python3
"""Developer-only reset of the default CycleCloud MCP installation (preview by default)."""

import argparse
import copy
import json
import os
from pathlib import Path, PureWindowsPath
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit

NAME = "cyclecloud-mcp"
PLUGIN_ID = NAME + "@" + NAME
SERVER_NAMES = {"cyclecloud", "cyclecloud-local"}
POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"


class ResetError(Exception):
    pass


def run_command(args):
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True,
                                text=True, timeout=30, check=False,
                                env={**os.environ, "COPILOT_AUTO_UPDATE": "false"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ResetError(f"Could not run {args[0]} (missing executable or timeout)") from error
    if result.returncode:
        # Subprocess output may contain user configuration; do not print it.
        raise ResetError(f"{args[0]} operation failed (exit {result.returncode}); "
                         "completed steps were kept. Resolve the error and rerun.")
    return result.stdout


def strict_json(text, label):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ResetError(f"Duplicate JSON key in {label}; left unchanged")
            result[key] = value
        return result
    try:
        return json.loads(text, object_pairs_hook=unique)
    except (ValueError, TypeError) as error:
        raise ResetError(f"Invalid or unsupported JSON in {label}; JSONC/comments require manual cleanup") from error


def marked(text):
    return NAME in text or "cyclecloud-local" in text or '"cyclecloud"' in text or ".cyclecloud" in text


def safe_path(path, kind=None):
    for part in [*reversed(path.parents), path]:
        if part.is_symlink():
            raise ResetError(f"Refusing symlinked path: {part}")
    if not path.exists():
        return False
    info = path.stat()
    if info.st_uid != os.getuid():
        raise ResetError(f"Expected user-owned target: {path}")
    if (kind == "file" and not path.is_file()) or (kind == "dir" and not path.is_dir()):
        raise ResetError(f"Unexpected target type: {path}")
    return True


def cache_name(root):
    return re.sub(r"[^a-zA-Z0-9]+", "-", "file://" + str(root)).strip("-")


def discover_profiles(home, extra, run=run_command):
    profiles = [home / ".vscode-server/data", home / ".vscode-server-insiders/data"]
    desktop = home / "Library/Application Support" if sys.platform == "darwin" else home / ".config"
    profiles.extend(desktop / name for name in ("Code", "Code - Insiders"))
    if os.environ.get("WSL_INTEROP") or os.environ.get("WSL_DISTRO_NAME"):
        output = run([POWERSHELL, "-NoProfile", "-NonInteractive", "-Command",
                      "$env:APPDATA | ConvertTo-Json -Compress"])
        appdata = strict_json(output, "Windows APPDATA")
        if not isinstance(appdata, str) or not PureWindowsPath(appdata).is_absolute():
            raise ResetError("Cannot resolve Windows VS Code data directories")
        appdata = Path(run(["wslpath", "-u", appdata]).strip())
        if not appdata.is_absolute():
            raise ResetError("Windows VS Code data directory is not absolute")
        profiles.extend(appdata / name for name in ("Code", "Code - Insiders"))
    profiles.extend(Path(path).expanduser().absolute() for path in extra)
    return list(dict.fromkeys(profiles))


class Reset:
    def __init__(self, home, profiles, run=run_command):
        self.home = Path(home)
        if not self.home.is_absolute() or self.home == Path(self.home.anchor):
            raise ResetError("HOME must be an absolute user home, not a filesystem root")
        safe_path(self.home, "dir")
        self.profiles = list(dict.fromkeys(Path(p) for p in profiles))
        self.run = run
        self.installed = self.home / ".copilot/installed-plugins" / NAME / NAME
        self.managed = self.home / ".local/share" / NAME / "marketplace"
        self.data = self.home / ".copilot/plugin-data" / NAME / NAME
        self.roots = {str(self.installed), str(self.managed)}
        self.wsl_distribution = os.environ.get("WSL_DISTRO_NAME")

    def inventory(self):
        data = strict_json(self.run(["copilot", "plugins", "list", "--json"]), "Copilot inventory")
        if isinstance(data, dict):
            if data.get("errors") != [] or not isinstance(data.get("plugins"), list):
                raise ResetError("Copilot inventory has errors or an unsupported format")
            plugins = []
            for item in data["plugins"]:
                if not isinstance(item, dict):
                    raise ResetError("Unexpected Copilot inventory entry")
                if item.get("kind") == "plugin":
                    source = item.get("source", "")
                    if not isinstance(source, str):
                        raise ResetError("Unexpected Copilot plugin source format")
                    plugins.append({**item, "marketplace": source.removeprefix("marketplace:"),
                                    "source": "installed" if item.get("scope") == "user" else "unknown"})
        elif isinstance(data, list) and all(isinstance(p, dict) for p in data):
            plugins = data
        else:
            raise ResetError("Unexpected Copilot inventory format")
        if any(p.get("marketplace") == NAME and p.get("name") != NAME for p in plugins):
            raise ResetError("Other plugins use the CycleCloud marketplace; refusing to unregister it")
        plugins = [p for p in plugins if p.get("name") == NAME]
        if len(plugins) > 1 or any(p.get("marketplace") != NAME or
                not (p.get("source") == "installed" or
                     p.get("source") == "live" and p.get("installedFrom") == str(self.managed))
                for p in plugins):
            raise ResetError("Conflicting CycleCloud plugin source; resolve it explicitly")
        output = self.run(["copilot", "plugin", "marketplace", "list"])
        output = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output)
        sources = []
        for line in output.splitlines():
            match = re.match(r"^\s*(?:\S+\s+)?cyclecloud-mcp\s+\((.+)\)\s*$", line)
            if match:
                sources.append(match[1])
            elif NAME in line:
                raise ResetError("Unrecognized CycleCloud marketplace inventory; left unchanged")
        if len(sources) > 1 or any(s not in {"GitHub: gingi/cyclecloud-mcp", "Local: " + str(self.managed)} for s in sources):
            raise ResetError("Conflicting CycleCloud marketplace source; resolve it explicitly")
        return bool(plugins), bool(sources)

    def plugin_reference(self, value):
        if not isinstance(value, str):
            return False
        if value.startswith("~/"):
            value = str(self.home / value[2:])
        if value.startswith("/"):
            return value.rstrip("/") in self.roots
        uri = urlsplit(value)
        if uri.scheme == "vscode-remote":
            if not self.wsl_distribution or unquote(uri.netloc).lower() != "wsl+" + self.wsl_distribution.lower():
                return False
        elif uri.scheme != "file" or uri.netloc not in {"", "localhost"}:
            return False
        return unquote(uri.path).rstrip("/") in self.roots

    def clean_config(self, value):
        if not isinstance(value, dict):
            raise ResetError("Expected a JSON configuration object")
        updated = copy.deepcopy(value)
        changes = []
        for field in ("enabledPlugins", "chat.plugins.enabledPlugins"):
            entries = updated.get(field, {})
            if not isinstance(entries, dict):
                raise ResetError(f"Unexpected {field} configuration shape")
            if PLUGIN_ID in entries:
                del entries[PLUGIN_ID]
                changes.append(field + "/" + PLUGIN_ID)
        for field in ("servers", "mcpServers"):
            entries = updated.get(field, {})
            if not isinstance(entries, dict):
                raise ResetError(f"Unexpected {field} configuration shape")
            for name in SERVER_NAMES & entries.keys():
                server = entries[name]
                args = server.get("args", []) if isinstance(server, dict) else []
                if not isinstance(args, list) or not any(isinstance(arg, str) and
                        arg.endswith("/bin/cyclecloud-mcp.mjs") for arg in args):
                    raise ResetError(f"MCP server {name} does not identify this package; left unchanged")
                del entries[name]
                changes.append(field + "/" + name)
        locations = updated.get("chat.pluginLocations", {})
        if not isinstance(locations, dict):
            raise ResetError("Unexpected chat.pluginLocations configuration shape")
        for location in list(locations):
            if self.plugin_reference(location):
                del locations[location]
                changes.append("chat.pluginLocations/" + location)
        marketplaces = updated.get("chat.plugins.marketplaces", [])
        if not isinstance(marketplaces, list):
            raise ResetError("Unexpected chat.plugins.marketplaces configuration shape")
        retained = [m for m in marketplaces if m not in ("gingi/cyclecloud-mcp", "https://github.com/gingi/cyclecloud-mcp.git")
                    and not self.plugin_reference(m)]
        if retained != marketplaces:
            updated["chat.plugins.marketplaces"] = retained
            changes.append("chat.plugins.marketplaces/cyclecloud-mcp")
        return updated, changes

    def config_change(self, path):
        if not safe_path(path, "file"):
            return None
        text = path.read_text()
        if not marked(text):
            return None
        updated, changes = self.clean_config(strict_json(text, str(path)))
        return (updated, changes) if changes else None

    def prepare(self):
        plugin, marketplace = self.inventory()
        paths = [self.installed, self.managed.parent, self.data,
                 self.home / ".copilot/marketplace-cache/gingi-cyclecloud-mcp",
                 self.home / ".copilot/.cache/copilot/marketplaces/gingi-cyclecloud-mcp.lock"]
        configs = [self.home / ".copilot/settings.json", self.home / ".copilot/mcp-config.json"]
        for profile in self.profiles:
            for root in (self.installed, self.managed):
                paths.append(profile / "agentPlugins" / cache_name(root))
            configs.extend([profile / "User/mcp.json", profile / "User/settings.json"])
            # Include named VS Code profiles as well as the default profile.
            profile_root = profile / "User/profiles"
            if safe_path(profile_root, "dir"):
                for child in profile_root.iterdir():
                    if child.is_symlink():
                        raise ResetError(f"Refusing symlinked VS Code profile: {child}")
                    if not child.is_dir():
                        continue
                    safe_path(child, "dir")
                    configs.extend([child / "mcp.json", child / "settings.json"])
        existing = []
        for path in dict.fromkeys(paths):
            if safe_path(path, "file" if path.suffix == ".lock" else "dir"):
                existing.append(path)
        prune = []
        for leaf in (self.installed, self.data):
            if safe_path(leaf.parent, "dir") and (leaf.exists() or not any(leaf.parent.iterdir())):
                prune.append(leaf.parent)
        config_changes = {p: change[1] for p in dict.fromkeys(configs) if (change := self.config_change(p))}
        return {"plugin": plugin, "marketplace": marketplace, "paths": existing, "prune": prune,
                "configs": config_changes}

    def ensure_stopped(self):
        output = self.run(["ps", "-u", str(os.getuid()), "-o", "comm=,args="])
        process_roots = [*self.roots, *(str(profile / "agentPlugins" / cache_name(root))
                         for profile in self.profiles for root in (self.installed, self.managed))]
        for line in output.splitlines():
            parts = line.strip().split(None, 1)
            if len(parts) < 2:
                continue
            _, args = parts
            if "cyclecloud-mcp.mjs" in args and any(root in args for root in process_roots):
                raise ResetError("Stop the installed CycleCloud MCP process before --apply; no processes were killed")

    def write_config(self, path):
        change = self.config_change(path)  # Re-read after the CLI changed its settings.
        if not change:
            return
        mode = path.stat().st_mode & 0o777
        descriptor, temporary = tempfile.mkstemp(prefix=".cyclecloud-reset-", dir=path.parent)
        try:
            with os.fdopen(descriptor, "w") as stream:
                json.dump(change[0], stream, indent=2, ensure_ascii=False)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
                os.fchmod(stream.fileno(), mode)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def execute(self, apply=False):
        plan = self.prepare()
        print("Developer reset: deletes the listed CycleCloud package and configuration paths, including credentials.")
        if plan["plugin"]:
            print("UNINSTALL " + PLUGIN_ID)
        if plan["marketplace"]:
            print("UNREGISTER marketplace " + NAME)
        for path in plan["paths"]:
            print("DELETE " + str(path))
        for path in plan["prune"]:
            print("PRUNE IF EMPTY " + str(path))
        for path, entries in plan["configs"].items():
            print("EDIT " + str(path) + ": " + ", ".join(entries))
        if not apply:
            print("Preview only. Stop agent sessions using this plugin, then run npm run reset:dev:apply (or rerun with --apply). VS Code can remain open.")
            return
        if not any(plan.values()):
            print("No CycleCloud installation state remains.")
            return
        self.ensure_stopped()
        if plan["plugin"]:
            self.run(["copilot", "plugin", "uninstall", PLUGIN_ID])
        if plan["marketplace"]:
            self.run(["copilot", "plugin", "marketplace", "remove", NAME])
        self.ensure_stopped()  # The CLI operations may have taken time.
        # Uninstall can create a stale disabled flag even when none existed before.
        configs = dict.fromkeys([*plan["configs"], self.home / ".copilot/settings.json"])
        for path in configs:
            self.write_config(path)
        for path in plan["paths"]:
            if safe_path(path):
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
        for parent in plan["prune"]:
            if safe_path(parent, "dir") and not any(parent.iterdir()):
                parent.rmdir()
        if any(self.prepare().values()):
            raise ResetError("Some CycleCloud installation state remains; rerun the preview before retrying")
        print("Reset verified. Checkout, unrelated plugins/settings, and shared logs/history were preserved.")
        print("VS Code's state database was left untouched, so a reinstall can retain prior plugin enablement and access choices.")
        print('Use a disposable VS Code profile to test a true first install; otherwise reload VS Code and enable cyclecloud-mcp in "Agent Plugins: Installed".')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Perform the previewed cleanup, including credential deletion")
    parser.add_argument("--vscode-data-dir", action="append", default=[], metavar="PATH",
                        help="Also inspect a nonstandard VS Code user-data directory (repeatable)")
    args = parser.parse_args()
    try:
        if sys.version_info < (3, 9):
            raise ResetError("Python 3.9 or later is required")
        if sys.platform not in {"linux", "darwin"} or os.getuid() == 0:
            raise ResetError("Use Linux, macOS, or WSL without sudo")
        home = Path.home()
        configured = os.environ.get("COPILOT_HOME")
        if configured and Path(configured).absolute() != home / ".copilot":
            raise ResetError("Custom COPILOT_HOME is unsupported; no installation was changed")
        Reset(home, discover_profiles(home, args.vscode_data_dir)).execute(apply=args.apply)
    except (ResetError, OSError) as error:
        print(f"Developer reset: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
