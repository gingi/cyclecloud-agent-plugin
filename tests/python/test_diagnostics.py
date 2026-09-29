"""Portable diagnostics semantics and representative failure paths; synthetic data only."""

import copy
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))

from cyclecloud_agent_inspect import command, normalize
from cyclecloud_agent_inspect.contract import json_bytes
from cyclecloud_agent_inspect.errors import InspectionError

CORPUS = json.loads((Path(__file__).resolve().parents[1] / "fixtures/inspect/v1/node-diagnostics.json").read_text(encoding="utf-8"))


class DiagnosticClient:
    def __init__(self, overrides=None):
        self.data = copy.deepcopy(CORPUS["source"])
        self.data.update({key: value if isinstance(value, Exception) else copy.deepcopy(value)
                          for key, value in (overrides or {}).items()})
        self.calls = []

    def read(self, source, *args):
        self.calls.append((source,) + args)
        value = self.data["node" if source == "node_identity" else source]
        if isinstance(value, Exception):
            raise value
        return value

    def get_cluster(self, name):
        return self.read("cluster", name)

    def get_nodes(self, data):
        return self.read("nodes", data)

    def get_diagnostic_node(self, cluster, name):
        return self.read("node", cluster, name)

    def get_node_identity(self, cluster, name):
        return self.read("node_identity", cluster, name)

    def get_node_issues(self, cluster, node_id):
        return self.read("issues", cluster, node_id)

    def get_diagnostic_instance(self, cluster, instance_id):
        return self.read("instance", cluster, instance_id)

    def get_cluster_events(self, cluster, hours, limit):
        return self.read("events", cluster, hours, limit)

    def get_node_activity(self, node_id, hours, limit):
        return self.read("activity", node_id, hours, limit)


def execute(argv, client):
    parsed = command.parse_args(argv)
    with patch("cyclecloud_agent_inspect.diagnostic_evidence.observed_at", return_value=CORPUS["observedAt"]):
        return command.execute(parsed, client)


