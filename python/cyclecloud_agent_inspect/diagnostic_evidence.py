"""Bounded diagnostic text, UTC times and independently available evidence."""

import re
from datetime import datetime, timezone

from .contract import MISSING, json_bytes, omit_missing, required_wire_string, safe_integer, well_formed_text
from .errors import InspectionError, invalid_response

ITEM_BYTE_LIMIT = 8192
_CONTROLS = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_TIME = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})\Z")


def observed_at():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def identifier(value):
    return required_wire_string(MISSING if value is None else value, 256)


def optional_identifier(value, maximum_scalars=256):
    return MISSING if value is None or value is MISSING else required_wire_string(value, maximum_scalars)


def boolean(value):
    if value is None or value is MISSING:
        return MISSING
    if not isinstance(value, bool):
        invalid_response()
    return value


def nonnegative_integer(value):
    return MISSING if value is None or value is MISSING else safe_integer(value, 0)


class DiagnosticText:
    def __init__(self):
        self.truncated = False

    def read(self, value, limit=1024, byte_limit=1536):
        if value is None or value is MISSING:
            return MISSING
        text = _CONTROLS.sub(" ", well_formed_text(value))
        if len(text) <= limit and len(json_bytes(text)) - 2 <= byte_limit:
            return text
        self.truncated = True
        selected = []
        size = len("…".encode("utf-8"))
        for character in text:
            count = len(json_bytes(character)) - 2
            if len(selected) >= limit - 1 or size + count > byte_limit:
                break
            selected.append(character)
            size += count
        return "".join(selected) + "…"


def parse_time(value):
    if value is None or value is MISSING:
        return MISSING
    raw = value.get("$date") if isinstance(value, dict) else value
    match = _TIME.fullmatch(raw) if isinstance(raw, str) else None
    if match is None:
        invalid_response()
    whole, fraction, zone = match.groups()
    if zone != "Z" and (int(zone[1:3]) > 23 or int(zone[4:6]) > 59):
        invalid_response()
    # Azure can report seven fractional digits; Python 3.8–3.10 only accepts
    # three or six. Normalize to the contract's millisecond precision first.
    normalized = whole + "." + ((fraction or "") + "000")[:3] + ("+00:00" if zone == "Z" else zone)
    try:
        return datetime.fromisoformat(normalized).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        invalid_response()


def format_time(value):
    return MISSING if value is MISSING else value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def timestamp(value):
    return format_time(parse_time(value))


def bounded_items(items, limit, totals=True):
    selected = []
    size = 2
    for item in items[:limit]:
        count = len(json_bytes(item)) + bool(selected)
        if size + count > ITEM_BYTE_LIMIT:
            break
        selected.append(item)
        size += count
    return omit_missing({
        "items": selected,
        "total": len(items) if totals else MISSING,
        "returned": len(selected),
        "truncated": len(selected) < len(items),
    })


def unavailable(source, reason, warning=None):
    return {
        "available": False,
        "source": source,
        "reason": reason,
        "warning": warning or source + " could not be retrieved or validated; this is not evidence of health or an empty result.",
    }


def evidence(source, read):
    try:
        return {"available": True, "source": source, **read()}
    except Exception as error:
        if isinstance(error, InspectionError) and error.code in ("cancelled", "timeout"):
            raise
        codes = ("permission_denied", "network_error", "upstream_error", "invalid_response", "output_limit",
                 "authentication_required", "unsupported_authentication", "configuration_required")
        reason = error.code if isinstance(error, InspectionError) and error.code in codes else "invalid_response"
        return unavailable(source, reason)
