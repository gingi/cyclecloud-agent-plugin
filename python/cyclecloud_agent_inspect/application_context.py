"""Configured application evidence, bounded pages and section normalization."""
import copy
import posixpath
import re

from .contract import (
    MISSING, PAGE_BYTE_LIMIT, is_install_path, json_bytes, name_sort_key,
    omit_missing, required_record, required_rows, required_wire_string,
    safe_integer, validate_limit,
)
from .errors import cluster_not_found, invalid_response
from .normalize import consumed_fields


def unavailable(warning):
    return {"available": False, "warning": warning}


def bounded_list(items, limit=20, offset=0, byte_limit=PAGE_BYTE_LIMIT):
    """Page by actual entries; truncation compares the page with the full collection."""
    items = required_rows(items)
    limit = validate_limit(limit, 0, 9007199254740991)
    offset = validate_limit(offset, 0, 1000000)
    byte_limit = validate_limit(byte_limit, 2, 9007199254740991)
    page = []
    size = 2
    for item in items[offset:offset + limit]:
        entry_size = len(json_bytes(item)) + 1
        if size + entry_size > byte_limit:
            if not page:
                invalid_response()
            break
        # The standalone page helper also owns its result, not just normalizers.
        page.append(copy.deepcopy(item))
        size += entry_size
    return {"available": True, "items": page, "total": len(items), "returned": len(page),
            "truncated": len(items) > len(page), "offset": offset,
            "nextOffset": offset + len(page) if offset + len(page) < len(items) else None}


def _text(value):
    if value is MISSING or value is None or value == "":
        return MISSING
    return required_wire_string(value, 256)


def _flag(value):
    if value is MISSING or value is None:
        return MISSING
    if not isinstance(value, bool):
        invalid_response()
    return value


def _integer(value):
    return MISSING if value is MISSING or value is None else safe_integer(value)


def _identifier(value):
    result = _text(value)
    if result is not MISSING and re.search(r"://|[?#]", result):
        invalid_response()
    return result


def _unique(items, name):
    names = [name(item).lower() for item in items]
    if len(set(names)) != len(names):
        invalid_response()
    return sorted(items, key=lambda item: name_sort_key(name(item)))


def _record_list(value, normalize, page):
    if value is MISSING or value is None:
        return unavailable("This configuration collection was not supplied by CycleCloud.")
    entries = [(required_wire_string(name, 256), fields) for name, fields in required_record(value).items()]
    items = [normalize(name, fields) for name, fields in _unique(entries, lambda entry: entry[0])]
    return bounded_list(items, page.get("limit", 20), page.get("offset", 0))


def _string_list(value, page):
    if value is MISSING or value is None:
        return unavailable("This configuration field was not supplied by CycleCloud.")
    values = [value] if isinstance(value, str) else required_rows(value)
    strings = [required_wire_string(item, 256) for item in values]
    if len(set(item.lower() for item in strings)) != len(strings):
        invalid_response()
    # Preserve inheritance precedence and configured VM preference order.
    return bounded_list(strings, page.get("limit", 20), page.get("offset", 0))


def _specs(value, page):
    def normalize(name, raw):
        fields = consumed_fields(raw, ("project", "spec", "version", "sourcelocker", "additionalspec", "order"))
        return omit_missing({"project": required_wire_string(fields.get("project", MISSING), 256),
                             "spec": required_wire_string(fields.get("spec", MISSING), 256),
                             "version": _identifier(fields.get("version", MISSING)),
                             "sourceLocker": _identifier(fields.get("sourcelocker", MISSING)),
                             "additional": _flag(fields.get("additionalspec", MISSING)),
                             "order": _integer(fields.get("order", MISSING))})
    return _record_list(value, normalize, page)


def _mounts(value, install_path, page):
    def normalize(name, raw):
        fields = consumed_fields(raw, ("mountpoint", "type", "fs_type", "disabled"))
        mountpoint = _text(fields.get("mountpoint", MISSING))
        if mountpoint is not MISSING and not is_install_path(mountpoint):
            invalid_response()
        disabled = _flag(fields.get("disabled", MISSING))
        prefix = MISSING if mountpoint is MISSING else posixpath.normpath(mountpoint).rstrip("/")
        within = prefix is not MISSING and (install_path == prefix or install_path.startswith(prefix + "/"))
        if disabled is True or (prefix is not MISSING and not within):
            covers = False
        elif disabled is False and prefix is not MISSING:
            covers = within
        else:
            covers = None
        return omit_missing({"name": name, "mountpoint": mountpoint, "type": _text(fields.get("type", MISSING)),
                             "filesystem": _text(fields.get("fs_type", MISSING)), "disabled": disabled, "coversInstallPath": covers})
    return _record_list(value, normalize, page)


def _volumes(value, page):
    def normalize(name, raw):
        fields = consumed_fields(raw, ("mount", "persistent", "disabled"))
        return omit_missing({"name": name, "mount": _text(fields.get("mount", MISSING)),
                             "persistent": _flag(fields.get("persistent", MISSING)), "disabled": _flag(fields.get("disabled", MISSING))})
    return _record_list(value, normalize, page)


