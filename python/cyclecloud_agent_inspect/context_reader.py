"""Synchronous read orchestration. Clients own transport and cancellation timing.

The client is duck typed and supplies list_clusters(), get_cluster(name),
get_cluster_status(name), get_cluster_issues(name),
get_application_nodes(name, selection=None),
get_application_parameters(name, parameter_name=None), and
get_image_metadata(image). No transport or installed CLI import occurs here.
"""
from datetime import datetime, timezone

from .application_context import (
    bounded_list, normalize_application_details, normalize_application_overview,
    normalize_application_parameters, normalize_context_cluster, unavailable,
)
from .contract import (
    ENVELOPE_BYTE_LIMIT, json_bytes, validate_application_input,
    validate_cluster_input, validate_list_input, validate_status_input,
)
from .errors import invalid_response, propagate_cancellation
from .image_platform import normalize_image_platform
from .normalize import normalize_cluster, normalize_cluster_issues, normalize_cluster_list, normalize_cluster_status


def read_cluster_list(client, input=None):
    input = validate_list_input({} if input is None else input)
    return normalize_cluster_list(client.list_clusters(), input["limit"])


def read_cluster(client, input):
    input = validate_cluster_input(input)
    return normalize_cluster(client.get_cluster(input["clusterName"]), input["clusterName"],
                             input["fixedNodeLimit"], input["nodeArrayLimit"])


def read_cluster_status(client, input):
    input = validate_status_input(input)
    name = input["clusterName"]
    result = normalize_cluster_status(client.get_cluster_status(name), name, input["nodeArrayLimit"], input["bucketLimit"])
    try:
        issues = normalize_cluster_issues(client.get_cluster_issues(name), input["issueLimit"])
    except Exception as error:
        propagate_cancellation(error)
        issues = unavailable("Cluster status is available, but node issues could not be retrieved.")
    result["status"]["issues"] = issues
    return result


def read_application_context(client, input, observed_at=None):
    input = validate_application_input(input)
    view = input["view"]
    section = input.get("section", "environment")
    cluster = normalize_context_cluster(client.get_cluster(input["clusterName"]), input["clusterName"])
    context = {
        "clusterName": cluster["name"],
        **{key: cluster[key] for key in ("state", "targetState") if key in cluster},
        "observedAt": observed_at if observed_at is not None else datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "evidence": "configured", "view": view,
        **({"section": section} if view == "details" else {}),
        "installPath": input["installPath"],
        "sources": ["CycleCloud cluster summary", "Cloud.Node " + ("overview" if view == "overview" else section)],
        "targets": unavailable("Application node configuration could not be retrieved or validated."),
        "nextStep": (
            "Choose a target, then request view=details with one targetNames entry and section=environment, storage, or attachments. Page only when needed using nextOffset."
            if view == "overview" else
            "Follow a collection's nextOffset only if more entries are needed, using the same target, section and itemLimit. Other sections require separate calls."
        ),
        "warnings": [
            "Configuration is not an atomic snapshot. Re-read before changes.",
            "Shared or inherited parameters may affect other targets or child clusters.",
        ],
        "unverified": [
            "Installed application software, compiler, MPI and node-local libraries.",
            "Actual OS/architecture, mounted/writable storage and rollout data survival.",
            "Live Slurm accounts, QoS, jobs and MPI launcher compatibility.",
            "Uploaded artifacts, successful spec execution and application readiness.",
        ],
    }
    if view == "overview":
        try:
            nodes = normalize_application_overview(client.get_application_nodes(input["clusterName"], {"view": "overview"}))
            selected = [node for node in nodes if "targetNames" not in input or node["name"] in input["targetNames"]]
            context["targets"] = {
                **bounded_list(selected, input["targetLimit"], input["offset"]),
                "missingRequested": [name for name in input.get("targetNames", []) if not any(node["name"] == name for node in nodes)],
            }
        except Exception as error:
            propagate_cancellation(error)
        return {"context": context}

    target_name = input["targetNames"][0]
    page = {"limit": input["itemLimit"], "offset": input["offset"]}
    try:
        nodes = normalize_application_details(
            client.get_application_nodes(input["clusterName"], {"view": "details", "targetName": target_name, "section": section}),
            input["installPath"], section, page,
        )
        if len(nodes) > 1 or any(node["name"] != target_name for node in nodes):
            invalid_response()
        context["targets"] = {**bounded_list(nodes, 1, 0, ENVELOPE_BYTE_LIMIT),
                              "missingRequested": [] if nodes else [target_name]}
        target = context["targets"]["items"][0] if nodes else None
    except Exception as error:
        propagate_cancellation(error)
        return {"context": context}

    if section == "environment" and target is not None:
        context["nextStep"] += (
            " Use supplied platform and scheduler.version as the configured authoring baseline; ask only about missing/conflicting facts or application choices. Runtime checks are a separate follow-up."
        )
        if "image" in target:
            context["sources"].append("CycleCloud Package image metadata")
            try:
                platform = normalize_image_platform(client.get_image_metadata(target["image"]), target["image"])
                if len(json_bytes({**target, "platform": platform})) > ENVELOPE_BYTE_LIMIT:
                    invalid_response()
                target["platform"] = platform
            except Exception as error:
                propagate_cancellation(error)
        return {"context": context}
    if section != "attachments" or target is None:
        return {"context": context}

    context["attachmentParameters"] = unavailable("Attachment parameter metadata could not be retrieved or validated.")
    if not target["attachment"]["available"]:
        context["attachmentParameters"] = unavailable("No simple attachment parameter is available. Inspect the template before attaching.")
        return {"context": context}
    parameter_name = target["attachment"]["parameterName"]
    used_by = unavailable("Shared parameter uses could not be retrieved; do not assume this is a single-target edit.")
    try:
        overview = normalize_application_overview(client.get_application_nodes(input["clusterName"], {"view": "overview"}))
        if any("attachmentParameter" not in node for node in overview):
            used_by = unavailable(
                "Some target attachment references are missing or are not simple parameter references. Shared-use coverage is incomplete; inspect the template before assuming a single-target edit."
            )
        else:
            used_by = bounded_list([node["name"] for node in overview if node["attachmentParameter"].lower() == parameter_name.lower()],
                                   page["limit"], page["offset"])
    except Exception as error:
        propagate_cancellation(error)
    try:
        root = cluster
        visited = {root["name"].lower()}
        while "parentName" in root:
            if len(visited) >= 10 or root["parentName"].lower() in visited:
                invalid_response()
            parent_name = root["parentName"]
            root = normalize_context_cluster(client.get_cluster(parent_name), parent_name)
            visited.add(root["name"].lower())
        context["sources"].append("Cloud.ClusterParameter cluster-init metadata")
        parameters = normalize_application_parameters(client.get_application_parameters(root["name"], parameter_name), page)
        relevant = [{**parameter, "usedBy": used_by} for parameter in parameters if parameter["name"].lower() == parameter_name.lower()]
        context["attachmentParameters"] = {
            **bounded_list(relevant, 1, 0, ENVELOPE_BYTE_LIMIT), "clusterName": root["name"],
            "missingReferenced": [] if relevant else [parameter_name],
        }
    except Exception as error:
        propagate_cancellation(error)
    return {"context": context}
