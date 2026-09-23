"""Strict public CLI boundary. No installed CLI/configuration imports here."""
import argparse
import json
from types import SimpleNamespace

from . import contract
from .errors import InspectionError

COMMANDS = ("clusters", "cluster", "status", "application-context")
OUTPUT_LIMIT = 1024 * 1024  # Includes the terminating newline.
MESSAGES = {
    "invalid_arguments": "Invalid inspection arguments. Run cyclecloud-inspect --help.",
    "incompatible_schema": "Inspection requires schema version 1 and all supported read commands.",
    "missing_cli": "CycleCloud CLI was not found. Install the official CLI or set CYCLECLOUD_CLI to its absolute executable path.",
    "unsupported_cli": "This CLI is unsupported. Use official CycleCloud 8.10.x or a contract-compatible newer CLI.",
    "unsupported_layout": "The selected CLI's Python environment or bundled dependencies could not be verified. Reinstall the official CLI; do not install the cyclecloud API SDK.",
    "configuration_required": "CycleCloud configuration is missing or invalid. Configure the CLI separately, or supply --config.",
    "authentication_required": "CycleCloud authentication is required. Sign in with the CLI separately, then retry inspection.",
    "unsupported_authentication": "This CLI authentication configuration is not supported by the 8.10 inspection adapter.",
    "permission_denied": "CycleCloud denied access to the requested inspection.",
    "network_error": "The CycleCloud or identity service could not be reached securely.",
    "upstream_error": "The CycleCloud or identity service could not complete the inspection.",
    "invalid_response": "CycleCloud returned a response the plugin could not safely use.",
    "cluster_not_found": "CycleCloud did not return the requested cluster.",
    "output_limit": "The inspection response exceeded the safe output limit. Request smaller limits.",
    "timeout": "The inspection exceeded its time limit. Retry when the service is available.",
    "cancelled": "The CycleCloud request was cancelled.",
}


def fail(code):
    raise InspectionError(code, MESSAGES[code])


def safe_error(error):
    code = error.code if isinstance(error, InspectionError) and error.code in MESSAGES else "upstream_error"
    return {"code": code, "message": MESSAGES[code]}


def envelope(command, result=None, error=None):
    value = {"schemaVersion": 1, "command": command}
    value["error" if error is not None else "result"] = safe_error(error) if error is not None else result
    return value


def exit_code(value):
    code = value.get("error", {}).get("code")
    return 0 if code is None else 130 if code == "cancelled" else 2 if code in ("invalid_arguments", "incompatible_schema") else 1


def encode(value):
    output = contract.json_bytes(value) + b"\n"
    if len(output) > OUTPUT_LIMIT:
        fail("output_limit")
    return output


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("invalid_response")
        result[key] = value
    return result


def validate_envelope(output, command):
    if len(output) > OUTPUT_LIMIT:
        fail("output_limit")
    try:
        value = json.loads(output.decode("utf-8"), object_pairs_hook=_unique_object,
                           parse_constant=lambda _: fail("invalid_response"))
    except (ValueError, UnicodeError, RecursionError):
        fail("invalid_response")
    if not isinstance(value, dict):
        fail("invalid_response")
    if type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        fail("incompatible_schema")
    if value.get("command") != command or set(value) not in (
            {"schemaVersion", "command", "result"}, {"schemaVersion", "command", "error"}):
        fail("invalid_response")
    if "error" in value:
        error = value["error"]
        if not isinstance(error, dict) or set(error) != {"code", "message"} or not all(isinstance(v, str) for v in error.values()):
            fail("invalid_response")
        value["error"] = safe_error(InspectionError(error["code"], ""))
    elif not isinstance(value["result"], dict):
        fail("invalid_response")
    encode(value)  # Reject invalid Unicode/numbers, recursion and newline overflow.
    return value


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail("invalid_arguments")


def parse_args(argv):
    parser = Parser(prog="cyclecloud-inspect", allow_abbrev=False,
                    description="Read-only CycleCloud inspection; no login or mutation. Uses the installed official CLI Python environment.")
    subparsers = parser.add_subparsers(dest="command", required=True, parser_class=Parser)
    for name in ("capabilities",) + COMMANDS:
        sub = subparsers.add_parser(name, allow_abbrev=False)
        sub.add_argument("--schema-version", type=int, default=1)
        sub.add_argument("--config", help="Existing CLI configuration file, as an absolute POSIX path; never initializes or switches profiles.")
        if name == "capabilities":
            continue
        if name != "clusters":
            sub.add_argument("clusterName", metavar="NAME")
        if name == "clusters":
            sub.add_argument("--limit", type=int)
        if name == "cluster":
            sub.add_argument("--fixed-node-limit", dest="fixedNodeLimit", type=int)
        if name in ("cluster", "status"):
            sub.add_argument("--node-array-limit", dest="nodeArrayLimit", type=int)
        if name == "status":
            sub.add_argument("--bucket-limit", dest="bucketLimit", type=int)
            sub.add_argument("--issue-limit", dest="issueLimit", type=int)
        if name == "application-context":
            sub.add_argument("--view", choices=("overview", "details"))
            sub.add_argument("--target-name", dest="targetNames", action="append")
            sub.add_argument("--section", choices=("environment", "storage", "attachments"))
            sub.add_argument("--install-path", dest="installPath")
            sub.add_argument("--target-limit", dest="targetLimit", type=int)
            sub.add_argument("--item-limit", dest="itemLimit", type=int)
            sub.add_argument("--offset", type=int)
    args = parser.parse_args(argv)
    if args.schema_version != 1:
        fail("incompatible_schema")
    if args.config is not None and (not args.config.startswith("/") or len(args.config) > 4096 or any(ord(c) < 32 for c in args.config)):
        fail("invalid_arguments")
    data = {key: value for key, value in vars(args).items() if key not in ("command", "schema_version", "config") and value is not None}
    validators = dict(zip(COMMANDS, (contract.validate_list_input, contract.validate_cluster_input,
                                    contract.validate_status_input, contract.validate_application_input)))
    try:
        data = validators[args.command](data) if args.command in validators else {}
    except InspectionError:
        fail("invalid_arguments")
    return SimpleNamespace(command=args.command, config=args.config, input=data)


def execute(parsed, client):
    from . import context_reader
    readers = dict(zip(COMMANDS, (context_reader.read_cluster_list, context_reader.read_cluster,
                                 context_reader.read_cluster_status, context_reader.read_application_context)))
    return readers[parsed.command](client, parsed.input)
