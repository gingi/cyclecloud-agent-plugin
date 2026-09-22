"""Portable and Python-specific boundary coverage for the inspection core."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))

from cyclecloud_agent_inspect.application_context import (
    bounded_list, normalize_application_details,
    normalize_application_overview, normalize_application_parameters,
    normalize_context_cluster,
)
from cyclecloud_agent_inspect.contract import (
    MAX_SAFE_INTEGER, is_install_path, json_bytes, validate_application_input,
    validate_list_input, validate_cluster_input, validate_status_input,
)
from cyclecloud_agent_inspect.context_reader import read_application_context, read_cluster_status
from cyclecloud_agent_inspect.errors import InspectionError
from cyclecloud_agent_inspect.image_platform import normalize_image_platform
from cyclecloud_agent_inspect.normalize import (
    consumed_fields, normalize_cluster, normalize_cluster_issues,
    normalize_cluster_list, normalize_cluster_status,
)
from test_inspect_parity import FixtureClient


def bucket(name="b"):
    result = dict.fromkeys([
        "maxCount", "maxCoreCount", "quotaCount", "quotaCoreCount", "consumedCoreCount",
        "activeCount", "activeCoreCount", "availableCount", "availableCoreCount",
    ], 1)
    result.update(bucketId=name, valid=True)
    return result


def status(arrays=1, buckets=1):
    return {"maxCount": 1, "maxCoreCount": 1, "nodearrays": [
        {"name": "array-%03d" % i, "maxCount": 1, "maxCoreCount": 1,
         "buckets": [bucket("b-%03d" % j) for j in range(buckets)]}
        for i in range(arrays)
    ]}


def client_data():
    return {"clusters": {"demo": [{"ClusterName": "demo"}]},
            "nodes": [{"Name": "scheduler", "Template": "scheduler", "AttachmentReference": "$Specs",
                       "ImageName": "image", "ClusterInitSpecs": {}}],
            "parameters": [{"Name": "Specs", "ParameterType": "Cloud.ClusterInitSpecs", "Value": {}}],
            "images": [{"Name": "image", "PackageType": "image", "OS": "linux", "JetpackPlatform": "ubuntu-22.04"}]}


class InvalidAssertions(unittest.TestCase):
    def invalid(self, function, *args):
        with self.assertRaises(InspectionError) as caught:
            function(*args)
        self.assertEqual(caught.exception.code, "invalid_response")
        self.assertNotIn("SECRET_", str(caught.exception))


class NormalizationBoundaryTests(InvalidAssertions):
    def test_limits_defaults_and_boolean_rejection(self):
        self.assertEqual(validate_list_input({}), {"limit": 50})
        self.assertEqual(validate_cluster_input({"clusterName": " demo "}),
                         {"clusterName": "demo", "fixedNodeLimit": 50, "nodeArrayLimit": 50})
        self.assertEqual(validate_status_input({"clusterName": "demo"}),
                         {"clusterName": "demo", "nodeArrayLimit": 20, "bucketLimit": 20, "issueLimit": 20})
        for bad in [-1, 201, 1.5, True, None, "1", float("nan"), float("inf")]:
            self.invalid(normalize_cluster_list, [], bad)
        for bad in [-1, 101, True, None]:
            self.invalid(normalize_cluster_issues, [], bad)
        for bad in [-1, 201, True, None]:
            self.invalid(normalize_cluster, [{"ClusterName": "demo"}], "demo", bad, 0)
        for bad in [-1, 101, True, None]:
            self.invalid(normalize_cluster, [{"ClusterName": "demo"}], "demo", 0, bad)
        for bad in [-1, 51, True, None]:
            self.invalid(normalize_cluster_status, status(), "demo", bad, 0)
            self.invalid(normalize_cluster_status, status(), "demo", 0, bad)
        for validator in [validate_list_input, validate_cluster_input, validate_status_input]:
            self.invalid(validator, {"SECRET_unknown": "secret"})

    def test_accepted_finite_status_numbers_serialize_outside_safe_integer_range(self):
        for value in [10 ** 20, -(10 ** 20), 1e20, 1e21, 1e-7]:
            with self.subTest(value=value):
                raw = status()
                raw["nodearrays"][0]["buckets"][0]["lastCapacityFailure"] = value
                normalized = normalize_cluster_status(raw, "demo", 20, 20)
                serialized = json.loads(json_bytes(normalized))
                self.assertEqual(serialized, normalized)
        self.invalid(json_bytes, 10 ** 1000)
        self.invalid(json_bytes, -(10 ** 1000))

    def test_counts_safe_integer_range_and_aggregate_overflow(self):
        for bad in [-1, True, False, 1.5, None, "1", MAX_SAFE_INTEGER + 1, float("nan"), float("inf")]:
            self.invalid(normalize_cluster_list, [{"ClusterName": "demo", "NodeArrays": [{"Count": bad}]}], 50)
        self.assertEqual(normalize_cluster_list([
            {"ClusterName": "demo", "NodeArrays": [{"Count": MAX_SAFE_INTEGER}]}], 50)["clusters"][0]["arrayNodeCount"], MAX_SAFE_INTEGER)
        self.invalid(normalize_cluster_list, [{"ClusterName": "demo", "Nodes": [{}],
                                               "NodeArrays": [{"Count": MAX_SAFE_INTEGER}]}], 50)
        self.invalid(normalize_cluster_list, [{"ClusterName": "demo", "NodeArrays": [
            {"Count": MAX_SAFE_INTEGER}, {"Count": 1}]}], 50)

    def test_consumed_fields_are_ascii_case_insensitive_only(self):
        self.assertEqual(consumed_fields({"STATE": "ok", "ſtate": "SECRET_ignore"}, ["state"]), {"state": "ok"})
        self.invalid(consumed_fields, {"State": 1, "state": 1}, ["state"])
        self.assertEqual(consumed_fields({"Unknown": 1, "unknown": 2}, ["state"]), {})
        raw = {"MaxCount": 0, "maxCoreCount": 0, "nodearrays": []}
        self.invalid(normalize_cluster_status, raw, "demo", 20, 20)

    def test_unicode_scalars_controls_and_utf16_order(self):
        for name in ["", "\ud800", "\udfff", "SECRET_\n", "x" * 257, "😀" * 257]:
            self.invalid(normalize_cluster_list, [{"ClusterName": name}], 50)
        for name in ["😀" * 256, "雪" * 256]:
            self.assertEqual(normalize_cluster_list([{"ClusterName": name}], 50)["clusters"][0]["name"], name)
        names = ["", "😀", "a", "A", "b", "B"]
        self.assertEqual([row["name"] for row in normalize_cluster_list(
            [{"ClusterName": name} for name in names], 50)["clusters"]], ["A", "a", "B", "b", "😀", ""])
        for value in [float("inf"), float("nan"), {"value": "\ud800"}, {"\udfff": 1}, {1: "value"}]:
            self.invalid(json_bytes, value)

    def test_omitted_fields_are_not_null_and_all_rows_validate_before_limiting(self):
        for field in ["State", "Nodes", "NodeArrays"]:
            self.invalid(normalize_cluster_list, [{"ClusterName": "demo", field: None}], 50)
        self.invalid(normalize_cluster, [{"ClusterName": "demo", "NodeArrays": [{"Template": "a", "Count": 1, "CoreCount": None}]}], "demo", 0, 0)
        self.invalid(normalize_cluster_list, [{"ClusterName": "a"}, {"ClusterName": "z", "State": None}], 1)
        self.invalid(normalize_cluster, [{"ClusterName": "DEMO"}], "demo", 50, 50)
        with self.assertRaises(InspectionError) as caught:
            normalize_cluster([], "demo", 50, 50)
        self.assertEqual(caught.exception.code, "cluster_not_found")

    def test_status_global_budget_and_zero_limits_preserve_totals(self):
        raw = status(12, 50)
        result = normalize_cluster_status(raw, "demo", 50, 50)["status"]
        self.assertEqual((result["bucketTotal"], result["bucketReturned"]), (600, 500))
        self.assertEqual(result["nodeArrays"][10]["bucketReturned"], 0)
        self.assertTrue(result["nodeArrays"][10]["bucketsTruncated"])
        zero = normalize_cluster_status(raw, "demo", 0, 0)["status"]
        self.assertEqual((zero["bucketTotal"], zero["bucketReturned"], zero["nodeArrayTotal"]), (600, 0, 12))
        raw["nodearrays"][-1]["buckets"][-1]["valid"] = "true"
        self.invalid(normalize_cluster_status, raw, "demo", 0, 0)

    def test_each_status_counter_and_optional_scalar_is_validated(self):
        numeric_fields = ["maxCount", "maxCoreCount", "quotaCount", "quotaCoreCount", "consumedCoreCount",
                          "activeCount", "activeCoreCount", "availableCount", "availableCoreCount"]
        for field in numeric_fields:
            for bad in [True, None, -1, 1.5, MAX_SAFE_INTEGER + 1]:
                raw = status()
                raw["nodearrays"][0]["buckets"][0][field] = bad
                self.invalid(normalize_cluster_status, raw, "demo", 0, 0)
        for field, values in {"definition": [None, []], "invalidReason": [None, "\ud800"],
                              "lastCapacityFailure": [True, None, float("inf"), float("nan")],
                              "spotPlacementScore": [None, 1, "x" * 257]}.items():
            for bad in values:
                raw = status()
                raw["nodearrays"][0]["buckets"][0][field] = bad
                self.invalid(normalize_cluster_status, raw, "demo", 20, 20)

    def test_diagnostics_scalar_truncation_and_all_metadata(self):
        for length in [2047, 2048, 2049]:
            raw = [{"Name": "Issue", "Status": "Error", "NodeCount": 1,
                    "Message": "😀" * length, "Detail": "a\x00\x1f\x7f\x9fb", "Recommendation": ""}]
            issue = normalize_cluster_issues(raw, 20)["items"][0]
            self.assertEqual(len(issue["message"]), min(length, 2048))
            self.assertEqual(issue["textTruncated"], length > 2048)
            self.assertEqual(issue["detail"], "a    b")
            self.assertEqual(issue["recommendation"], "")
        self.assertEqual(normalize_cluster_issues([{"Status": "OK", "Message": 3}], 20)["total"], 0)
        for raw in [{"Status": "error"}, {"Status": "Error", "Name": "a", "NodeCount": True},
                    {"Status": "Error", "Name": "a", "NodeCount": 1, "Message": "\ud800"}]:
            self.invalid(normalize_cluster_issues, [raw], 0)


class ApplicationBoundaryTests(InvalidAssertions):
    def test_input_validation_defaults_paths_and_details_selection(self):
        result = validate_application_input({"clusterName": " demo ", "installPath": "/shared//apps/"})
        self.assertEqual(result, {"clusterName": "demo", "installPath": "/shared/apps", "view": "overview",
                                  "targetLimit": 10, "itemLimit": 5, "offset": 0})
        for key, values in {"targetLimit": [0, 21, True], "itemLimit": [0, 11, True], "offset": [-1, 1000001, True],
                            "targetNames": [[], ["a"] * 21, "a", [".."]], "view": ["other", None],
                            "section": ["other", None], "clusterName": ["", "..", ".", "\ud800"]}.items():
            for value in values:
                self.invalid(validate_application_input, {"clusterName": "demo", key: value})
        for targets in [None, [], ["a", "b"]]:
            value = {"clusterName": "demo", "view": "details"}
            if targets is not None:
                value["targetNames"] = targets
            self.invalid(validate_application_input, value)
        for path in ["relative", "//server/path", "/a/../b", "/a/./b", "/a\n", "/" + "x" * 1024, "\ud800"]:
            self.assertFalse(is_install_path(path))
            self.invalid(validate_application_input, {"clusterName": "demo", "installPath": path})
        self.assertTrue(is_install_path("/"))
        self.assertTrue(is_install_path("/shared//apps/"))
        self.invalid(validate_application_input, {"clusterName": "demo", "unknown": True})

    def test_overview_sections_are_rejected_before_any_client_read(self):
        for view in [None, "overview"]:
            for section in ["environment", "storage", "attachments"]:
                with self.subTest(view=view, section=section):
                    input = {"clusterName": "demo", "section": section}
                    if view is not None:
                        input["view"] = view
                    self.invalid(validate_application_input, input)
                    client = FixtureClient(client_data())
                    self.invalid(read_application_context, client, input)
                    self.assertEqual(client.calls, [])

    def test_page_budgets_actual_entry_cursors_and_end_offsets(self):
        items = ["雪" * 2500]
        self.invalid(bounded_list, items)
        page = bounded_list(["雪" * 1000] * 10, 10, 2)
        self.assertEqual((page["returned"], page["nextOffset"], page["total"]), (2, 4, 10))
        self.assertLessEqual(len(json_bytes(page["items"])), 6144)
        self.assertEqual(bounded_list([1], 5, 1), {"available": True, "items": [], "total": 1,
                         "returned": 0, "truncated": True, "offset": 1, "nextOffset": None})
        self.assertEqual(bounded_list([], 5, 1000000)["nextOffset"], None)

    def test_inheritance_and_vm_preferences_keep_order(self):
        raw = [{"Name": "n", "Template": "n", "Extends": ["z-base", "a-override"], "MachineType": ["z-vm", "a-vm"]}]
        result = normalize_application_details(raw, "/shared/apps", "environment", {})[0]
        self.assertEqual(result["bases"]["items"], ["z-base", "a-override"])
        self.assertEqual(result["machineTypes"]["items"], ["z-vm", "a-vm"])
        raw[0]["Extends"] = ["base", "BASE"]
        self.invalid(normalize_application_details, raw, "/shared/apps", "environment", {})

    def test_mount_component_coverage_and_sibling_paging(self):
        mounts = {"root": {"mountpoint": "/", "disabled": False},
                  "sibling": {"mountpoint": "/shared/appstore", "disabled": False},
                  "disabled": {"mountpoint": "/shared/apps", "disabled": True},
                  "unknown": {"mountpoint": "/shared"}, "missing": {},
                  "normalized": {"mountpoint": "/shared//apps/", "disabled": False}}
        raw = [{"Name": "n", "Template": "n", "Mounts": mounts, "Volumes": {}}]
        result = normalize_application_details(raw, "/shared/apps", "storage", {})[0]
        self.assertEqual({m["name"]: m["coversInstallPath"] for m in result["mounts"]["items"]},
                         {"root": True, "sibling": False, "disabled": False, "unknown": None, "missing": None, "normalized": True})
        page = normalize_application_details(raw, "/shared/apps", "storage", {"limit": 1, "offset": 1})[0]
        self.assertEqual(page["mounts"]["nextOffset"], 2)
        self.assertIsNone(page["volumes"]["nextOffset"])
        raw[0]["Mounts"] = None
        self.assertFalse(normalize_application_details(raw, "/shared/apps", "storage", {})[0]["mounts"]["available"])

    def test_sections_consume_only_closed_allowlists_and_return_independent_values(self):
        raw = [{"Name": "n", "Template": "n", "Mounts": "SECRET_malformed", "ClusterInitSpecs": {}}]
        self.invalid(normalize_application_details, raw, "/apps", "storage", {})
        before = copy.deepcopy(raw)
        result = normalize_application_details(raw, "/apps", "attachments", {})
        result[0]["specs"]["items"].append({"project": "changed"})
        self.assertEqual(raw, before)
        self.assertEqual(normalize_application_details(raw, "/apps", "attachments", {})[0]["specs"]["items"], [])
        self.assertNotIn("SECRET_", json.dumps(normalize_application_overview(raw)))
        for record in [{"Name": "n", "Template": "other"}, {"Name": "n", "name": "n", "Template": "n"},
                       {"Name": "n", "IsArray": "true"}]:
            self.invalid(normalize_application_overview, [record])
        self.invalid(normalize_application_overview, [{"Name": "N", "IsArray": True}, {"Name": "n", "IsArray": True}])
        self.invalid(normalize_application_parameters, [{"Name": "SECRET_password", "ParameterType": "Password", "Value": "secret"}])

    def test_simple_attachment_references_only_and_identifier_checks(self):
        for reference, expected in [("$Specs", True), ("${Specs}", True), ("$a.b-c_1", True),
                                    ("${ifThenElse(SECRET_x)}", False), ("$a/b", False), (None, False), (42, False)]:
            raw = [{"Name": "n", "Template": "n", "AttachmentReference": reference}]
            value = normalize_application_details(raw, "/apps", "attachments", {})[0]["attachment"]
            self.assertEqual(value["available"], expected)
            self.assertNotIn("SECRET_", json.dumps(value))
        for image in ["https://SECRET_host/image", "image?SECRET_key", "image#SECRET_fragment"]:
            self.invalid(normalize_application_overview, [{"Name": "n", "IsArray": True, "ImageName": image}])


class ReaderBoundaryTests(InvalidAssertions):
    def read(self, client, section="attachments", **extra):
        return read_application_context(client, {"clusterName": "demo", "view": "details", "section": section,
                                                "targetNames": ["scheduler"], **extra}, "2026-09-17T12:00:00.000Z")["context"]

    def test_selective_reads_and_missing_identity(self):
        client = FixtureClient(client_data())
        value = read_application_context(client, {"clusterName": "demo"}, "fixed")["context"]
        self.assertEqual(client.calls, [("cluster", "demo"), ("nodes", "demo", {"view": "overview"})])
        self.assertNotIn("attachmentParameters", value)
        client.calls.clear()
        self.read(client, "storage")
        self.assertEqual(client.calls[-1], ("nodes", "demo", {"view": "details", "targetName": "scheduler", "section": "storage"}))
        self.assertEqual(len(client.calls), 2)
        client.data["clusters"]["demo"] = [{"ClusterName": "other"}]
        self.invalid(self.read, client)

    def test_optional_failure_is_not_empty_and_cancellation_propagates(self):
        for method in ["get_application_nodes", "get_application_parameters", "get_image_metadata"]:
            for code in ["permission_denied", "invalid_response", "cancelled"]:
                client = FixtureClient(client_data())
                def fail(*args, **kwargs):
                    raise InspectionError(code, "Lookup failed.")
                setattr(client, method, fail)
                section = "environment" if method == "get_image_metadata" else "attachments"
                if code == "cancelled":
                    with self.assertRaises(InspectionError) as caught:
                        self.read(client, section)
                    self.assertEqual(caught.exception.code, "cancelled")
                else:
                    result = self.read(client, section)
                    evidence = result["targets"] if method == "get_application_nodes" else (
                        result["attachmentParameters"] if method == "get_application_parameters" else result["targets"]["items"][0]["platform"])
                    self.assertFalse(evidence["available"])
                    self.assertNotIn("total", evidence)

    def test_shared_use_unknown_references_remain_unavailable(self):
        data = client_data()
        data["nodes"].append({"Name": "hpc", "IsArray": True, "AttachmentReference": "${SECRET_expression()}"})
        context = self.read(FixtureClient(data))
        used_by = context["attachmentParameters"]["items"][0]["usedBy"]
        self.assertFalse(used_by["available"])
        self.assertNotIn("items", used_by)
        self.assertNotIn("SECRET_", json.dumps(context))

    def test_root_chain_limit_cycle_and_exact_parent_identity(self):
        for count, available in [(10, True), (11, False)]:
            data = client_data()
            for i in range(count):
                name = "demo" if i == 0 else "parent%d" % i
                row = {"ClusterName": name}
                if i < count - 1:
                    row["ParentName"] = "parent%d" % (i + 1)
                data["clusters"][name] = [row]
            client = FixtureClient(data)
            context = self.read(client)
            self.assertEqual(context["attachmentParameters"]["available"], available)
            self.assertEqual(sum(call[0] == "cluster" for call in client.calls), min(count, 10))
        for parent in ["demo", "DEMO"]:
            data = client_data()
            data["clusters"]["demo"][0]["ParentName"] = parent
            client = FixtureClient(data)
            self.assertFalse(self.read(client)["attachmentParameters"]["available"])
            self.assertFalse(any(call[0] == "parameters" for call in client.calls))

    def test_large_attachment_pages_have_independent_actual_entry_cursors(self):
        data = client_data()
        specs = {"p%02d:s" % i: {"Project": "p%d-" % i + "雪" * 250, "Spec": "雪" * 256,
                                  "Version": "1" * 256, "SourceLocker": "l" * 256} for i in range(30)}
        data["nodes"][0]["ClusterInitSpecs"] = specs
        data["parameters"][0]["Value"] = copy.deepcopy(specs)
        context = self.read(FixtureClient(data), itemLimit=10, offset=22)
        node_specs = context["targets"]["items"][0]["specs"]
        parameter = context["attachmentParameters"]["items"][0]
        self.assertEqual(node_specs["total"], 30)
        self.assertGreater(node_specs["returned"], 0)
        self.assertLess(node_specs["returned"], 8)
        self.assertEqual(node_specs["nextOffset"], 22 + node_specs["returned"])
        self.assertEqual(node_specs, parameter["specs"])
        self.assertIsNone(parameter["usedBy"]["nextOffset"])
        self.assertEqual(parameter["usedBy"]["items"], [])
        self.assertLessEqual(len(json_bytes(node_specs["items"])), 6144)
        self.assertLessEqual(len(json_bytes(context["targets"]["items"])), 24576)
        self.assertLessEqual(len(json_bytes(context["attachmentParameters"]["items"])), 24576)

    def test_root_lookup_cancellation_and_incorrect_identity(self):
        for mode in ["cancelled", "identity"]:
            class Client(FixtureClient):
                def get_cluster(self, name):
                    if name == "root":
                        if mode == "cancelled":
                            raise InspectionError("cancelled", "SECRET_must_not_leak")
                        return [{"ClusterName": "ROOT"}]
                    return [{"ClusterName": "demo", "ParentName": "root"}]
            client = Client(client_data())
            if mode == "cancelled":
                with self.assertRaises(InspectionError) as caught:
                    self.read(client)
                self.assertEqual(caught.exception.code, "cancelled")
                self.assertNotIn("SECRET_", str(caught.exception))
            else:
                self.assertFalse(self.read(client)["attachmentParameters"]["available"])
                self.assertFalse(any(call[0] == "parameters" for call in client.calls))

    def test_malformed_optional_data_and_shared_discovery_failure(self):
        for field in ["nodes", "parameters", "images"]:
            data = client_data()
            data[field] = {"SECRET_malformed": "response"}
            context = self.read(FixtureClient(data), "environment" if field == "images" else "attachments")
            evidence = context["targets"] if field == "nodes" else (
                context["attachmentParameters"] if field == "parameters" else context["targets"]["items"][0]["platform"])
            self.assertFalse(evidence["available"])
            self.assertNotIn("items", evidence)
            self.assertNotIn("SECRET_", json.dumps(context))
        for code in ["permission_denied", "cancelled"]:
            class Client(FixtureClient):
                def get_application_nodes(self, name, selection=None):
                    if selection["view"] == "overview":
                        raise InspectionError(code, "Lookup failed.")
                    return super().get_application_nodes(name, selection)
            client = Client(client_data())
            if code == "cancelled":
                with self.assertRaises(InspectionError) as caught:
                    self.read(client)
                self.assertEqual(caught.exception.code, "cancelled")
            else:
                context = self.read(client)
                parameter = context["attachmentParameters"]["items"][0]
                self.assertTrue(parameter["specs"]["available"])
                self.assertFalse(parameter["usedBy"]["available"])

    def test_missing_targets_and_missing_referenced_parameters_are_explicit(self):
        data = client_data()
        data["nodes"] = []
        context = self.read(FixtureClient(data))
        self.assertEqual(context["targets"]["missingRequested"], ["scheduler"])
        self.assertTrue(context["targets"]["available"])
        self.assertNotIn("attachmentParameters", context)
        data = client_data()
        data["parameters"] = []
        context = self.read(FixtureClient(data))
        self.assertTrue(context["attachmentParameters"]["available"])
        self.assertEqual(context["attachmentParameters"]["missingReferenced"], ["Specs"])

    def test_status_issue_optional_failure_and_cancelled(self):
        class Client:
            def get_cluster_status(self, name):
                return status()
            def get_cluster_issues(self, name):
                raise InspectionError(self.code, "Lookup failed.")
        client = Client()
        client.code = "permission_denied"
        result = read_cluster_status(client, {"clusterName": "demo"})
        self.assertFalse(result["status"]["issues"]["available"])
        client.code = "cancelled"
        with self.assertRaises(InspectionError) as caught:
            read_cluster_status(client, {"clusterName": "demo"})
        self.assertEqual(caught.exception.code, "cancelled")


class ImageBoundaryTests(InvalidAssertions):
    def test_exact_metadata_no_guessed_versions_and_label_conflicts(self):
        record = {"Name": "alias", "PackageType": "IMAGE", "OS": "LINUX", "JetpackPlatform": "ubuntu-22.04", "Label": "Ubuntu"}
        result = normalize_image_platform([record, {**record, "Label": "Other"}], "alias")
        self.assertEqual(result["release"], "22.04")
        self.assertFalse(result["runtimeVerified"])
        self.assertNotIn("label", result)
        for platform in ["custom-linux", "ubuntu-22x04", "ubuntu-٢٢", "Ubuntu-22.04"]:
            self.assertNotIn("release", normalize_image_platform([{**record, "JetpackPlatform": platform}], "alias"))
        self.assertFalse(normalize_image_platform([record, {**record, "OS": None}], "alias")["available"])
        self.assertFalse(normalize_image_platform([record, {**record, "JetpackPlatform": "ubuntu-24.04"}], "alias")["available"])
        for change in [{"Name": "Alias"}, {"PackageType": "application"}, {"OS": "linux", "os": "linux"},
                       {"Label": "\ud800"}, {"JetpackPlatform": "x" * 129}]:
            self.invalid(normalize_image_platform, [{**record, **change}], "alias")


if __name__ == "__main__":
    unittest.main()
