"""Closed-allowlist normalization of CycleCloud query and public status data."""
import math
import re

from .contract import (
    MISSING, ascii_lowercase, name_sort_key, omit_missing, optional_wire_string,
    required_record, required_rows, required_wire_string, safe_integer,
    validate_limit, well_formed_text,
)
from .errors import cluster_not_found, invalid_response


def consumed_fields(value, consumed_names):
    allowed = set(consumed_names)
    result = {}
    for key, field_value in required_record(value).items():
        normalized = ascii_lowercase(key)
        if normalized not in allowed:
            continue
        if normalized in result:
            invalid_response()
        result[normalized] = field_value
    return result


def _optional_array(fields, name):
    return required_rows(fields[name]) if name in fields else []


def _optional_strings(fields, definitions):
    return omit_missing({output: optional_wire_string(fields.get(source, MISSING), limit)
                         for output, source, limit in definitions})


def _checked_sum(values):
    return safe_integer(sum(values), 0)


def _cluster_fields(value):
    return consumed_fields(value, ("clustername", "state", "targetstate", "nodes", "nodearrays"))


def _states(fields):
    return _optional_strings(fields, (("state", "state", 128), ("targetState", "targetstate", 128)))


def _cluster_summary(value):
    fields = _cluster_fields(value)
    name = required_wire_string(fields.get("clustername", MISSING), 256)
    states = _states(fields)
    fixed_nodes = _optional_array(fields, "nodes")
    node_arrays = _optional_array(fields, "nodearrays")
    array_count = _checked_sum([
        safe_integer(consumed_fields(node, ["count"]).get("count", MISSING), 0)
        for node in node_arrays
    ])
    return {"name": name, **states, "fixedNodeDefinitions": len(fixed_nodes),
            "nodeArrayCount": len(node_arrays), "arrayNodeCount": array_count,
            "configuredNodeCount": _checked_sum([len(fixed_nodes), array_count])}


def normalize_cluster_list(raw, limit=50):
    limit = validate_limit(limit, 1, 200)
    clusters = sorted((_cluster_summary(row) for row in required_rows(raw)), key=lambda row: name_sort_key(row["name"]))
    selected = clusters[:limit]
    return {"clusters": selected, "total": len(clusters), "returned": len(selected), "truncated": len(selected) < len(clusters)}


def _fixed_node(value):
    fields = consumed_fields(value, ("nodeid", "name", "template", "state", "targetstate"))
    return {"name": required_wire_string(fields.get("name", MISSING), 256),
            **_optional_strings(fields, (("id", "nodeid", 256), ("template", "template", 256))), **_states(fields)}


def _node_array(value):
    fields = consumed_fields(value, ("template", "state", "targetstate", "count", "corecount"))
    result = {"template": required_wire_string(fields.get("template", MISSING), 256),
              **_states(fields), "count": safe_integer(fields.get("count", MISSING), 0)}
    if "corecount" in fields:
        result["coreCount"] = safe_integer(fields["corecount"], 0)
    return result


def normalize_cluster(raw, cluster_name, fixed_node_limit=50, node_array_limit=50):
    fixed_node_limit = validate_limit(fixed_node_limit, 0, 200)
    node_array_limit = validate_limit(node_array_limit, 0, 100)
    rows = required_rows(raw)
    if not rows:
        cluster_not_found()
    if len(rows) != 1:
        invalid_response()
    fields = _cluster_fields(rows[0])
    name = required_wire_string(fields.get("clustername", MISSING), 256)
    if name != cluster_name:
        invalid_response()
    states = _states(fields)
    fixed_nodes = sorted((_fixed_node(row) for row in _optional_array(fields, "nodes")), key=lambda row: name_sort_key(row["name"]))
    node_arrays = sorted((_node_array(row) for row in _optional_array(fields, "nodearrays")), key=lambda row: name_sort_key(row["template"]))
    array_count = _checked_sum([node["count"] for node in node_arrays])
    selected_fixed = fixed_nodes[:fixed_node_limit]
    selected_arrays = node_arrays[:node_array_limit]
    return {"cluster": {"name": name, **states,
                        "nodeArrays": selected_arrays, "nodeArrayTotal": len(node_arrays), "nodeArrayReturned": len(selected_arrays),
                        "nodeArraysTruncated": len(selected_arrays) < len(node_arrays),
                        "fixedNodes": selected_fixed, "fixedNodeDefinitionsTotal": len(fixed_nodes),
                        "fixedNodeDefinitionsReturned": len(selected_fixed),
                        "fixedNodeDefinitionsTruncated": len(selected_fixed) < len(fixed_nodes),
                        "arrayNodeCount": array_count, "configuredNodeCount": _checked_sum([len(fixed_nodes), array_count])}}


