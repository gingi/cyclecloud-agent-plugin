"""Configured image platform evidence from exact Package metadata matches."""
import re

from .application_context import unavailable
from .contract import MISSING, omit_missing, required_rows, required_wire_string
from .errors import invalid_response
from .normalize import consumed_fields


def _optional_text(value, limit):
    return MISSING if value is MISSING or value is None or value == "" else required_wire_string(value, limit)


def normalize_image_platform(value, image):
    rows = required_rows(value)
    if not rows:
        return unavailable("No image-package metadata was returned for the configured image. Do not infer an OS release from its name.")
    records = []
    for raw in rows:
        fields = consumed_fields(raw, ("name", "packagetype", "label", "os", "jetpackplatform"))
        if (required_wire_string(fields.get("name", MISSING), 256) != image
                or required_wire_string(fields.get("packagetype", MISSING), 32).lower() != "image"):
            invalid_response()
        os = _optional_text(fields.get("os", MISSING), 32)
        records.append({"os": os if os is MISSING else os.lower(),
                        "jetpackPlatform": _optional_text(fields.get("jetpackplatform", MISSING), 128),
                        "label": _optional_text(fields.get("label", MISSING), 256)})
    if any(row["os"] is MISSING or row["jetpackPlatform"] is MISSING for row in records):
        return unavailable("Image-package metadata does not specify a complete OS and Jetpack platform. Keep the release unresolved.")
    first = records[0]
    if any(row["os"] != first["os"] or row["jetpackPlatform"] != first["jetpackPlatform"] for row in records):
        return unavailable("Matching image-package records disagree about the platform. Confirm the selected image revision before choosing an OS release.")
    label = first["label"] if all(row["label"] == first["label"] for row in records) else MISSING
    # ASCII digits, matching the JavaScript regular expression; no alias guessing.
    release = re.fullmatch(r"(ubuntu|almalinux|centos|sles)-([0-9]+(?:\.[0-9]+)*)", first["jetpackPlatform"]) if first["os"] == "linux" else None
    result = omit_missing({"available": True, "source": "CycleCloud Package metadata", "os": first["os"],
                           "jetpackPlatform": first["jetpackPlatform"], "label": label,
                           "matchingRecords": len(records), "runtimeVerified": False})
    if release is not None:
        result.update(distribution=release.group(1), release=release.group(2))
    return result