class DiagnosticTests(unittest.TestCase):
    def test_portable_corpus_and_input_nonmutation(self):
        for case in CORPUS["cases"]:
            with self.subTest(case=case["name"]):
                client = DiagnosticClient(case.get("overrides"))
                before = copy.deepcopy(client.data)
                result = execute(case["argv"], client)
                self.assertEqual(result, case["expected"])
                self.assertEqual(json.loads(json_bytes(result)), case["expected"])
                self.assertNotIn("SECRET_CANARY", json.dumps(result))
                self.assertEqual(client.data, before)
                self.assertEqual(client.calls[0], ("cluster", "demo"))

    def test_discovery_empty_and_no_fanout(self):
        for rows in ([], CORPUS["source"]["nodes"]):
            client = DiagnosticClient({"nodes": rows})
            page = execute(["nodes", "demo"], client)["nodes"]
            self.assertEqual(page["returned"], len(rows))
            self.assertFalse(page["truncated"])
            self.assertNotIn("total", page)
            self.assertNotIn("nextAfterNodeId", page)
            self.assertEqual([call[0] for call in client.calls], ["cluster", "nodes"])

    def test_discovery_validates_all_rows_and_cursor_boundary(self):
        valid = {"ClusterName": "demo", "Name": "compute-1", "NodeId": "b-2", "Template": "compute", "PhaseFailed": True}
        bad_fields = [
            {"ClusterName": "demo/child"}, {"IsArray": True}, {"Abstract": True}, {"IsArray": "false"},
            {"NodeId": None}, {"NodeId": "é"}, {"NodeId": "A-1"}, {"Name": "first"},
            {"Template": "other"}, {"Name": "compute"}, {"PhaseFailed": False}, {"PhaseFailed": "true"},
        ]
        first = dict(valid, NodeId="a-1", Name="first")
        for fields in bad_fields:
            client = DiagnosticClient({"nodes": [first, dict(valid, **fields)]})
            with self.subTest(fields=fields), self.assertRaises(InspectionError) as caught:
                execute(["nodes", "demo", "--node-array", "compute", "--problems-only", "--limit", "1"], client)
            self.assertEqual(caught.exception.code, "invalid_response")
        for cursor in ("b-2", "C-3"):
            with self.subTest(cursor=cursor), self.assertRaises(InspectionError):
                execute(["nodes", "demo", "--after-node-id", cursor], DiagnosticClient({"nodes": [valid]}))
        page = execute(["nodes", "demo", "--after-node-id", "A-1"], DiagnosticClient({"nodes": [valid]}))["nodes"]
        self.assertEqual(page["items"][0]["id"], "b-2")

    def test_byte_limited_discovery_advances_from_last_emitted_node(self):
        rows = [dict(CORPUS["source"]["nodes"][1], NodeId="id-%02d" % i, Name="compute-%d" % i, StatusMessage="😀" * 1024)
                for i in range(8)]
        page = execute(["nodes", "demo", "--limit", "8"], DiagnosticClient({"nodes": rows}))["nodes"]
        self.assertGreater(page["returned"], 0)
        self.assertLess(page["returned"], len(rows))
        self.assertLessEqual(len(json_bytes(page["items"])), 8192)
        self.assertEqual(page["nextAfterNodeId"], page["items"][-1]["id"])
        self.assertTrue(page["items"][0]["statusMessageTruncated"])
        last = rows[-1]
        last["IsArray"] = True
        with self.assertRaises(InspectionError):
            execute(["nodes", "demo"], DiagnosticClient({"nodes": rows}))

    def test_primary_failures_stop_before_optional_queries(self):
        variants = [([], "node_not_found"), ([dict(CORPUS["source"]["node"][0], IsArray=True)], "node_not_found"),
                    ([dict(CORPUS["source"]["node"][0], Abstract=True)], "node_not_found"),
                    ([dict(CORPUS["source"]["node"][0], ClusterName="other")], "invalid_response"),
                    ([dict(CORPUS["source"]["node"][0], Name="other")], "invalid_response"),
                    ([dict(CORPUS["source"]["node"][0], NodeId=None)], "invalid_response"),
                    ([dict(CORPUS["source"]["node"][0], IsArray="false")], "invalid_response"),
                    (CORPUS["source"]["node"] * 2, "invalid_response")]
        for rows, code in variants:
            for operation in ("node-diagnostics", "cluster-events"):
                client = DiagnosticClient({"node": rows})
                with self.subTest(code=code, operation=operation), self.assertRaises(InspectionError) as caught:
                    execute([operation, "demo", "--node-name", "compute-1"], client)
                self.assertEqual(caught.exception.code, code)
                lookup = "node" if operation == "node-diagnostics" else "node_identity"
                self.assertEqual([call[0] for call in client.calls], ["cluster", lookup])
        client = DiagnosticClient({"cluster": []})
        with self.assertRaises(InspectionError) as caught:
            execute(["nodes", "demo"], client)
        self.assertEqual(caught.exception.code, "cluster_not_found")
        self.assertEqual(client.calls, [("cluster", "demo")])

    def test_optional_failures_are_independent_but_timeout_and_cancel_are_fatal(self):
        for source, output in (("issues", "issues"), ("instance", "vm"), ("events", "clusterEvents"), ("activity", "nodeActivity")):
            operation = "cluster-events" if source in ("events", "activity") else "node-diagnostics"
            root = "events" if operation == "cluster-events" else "diagnostics"
            for code in ("permission_denied", "invalid_response", "timeout", "cancelled"):
                client = DiagnosticClient({source: InspectionError(code, "SECRET_CANARY")})
                with self.subTest(source=source, code=code):
                    argv = [operation, "demo", "--node-name", "compute-1"]
                    if code in ("timeout", "cancelled"):
                        with self.assertRaises(InspectionError) as caught:
                            execute(argv, client)
                        self.assertEqual(caught.exception.code, code)
                    else:
                        result = execute(argv, client)[root]
                        self.assertFalse(result[output]["available"])
                        self.assertEqual(result[output]["reason"], code)
                        self.assertNotIn("items", result[output])
                        self.assertNotIn("total", result[output])
                        self.assertNotIn("SECRET_CANARY", json.dumps(result))
                        other = "nodeActivity" if output == "clusterEvents" else "clusterEvents" if root == "events" else "phases"
                        self.assertTrue(result[other]["available"])

    def test_empty_missing_and_zero_limit_evidence_are_distinct(self):
        node = dict(CORPUS["source"]["node"][0], InstanceId=None, PhaseMap=None, AwaitInstallationTimeout=0)
        client = DiagnosticClient({"node": [node], "issues": []})
        result = execute(["node-diagnostics", "demo", "--node-name", "compute-1"], client)["diagnostics"]
        self.assertEqual(result["vm"]["reason"], "no_instance")
        self.assertFalse(result["phases"]["available"])
        self.assertEqual(result["issues"]["total"], 0)
        self.assertTrue(result["issues"]["available"])
        self.assertEqual(result["node"]["effectiveAwaitInstallationTimeoutMinutes"], 30)
        self.assertNotIn("instance", [call[0] for call in client.calls])
        result = execute(["node-diagnostics", "demo", "--node-name", "compute-1", "--issue-limit", "0", "--phase-limit", "0"], DiagnosticClient())["diagnostics"]
        for source, total in (("issues", 1), ("phases", 2)):
            self.assertEqual(result[source]["items"], [])
            self.assertEqual(result[source]["total"], total)
            self.assertTrue(result[source]["truncated"])

    def test_malformed_optional_evidence_is_unavailable(self):
        node = CORPUS["source"]["node"][0]
        for overrides, section in (
            ({"node": [dict(node, PhaseMap={"p": {"StartTime": "2026-02-30T00:00:00Z"}})]}, "phases"),
            ({"node": [dict(node, PhaseMap={"p": {"StartTime": "2026-09-29T01:00:00Z", "EndTime": "2026-09-29T00:00:00Z"}})]}, "phases"),
            ({"issues": [{"Name": "broken", "Status": "not-a-severity"}]}, "issues"),
            ({"instance": [dict(CORPUS["source"]["instance"][0], ClusterName="other")]}, "vm"),
        ):
            with self.subTest(section=section):
                result = execute(["node-diagnostics", "demo", "--node-name", "compute-1"], DiagnosticClient(overrides))["diagnostics"]
                self.assertFalse(result[section]["available"])
                self.assertEqual(result[section]["reason"], "invalid_response")

    def test_selected_node_events_ignore_unrelated_diagnostic_fields(self):
        argv = ["cluster-events", "demo", "--node-name", "compute-1"]
        expected = execute(argv, DiagnosticClient())
        for fields in ({"AwaitInstallationTimeout": "bad"}, {"UpdatedAt": "not-a-timestamp"},
                       {"PhaseFailed": "false"}, {"Status": [], "status": {}}, {"PhaseMap": "malformed"}):
            client = DiagnosticClient({"node": [dict(CORPUS["source"]["node"][0], **fields)]})
            with self.subTest(fields=fields):
                self.assertEqual(execute(argv, client), expected)
                self.assertEqual([call[0] for call in client.calls], ["cluster", "node_identity", "events", "activity"])
                self.assertEqual(client.calls[-1][1], CORPUS["source"]["node"][0]["NodeId"])

    def test_events_are_bounded_without_totals_and_optional_selection_has_no_lookup(self):
        client = DiagnosticClient()
        result = execute(["cluster-events", "demo", "--limit", "1"], client)["events"]
        self.assertEqual(result["nodeActivity"]["reason"], "not_requested")
        self.assertNotIn("nodeId", result)
        self.assertEqual(client.calls, [("cluster", "demo"), ("events", "demo", 3, 2)])
        self.assertEqual(result["clusterEvents"]["returned"], 1)
        self.assertTrue(result["clusterEvents"]["truncated"])
        self.assertNotIn("total", result["clusterEvents"])

    def test_diagnostic_text_bounds_and_deterministic_condition_order(self):
        issues = [{"Name": name, "Status": severity, "Description": "\n😀\\\"" * 2000}
                  for name, severity in (("z", "OK"), ("b", "Error"), ("A", "Error"))]
        result = execute(["node-diagnostics", "demo", "--node-name", "compute-1"], DiagnosticClient({"issues": issues}))["diagnostics"]
        self.assertEqual([item["name"] for item in result["issues"]["items"]], ["A", "b", "z"])
        for item in result["issues"]["items"]:
            self.assertTrue(item["textTruncated"])
            self.assertNotIn("\n", item["description"])
            self.assertLessEqual(len(item["description"]), 1024)
            self.assertLessEqual(len(json_bytes(item["description"])) - 2, 1536)

    def test_vm_resource_identities_are_exact_or_unavailable(self):
        instance = CORPUS["source"]["instance"][0]
        for key, value in (("VirtualMachineId", "vm\x00id"), ("ResourceId", "/subscriptions/x\n/y"),
                           ("VirtualMachineId", "x" * 257), ("ResourceId", "x" * 1025)):
            with self.subTest(key=key, value=value[:30]):
                client = DiagnosticClient({"instance": [dict(instance, **{key: value})]})
                result = execute(["node-diagnostics", "demo", "--node-name", "compute-1"], client)["diagnostics"]
                self.assertEqual(result["vm"], {
                    "available": False, "source": "Cloud.Instance", "reason": "invalid_response",
                    "warning": "Cloud.Instance could not be retrieved or validated; this is not evidence of health or an empty result.",
                })
                self.assertTrue(result["issues"]["available"])
                self.assertTrue(result["phases"]["available"])
        client = DiagnosticClient({"instance": [dict(instance, ResourceId="x" * 1024, VirtualMachineId="v" * 256)]})
        result = execute(["node-diagnostics", "demo", "--node-name", "compute-1"], client)["diagnostics"]["vm"]
        self.assertEqual(result["resourceId"], "x" * 1024)
        self.assertEqual(result["virtualMachineId"], "v" * 256)

    def test_backend_fractional_timestamps_and_invalid_offsets(self):
        from cyclecloud_agent_inspect.diagnostic_evidence import timestamp

        for fraction, milliseconds in (("4", "400"), ("41", "410"), ("4153043", "415")):
            for value in ("2016-06-28T22:45:54." + fraction + "+00:00",
                          {"$date": "2016-06-28T18:45:54." + fraction + "-04:00"}):
                with self.subTest(value=value):
                    self.assertEqual(timestamp(value), "2016-06-28T22:45:54." + milliseconds + "Z")
        for value in ("2026-09-15T18:00:00+00:99", "2026-09-15T18:00:00+24:00", "2026-02-30T18:00:00Z"):
            with self.subTest(value=value), self.assertRaises(InspectionError) as caught:
                timestamp(value)
            self.assertEqual(caught.exception.code, "invalid_response")
        instance = dict(CORPUS["source"]["instance"][0], ProvisioningStateTime="2016-06-28T22:45:54.4153043+00:00")
        result = execute(["node-diagnostics", "demo", "--node-name", "compute-1"], DiagnosticClient({"instance": [instance]}))["diagnostics"]
        self.assertTrue(result["vm"]["available"])
        self.assertEqual(result["vm"]["provisioningStateTime"], "2016-06-28T22:45:54.415Z")

    def test_additive_fixed_node_status_fields(self):
        result = normalize.normalize_cluster([{"ClusterName": "demo", "Nodes": [
            {"Name": "scheduler", "Status": "Failed", "StatusMessage": "failed\n" + "😀" * 3000}
        ]}], "demo")["cluster"]["fixedNodes"][0]
        self.assertEqual(result["status"], "Failed")
        self.assertTrue(result["statusMessageTruncated"])
        self.assertNotIn("\n", result["statusMessage"])
        self.assertLessEqual(len(result["statusMessage"]), 2048)
        self.assertLessEqual(len(json_bytes(result["statusMessage"])) - 2, 8192)

    def test_public_argument_defaults_and_rejections(self):
        self.assertEqual(command.parse_args(["nodes", "demo"]).input, {"clusterName": "demo", "problemsOnly": False, "limit": 20})
        for argv in (["nodes", "demo", "--offset", "1"], ["nodes", "demo", "--limit", "0"],
                     ["nodes", "demo", "--after-node-id", "é"], ["nodes", "demo", "--after-node-id", ""],
                     ["node-diagnostics", "demo"], ["node-diagnostics", "demo", "--node-name", "x", "--phase-limit", "101"],
                     ["cluster-events", "demo", "--lookback-hours", "0"]):
            with self.subTest(argv=argv), self.assertRaises(InspectionError) as caught:
                command.parse_args(argv)
            self.assertEqual(caught.exception.code, "invalid_arguments")


if __name__ == "__main__":
    unittest.main()
