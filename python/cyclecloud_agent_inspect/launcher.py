"""Installed CLI identity verification and fail-closed native/8.10 routing."""
import base64
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import signal
import sys

from . import command
from .errors import InspectionError
from .process import Deadline, run

ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = ROOT / "scripts" / "inspect-bootstrap.py"
VERSION = re.compile(r"(?:CycleCloud )?(\d+)\.(\d+)\.(\d+)(?:[-+]([A-Za-z0-9.-]+))?\Z")


def load_policy():
    with (ROOT / "compatibility.json").open(encoding="utf-8") as source:
        return json.load(source)


def version_parts(text):
    match = VERSION.fullmatch(text)
    if not match:
        command.fail("unsupported_cli")
    return tuple(int(match.group(i)) for i in (1, 2, 3)), match.group(4)


def _inside(path, parent):
    try:
        Path(path).resolve().relative_to(Path(parent).resolve())
        return True
    except (ValueError, OSError, RuntimeError):
        return False


def _script_interpreter(cli):
    try:
        with open(cli, "rb") as source:
            text = source.read(16385)
        if len(text) > 16384:
            command.fail("unsupported_layout")
        lines = text.decode("utf-8").splitlines()
        first = lines[0]
        if first in ("#!/bin/sh", "#!/usr/bin/sh"):
            # setuptools' shell/Python polyglot for spaces/long shebangs. Parse
            # the literal interpreter argument, never eval arbitrary shell code.
            match = re.fullmatch(r"'''exec' (.+) \"\$0\" \"\$@\"", lines[1])
            if not match or len(lines) < 3 or lines[2] != "' '''":
                command.fail("unsupported_layout")
            words = shlex.split(match.group(1))
        else:
            if not first.startswith("#!/"):
                command.fail("unsupported_layout")
            words = first[2:].split()
        if len(words) != 1 or not os.path.isabs(words[0]):
            command.fail("unsupported_layout")
        if not re.search(r"(?m)^from cyclecloud import main\s*$", text.decode("utf-8")):
            command.fail("unsupported_layout")
        return words[0]
    except (OSError, UnicodeError, ValueError, IndexError):
        command.fail("unsupported_layout")


def verify_environment(cli):
    """Verify without importing installed packages (capabilities stays offline)."""
    try:
        cli = os.path.abspath(cli)
        bin_path = Path(cli).parent
        interpreter = _script_interpreter(cli)
        # samefile allows python/python3 symlink aliases; parent equality and
        # sys.prefix prevent using the symlink's global target outside its venv.
        if (Path(interpreter).parent.resolve() != bin_path.resolve()
                or Path(sys.executable).parent.resolve() != bin_path.resolve()
                or not os.path.samefile(interpreter, sys.executable)
                or Path(sys.prefix).resolve() != bin_path.parent.resolve()):
            command.fail("unsupported_layout")
        distribution = importlib.metadata.distribution("cyclecloud-cli")
        if distribution.metadata["Name"].lower().replace("_", "-") != "cyclecloud-cli":
            command.fail("unsupported_layout")
        numeric, suffix = version_parts(distribution.version)
        if not _inside(distribution.locate_file(""), sys.prefix):
            command.fail("unsupported_layout")
        if not any(entry.name == "cyclecloud" and entry.group == "console_scripts" and entry.value == "cyclecloud:main"
                   for entry in distribution.entry_points):
            command.fail("unsupported_layout")
        files = {str(item): item for item in (distribution.files or ())}
        for package in ("cyclecloud", "cyclecli", "projects"):
            spec = importlib.util.find_spec(package)
            relative = package + "/__init__.py"
            item = files.get(relative)
            if spec is None or spec.origin is None or item is None:
                command.fail("unsupported_layout")
            expected = distribution.locate_file(item)
            if not _inside(spec.origin, sys.prefix) or not os.path.samefile(spec.origin, expected):
                command.fail("unsupported_layout")
            # An SDK can overwrite the same cyclecloud/__init__.py, so origin
            # alone is insufficient. Validate the wheel's recorded package hash.
            if item.hash is None or item.hash.mode != "sha256":
                command.fail("unsupported_layout")
            with open(expected, "rb") as source:
                data = source.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024 or base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii") != item.hash.value:
                command.fail("unsupported_layout")
        # Refuse overlapping installed distributions, even if the CLI happened
        # to win the last file write. This is not the separate CycleCloud SDK.
        for other in importlib.metadata.distributions():
            name = (other.metadata["Name"] or "").lower().replace("_", "-")
            if name != "cyclecloud-cli" and any(str(item).startswith("cyclecloud/") for item in (other.files or ())):
                command.fail("unsupported_layout")
        return numeric
    except InspectionError:
        raise
    except Exception:
        command.fail("unsupported_layout")


def _native_argv(cli, args):
    # Executing the verified console script with its own interpreter preserves
    # CLI behavior while excluding CWD, PYTHONPATH and user site-package imports.
    return [sys.executable, "-I", "-B", cli] + list(args)


def _capabilities(value, policy):
    result = value.get("result")
    if not isinstance(result, dict) or not isinstance(result.get("cliVersion"), str):
        command.fail("invalid_response")
    contracts = result.get("inspectionContracts")
    if not isinstance(contracts, list):
        command.fail("incompatible_schema")
    required = set(policy["native"]["commands"])
    for contract in contracts:
        if (isinstance(contract, dict) and type(contract.get("version")) is int
                and contract["version"] == policy["native"]["schemaVersion"]
                and isinstance(contract.get("commands"), list)
                and all(isinstance(name, str) for name in contract["commands"])
                and required.issubset(contract["commands"])):
            return
    command.fail("incompatible_schema")