def _bucket_status(value):
    record = required_record(value)
    result = {"bucketId": required_wire_string(record.get("bucketId", MISSING), 256)}
    if "definition" in record:
        definition = required_record(record["definition"])
        machine = optional_wire_string(definition.get("machineType", MISSING), 256)
        if machine is not MISSING:
            result["machineType"] = machine
    if not isinstance(record.get("valid"), bool):
        invalid_response()
    result["valid"] = record["valid"]
    for field in ("maxCount", "maxCoreCount", "quotaCount", "quotaCoreCount", "consumedCoreCount",
                  "activeCount", "activeCoreCount", "availableCount", "availableCoreCount"):
        result[field] = safe_integer(record.get(field, MISSING), 0)
    result.update(_optional_strings(record, (("invalidReason", "invalidReason", 256), ("spotPlacementScore", "spotPlacementScore", 256))))
    if "lastCapacityFailure" in record:
        failure = record["lastCapacityFailure"]
        if isinstance(failure, bool) or not isinstance(failure, (int, float)):
            invalid_response()
        try:
            if not math.isfinite(failure):
                invalid_response()
        except OverflowError:
            invalid_response()
        result["lastCapacityFailure"] = failure
    return result


def _node_array_status(value):
    record = required_record(value)
    return {"name": required_wire_string(record.get("name", MISSING), 256),
            "maxCount": safe_integer(record.get("maxCount", MISSING), 0),
            "maxCoreCount": safe_integer(record.get("maxCoreCount", MISSING), 0),
            "buckets": sorted((_bucket_status(row) for row in required_rows(record.get("buckets"))),
                              key=lambda row: name_sort_key(row["bucketId"]))}


def normalize_cluster_status(raw, cluster_name, node_array_limit=20, bucket_limit=20):
    node_array_limit = validate_limit(node_array_limit, 0, 50)
    bucket_limit = validate_limit(bucket_limit, 0, 50)
    record = required_record(raw)
    states = _optional_strings(record, (("state", "state", 128), ("targetState", "targetState", 128)))
    max_count = safe_integer(record.get("maxCount", MISSING), 0)
    max_core_count = safe_integer(record.get("maxCoreCount", MISSING), 0)
    arrays = sorted((_node_array_status(row) for row in required_rows(record.get("nodearrays"))), key=lambda row: name_sort_key(row["name"]))
    bucket_total = _checked_sum([len(row["buckets"]) for row in arrays])
    selected = []
    remaining = 500
    for row in arrays[:node_array_limit]:
        count = min(len(row["buckets"]), bucket_limit, remaining)
        buckets = row["buckets"][:count]
        remaining -= count
        selected.append({**row, "buckets": buckets, "bucketTotal": len(row["buckets"]),
                         "bucketReturned": count, "bucketsTruncated": count < len(row["buckets"])})
    returned = _checked_sum([row["bucketReturned"] for row in selected])
    return {"status": {"clusterName": cluster_name, **states, "maxCount": max_count, "maxCoreCount": max_core_count,
                       "nodeArrays": selected, "nodeArrayTotal": len(arrays), "nodeArrayReturned": len(selected),
                       "nodeArraysTruncated": len(selected) < len(arrays), "bucketTotal": bucket_total,
                       "bucketReturned": returned, "bucketsTruncated": returned < bucket_total}}


def normalize_cluster_issues(raw, issue_limit=20):
    issue_limit = validate_limit(issue_limit, 0, 100)
    issues = []
    for row in required_rows(raw):
        fields = consumed_fields(row, ("name", "status", "nodecount", "message", "detail", "recommendation"))
        severity = required_wire_string(fields.get("status", MISSING), 128)
        if severity in ("OK", "Pending"):
            continue
        if severity not in ("Error", "Warning"):
            invalid_response()
        text = {}
        truncated = False
        for field in ("message", "detail", "recommendation"):
            value = fields.get(field)
            if value is None:
                continue
            value = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", well_formed_text(value))
            truncated = truncated or len(value) > 2048
            text[field] = value[:2047] + "…" if len(value) > 2048 else value
        issues.append({"name": required_wire_string(fields.get("name", MISSING), 256), "severity": severity,
                       "nodeCount": safe_integer(fields.get("nodecount", MISSING), 0), **text, "textTruncated": truncated})
    issues.sort(key=lambda row: (name_sort_key(row["severity"]), name_sort_key(row["name"]), name_sort_key(row.get("message", ""))))
    selected = issues[:issue_limit]
    return {"available": True, "items": selected, "total": len(issues), "returned": len(selected), "truncated": len(selected) < len(issues)}