def _attachment(value):
    if not isinstance(value, str):
        return unavailable("No simple additional-spec parameter reference is available; inspect the cluster template before attaching.")
    match = re.fullmatch(r"\$(?:([A-Za-z_][A-Za-z0-9_.-]{0,255})|\{([A-Za-z_][A-Za-z0-9_.-]{0,255})\})", value)
    if match is None:
        return unavailable("The attachment reference is not a simple parameter; inspect the cluster template before attaching.")
    return {"available": True, "parameterName": match.group(1) or match.group(2)}


def _identity(fields):
    name = required_wire_string(fields.get("name", MISSING), 256)
    array = _flag(fields.get("isarray", MISSING))
    if array is not True and _text(fields.get("template", MISSING)) != name:
        invalid_response()
    return {"name": name, "kind": "nodearray" if array is True else "node"}


def normalize_application_overview(value):
    result = []
    for raw in required_rows(value):
        fields = consumed_fields(raw, ("name", "template", "isarray", "state", "imagename", "slurmrole",
                                       "slurmpartition", "slurmhaenabled", "attachmentreference"))
        identity = _identity(fields)
        attachment = _attachment(fields.get("attachmentreference", MISSING))
        result.append(omit_missing({**identity, "state": _text(fields.get("state", MISSING)),
                                    "image": _identifier(fields.get("imagename", MISSING)),
                                    "role": _text(fields.get("slurmrole", MISSING)),
                                    "partition": _text(fields.get("slurmpartition", MISSING)),
                                    "haEnabled": _flag(fields.get("slurmhaenabled", MISSING)),
                                    "attachmentParameter": attachment.get("parameterName", MISSING)}))
    return _unique(result, lambda row: row["name"])


def normalize_application_details(value, install_path, section, page=None):
    section_fields = {
        "environment": ("extends", "state", "targetstate", "imagename", "machinetype", "architecture", "locker",
                        "slurmrole", "slurmversion", "slurmpartition", "slurmhaenabled", "slurmprimaryscheduler", "slurmautoscale"),
        "storage": ("mounts", "volumes"),
        "attachments": ("clusterinitspecs", "attachmentreference"),
    }
    if not isinstance(section, str) or section not in section_fields:
        invalid_response()
    if not is_install_path(install_path):
        invalid_response()
    page = {} if page is None else required_record(page)
    result = []
    for raw in required_rows(value):
        fields = consumed_fields(raw, ("name", "template", "isarray") + section_fields[section])
        identity = _identity(fields)
        if section == "storage":
            result.append({**identity, "mounts": _mounts(fields.get("mounts", MISSING), install_path, page),
                           "volumes": _volumes(fields.get("volumes", MISSING), page)})
        elif section == "attachments":
            result.append({**identity, "specs": _specs(fields.get("clusterinitspecs", MISSING), page),
                           "attachment": _attachment(fields.get("attachmentreference", MISSING))})
        else:
            image = _identifier(fields.get("imagename", MISSING))
            result.append(omit_missing({
                **identity, "state": _text(fields.get("state", MISSING)), "targetState": _text(fields.get("targetstate", MISSING)),
                "bases": _string_list(fields.get("extends", MISSING), page), "image": image,
                "platform": unavailable("The configured image was not supplied; its OS release is unresolved." if image is MISSING
                                        else "Image platform metadata could not be retrieved or validated."),
                "machineTypes": _string_list(fields.get("machinetype", MISSING), page),
                "architecture": _text(fields.get("architecture", MISSING)), "locker": _identifier(fields.get("locker", MISSING)),
                "scheduler": omit_missing({"role": _text(fields.get("slurmrole", MISSING)),
                                           "version": _text(fields.get("slurmversion", MISSING)),
                                           "partition": _text(fields.get("slurmpartition", MISSING)),
                                           "haEnabled": _flag(fields.get("slurmhaenabled", MISSING)),
                                           "primary": _flag(fields.get("slurmprimaryscheduler", MISSING)),
                                           "autoscale": _flag(fields.get("slurmautoscale", MISSING))}),
            }))
    return _unique(result, lambda row: row["name"])


def normalize_application_parameters(value, page=None):
    page = {} if page is None else required_record(page)
    result = []
    for raw in required_rows(value):
        fields = consumed_fields(raw, ("name", "label", "parametertype", "value"))
        if fields.get("parametertype") != "Cloud.ClusterInitSpecs":
            invalid_response()
        result.append(omit_missing({"name": required_wire_string(fields.get("name", MISSING), 256),
                                    "label": _text(fields.get("label", MISSING)), "specs": _specs(fields.get("value", MISSING), page)}))
    return _unique(result, lambda row: row["name"])


def normalize_context_cluster(value, name):
    items = required_rows(value)
    if not items:
        cluster_not_found()
    if len(items) != 1:
        invalid_response()
    fields = consumed_fields(items[0], ("clustername", "parentname", "state", "targetstate"))
    if required_wire_string(fields.get("clustername", MISSING), 256) != name:
        invalid_response()
    return omit_missing({"name": name, "parentName": _text(fields.get("parentname", MISSING)),
                         "state": _text(fields.get("state", MISSING)), "targetState": _text(fields.get("targetstate", MISSING))})