def _native_result(probe, name):
    if not probe.stdout.strip():
        command.fail("upstream_error" if probe.returncode else "invalid_response")
    value = command.validate_envelope(probe.stdout, name)
    if "error" in value:
        return value
    if probe.returncode != 0:
        command.fail("upstream_error")
    return value


def route(cli, parsed, argv, deadline, policy, diagnostics=None):
    installed_version = verify_environment(cli)
    probe = run(_native_argv(cli, ["--version"]), deadline, probe_timeout=10, stdout_limit=16384)
    if probe.returncode != 0:
        command.fail("unsupported_layout")
    try:
        text = probe.stdout.decode("utf-8").strip()
    except UnicodeError:
        command.fail("unsupported_cli")
    # Ignore bounded incidental warning lines, but demand exactly one version.
    versions = [line for line in text.splitlines() if line.startswith("CycleCloud ") and VERSION.fullmatch(line)]
    if len(versions) != 1:
        command.fail("unsupported_cli")
    cli_version = versions[0][len("CycleCloud "):]
    numeric, suffix = version_parts(cli_version)
    if diagnostics is not None:
        diagnostics["cliVersion"] = cli_version
    if numeric != installed_version:
        command.fail("unsupported_layout")
    if numeric < tuple(policy["native"]["minimumCliVersion"]):
        command.fail("unsupported_cli")
    capability_probe = run(_native_argv(cli, ["inspect", "capabilities"]), deadline, probe_timeout=10)
    # Stock 8.10 alone has this exact diagnostic line. No subprocess failure,
    # unknown future CLI, malformed JSON, auth or network error enables fallback.
    diagnostic = capability_probe.stderr.strip()
    stock_absence = (capability_probe.returncode == 1 and not capability_probe.stderr_truncated
                     and diagnostic == b"**** Error: Unknown command 'inspect'"
                     and capability_probe.stdout.lstrip().startswith(b"Usage:"))
    if stock_absence:
        bridge = policy["compatibility"]
        packaged_build = (suffix is not None and cli_version.endswith("-" + suffix)
                          and re.fullmatch(bridge["packagedBuildSuffixPattern"], suffix) is not None)
        if list(numeric[:2]) != bridge["cliFamily"] or (suffix is not None
                and suffix not in bridge["developmentBuilds"] and not packaged_build):
            command.fail("unsupported_cli")
        if parsed.command == "capabilities":
            result = {"cliVersion": cli_version, "inspectionContracts": [{"version": bridge["schemaVersion"],
                      "commands": policy["native"]["commands"]}], "backend": "compat"}
            if suffix in bridge["developmentBuilds"]:
                result["developmentBuild"] = {"label": suffix, "testedStableRelease": False}
            return command.envelope("capabilities", result=result)
        worker = run([sys.executable, "-I", "-B", str(BOOTSTRAP), "--worker", str(deadline.expires)] + list(argv), deadline)
        return _native_result(worker, parsed.command)
    native = _native_result(capability_probe, "capabilities")
    if "error" in native:
        return command.envelope(parsed.command, error=InspectionError(native["error"]["code"], ""))
    _capabilities(native, policy)
    reported, _ = version_parts(native["result"]["cliVersion"])
    if reported != numeric:
        command.fail("invalid_response")
    if parsed.command == "capabilities":
        # Publish only the explicit accepted capability contract, not arbitrary
        # extra native fields. The queried CLI version is authoritative.
        return command.envelope("capabilities", result={"cliVersion": cli_version,
            "inspectionContracts": [{"version": policy["native"]["schemaVersion"], "commands": policy["native"]["commands"]}],
            "backend": "native"})
    operation = run(_native_argv(cli, ["inspect"] + list(argv)), deadline)
    return _native_result(operation, parsed.command)


def _cancel(signum, frame):
    raise KeyboardInterrupt


def main(cli, argv):
    # Hosts commonly cancel with SIGTERM rather than a terminal SIGINT. Route
    # both through the supervisor's finally block, so owned groups are reaped.
    signal.signal(signal.SIGTERM, _cancel)
    deadline = Deadline(120)
    name = argv[0] if argv and argv[0] in ("capabilities",) + command.COMMANDS else "inspect"
    diagnostics = None
    try:
        parsed = command.parse_args(argv)
        diagnostics = {}
        value = route(cli, parsed, argv, deadline, load_policy(), diagnostics)
    except KeyboardInterrupt:
        value = command.envelope(name, error=InspectionError("cancelled", ""))
    except Exception as error:
        value = command.envelope(name, error=error)
    if diagnostics is not None and value.get("error", {}).get("code") in (
            "unsupported_cli", "unsupported_layout", "incompatible_schema"):
        # Only local identity, never native error text or raw probe output. Quote
        # paths so control characters cannot become terminal instructions.
        version = diagnostics.get("cliVersion")
        reported = "reports version " + json.dumps(version) if version is not None else "reported version could not be determined"
        value["error"]["message"] = "Selected CLI %s: %s. %s" % (
            json.dumps(cli), reported, value["error"]["message"])
    try:
        output = command.encode(value)
    except InspectionError as error:
        value = command.envelope(name, error=error)
        output = command.encode(value)
    sys.stdout.buffer.write(output)
    return command.exit_code(value)
