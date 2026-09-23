"""Pure JSON, scalar, ordering and input contracts (Python 3.8+).

Query fields fold ASCII only. Name sorting reproduces ECMAScript's UTF-16
lexical comparison, not Python's Unicode-scalar ordering. Lengths are scalars;
serialized budgets are UTF-8 bytes, with compact, non-ASCII-escaped JSON.
"""
import json
import math
import posixpath
import re

from .errors import invalid_response

MAX_SAFE_INTEGER = 9007199254740991
PAGE_BYTE_LIMIT = 6144
ENVELOPE_BYTE_LIMIT = 24576
MISSING = object()
_CONTROLS = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
# String.prototype.trim's whitespace set, rather than Python's broader strip().
_JS_WHITESPACE = "\t\n\v\f\r                  　﻿"


def ascii_lowercase(value):
    return value.translate(_ASCII_LOWER)


def name_sort_key(value):
    return (ascii_lowercase(value).encode("utf-16-be"), value.encode("utf-16-be"))


def well_formed_text(value):
    if not isinstance(value, str):
        invalid_response()
    try:
        # Python JSON decoding already joins escaped surrogate pairs. Also accept
        # explicitly constructed valid pairs, but never a lone surrogate.
        return value.encode("utf-16-le", "surrogatepass").decode("utf-16-le")
    except UnicodeError:
        invalid_response()


def optional_wire_string(value, maximum_scalars):
    if value is MISSING:
        return MISSING
    value = well_formed_text(value)
    if _CONTROLS.search(value) or len(value) > maximum_scalars:
        invalid_response()
    return value


def required_wire_string(value, maximum_scalars):
    value = optional_wire_string(value, maximum_scalars)
    if value is MISSING or not value:
        invalid_response()
    return value


def required_record(value):
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        invalid_response()
    return value


def required_rows(value):
    if not isinstance(value, list):
        invalid_response()
    return value


def safe_integer(value, minimum=-MAX_SAFE_INTEGER, maximum=MAX_SAFE_INTEGER):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or (isinstance(value, float) and not math.isfinite(value))
            or value < minimum or value > maximum or int(value) != value):
        invalid_response()
    return int(value)


def validate_limit(value, minimum, maximum):
    return safe_integer(value, minimum, maximum)


def omit_missing(fields):
    return {key: value for key, value in fields.items() if value is not MISSING}


def _json_number(value):
    if isinstance(value, int):
        if -MAX_SAFE_INTEGER <= value <= MAX_SAFE_INTEGER:
            return str(value)
        # Finite status timestamps are not counters. Match JavaScript's number
        # representation without imposing the count/order safe-integer limit.
        value = float(value)
    if not math.isfinite(value):
        invalid_response()
    if value == 0:
        return "0"
    # Match JSON.stringify's fixed/exponential presentation. CPython and JS both
    # use shortest-round-trip float strings; contexts otherwise contain integers.
    text = repr(value).lower()
    if "e" not in text:
        return text[:-2] if text.endswith(".0") else text
    mantissa, exponent_text = text.split("e")
    exponent = int(exponent_text)
    if 1e-6 <= abs(value) < 1e21:
        sign = "-" if mantissa.startswith("-") else ""
        digits = mantissa.lstrip("-").replace(".", "")
        point = 1 + exponent
        if point <= 0:
            return sign + "0." + "0" * (-point) + digits
        if point >= len(digits):
            return sign + digits + "0" * (point - len(digits))
        return sign + digits[:point] + "." + digits[point:]
    if mantissa.endswith(".0"):
        mantissa = mantissa[:-2]
    return mantissa + "e" + ("+" if exponent >= 0 else "-") + str(abs(exponent))


def json_bytes(value):
    """Serialize a JSON value safely for output and the shared byte budgets."""
    def encode(item):
        if item is None:
            return "null"
        if item is True:
            return "true"
        if item is False:
            return "false"
        if isinstance(item, str):
            return json.dumps(well_formed_text(item), ensure_ascii=False)
        if isinstance(item, (int, float)):
            return _json_number(item)
        if isinstance(item, list):
            return "[" + ",".join(encode(entry) for entry in item) + "]"
        if isinstance(item, dict):
            required_record(item)
            return "{" + ",".join(encode(key) + ":" + encode(entry) for key, entry in item.items()) + "}"
        invalid_response()
    try:
        return encode(value).encode("utf-8")
    except (RecursionError, UnicodeError, ValueError, OverflowError):
        invalid_response()


def is_install_path(value):
    try:
        path = required_wire_string(value, 1024)
    except Exception:
        return False
    return path.startswith("/") and not path.startswith("//") and not any(
        part in (".", "..") for part in path.split("/")
    )


def _cluster_name(value):
    if not isinstance(value, str):
        invalid_response()
    result = required_wire_string(value.strip(_JS_WHITESPACE), 256)
    if result in (".", ".."):
        invalid_response()
    return result


def _input(value, allowed):
    value = required_record(value)
    if set(value) - set(allowed):
        invalid_response()
    return value


def validate_list_input(value):
    value = _input(value, ("limit",))
    return {"limit": validate_limit(value.get("limit", 50), 1, 200)}


def validate_cluster_input(value):
    value = _input(value, ("clusterName", "fixedNodeLimit", "nodeArrayLimit"))
    return {"clusterName": _cluster_name(value.get("clusterName")),
            "fixedNodeLimit": validate_limit(value.get("fixedNodeLimit", 50), 0, 200),
            "nodeArrayLimit": validate_limit(value.get("nodeArrayLimit", 50), 0, 100)}


def validate_status_input(value):
    value = _input(value, ("clusterName", "nodeArrayLimit", "bucketLimit", "issueLimit"))
    return {"clusterName": _cluster_name(value.get("clusterName")),
            "nodeArrayLimit": validate_limit(value.get("nodeArrayLimit", 20), 0, 50),
            "bucketLimit": validate_limit(value.get("bucketLimit", 20), 0, 50),
            "issueLimit": validate_limit(value.get("issueLimit", 20), 0, 100)}


def validate_application_input(value):
    value = _input(value, ("clusterName", "targetNames", "installPath", "view", "section", "targetLimit", "itemLimit", "offset"))
    result = {"clusterName": _cluster_name(value.get("clusterName")),
              "view": value.get("view", "overview"),
              "targetLimit": validate_limit(value.get("targetLimit", 10), 1, 20),
              "itemLimit": validate_limit(value.get("itemLimit", 5), 1, 10),
              "offset": validate_limit(value.get("offset", 0), 0, 1000000)}
    if result["view"] not in ("overview", "details"):
        invalid_response()
    if "section" in value:
        if result["view"] == "overview" or value["section"] not in ("environment", "storage", "attachments"):
            invalid_response()
        result["section"] = value["section"]
    path = value.get("installPath", "/shared/apps")
    if not is_install_path(path):
        invalid_response()
    result["installPath"] = posixpath.normpath(well_formed_text(path)).rstrip("/") or "/"
    if "targetNames" in value:
        targets = required_rows(value["targetNames"])
        if not 1 <= len(targets) <= 20:
            invalid_response()
        result["targetNames"] = [_cluster_name(name) for name in targets]
    if result["view"] == "details" and len(result.get("targetNames", [])) != 1:
        invalid_response()
    return result
