"""Configured definitions are optional evidence, not instantiated-node groups."""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
from cyclecloud_agent_inspect import normalize
from cyclecloud_agent_inspect.context_reader import read_cluster, read_cluster_list
from cyclecloud_agent_inspect.errors import InspectionError

ROOT = Path(__file__).resolve().parents[2]
WARNING = "Configured node-array definitions could not be retrieved or validated."
MISSING = object()


class Client:
    def __init__(self, summary, definitions=MISSING, error=None):
        self.summary = summary
        self.definitions = [] if definitions is MISSING else definitions
        self.error = error
        self.calls = []

    def list_clusters(self):
        return self.summary

    def get_cluster(self, name):
        return self.summary

    def get_node_array_definitions(self, name):
        self.calls.append(name)
        if self.error:
            raise self.error
        return self.definitions

    def get_node_array_definition_counts(self, names):
        self.calls.append(names)
        if self.error:
            raise self.error
        return {name: {"available": True, "total": len(self.definitions)} for name in names}


class ArrayDefinitionTests(unittest.TestCase):
    def test_portable_extension_corpus_preserves_legacy_and_inputs(self):
        corpus = json.loads((ROOT / "tests/fixtures/inspect/v1/array-definitions.json").read_text(encoding="utf-8"))
        original = copy.deepcopy(corpus)
        for case in corpus["cases"]:
            with self.subTest(case=case["name"]):
                client = Client([case["summary"]], case["definitions"])
                detail = read_cluster(client, {"clusterName": "demo", "nodeArrayLimit": case["limit"]})["cluster"]
                self.assertEqual(detail["nodeArrayDefinitions"], case["expectedDefinitions"])
                self.assertEqual({key: detail[key] for key in case["legacy"]}, case["legacy"])
                legacy = normalize.normalize_cluster([case["summary"]], "demo", 50, case["limit"])["cluster"]
                self.assertEqual({key: detail[key] for key in legacy}, legacy)
                summary = read_cluster_list(client)["clusters"][0]
                self.assertEqual(summary["nodeArrayDefinitions"], {"available": True, "total": case["expectedDefinitions"]["total"]})
                self.assertEqual(summary["nodeArrayCount"], case["legacy"]["nodeArrayTotal"])
                for row in (summary, detail):
                    self.assertEqual(row["nodeArraySummarySemantics"], "instantiated-node-groups")
                    self.assertNotIn("SECRET_", json.dumps(row))
        self.assertEqual(corpus, original)

    def test_detail_rejects_invalid_rows_even_beyond_limit(self):
        valid = {"ClusterName": "demo", "Name": "a"}
        malformed = [
            None, {}, [valid, valid], [dict(valid, ClusterName="other")],
            [dict(valid, Name="")], [dict(valid, Name="x" * 257)],
            [dict(valid, State=False)], [dict(valid, State=42)], [dict(valid, name="duplicate-case-key")],
            [dict(valid, ClusterName=None)], [dict(valid, Name=None)],
            [valid, {"ClusterName": "demo", "Name": "z", "TargetState": []}],
        ]
        for raw in malformed:
            with self.subTest(raw=raw):
                result = read_cluster(Client([{"ClusterName": "demo"}], raw), {"clusterName": "demo", "nodeArrayLimit": 0})
                self.assertEqual(result["cluster"]["nodeArrayDefinitions"], {"available": False, "warning": WARNING})

    def test_grouped_counts_validate_full_batch_and_fill_only_successful_missing_rows(self):
        normalize_counts = normalize.normalize_node_array_definition_counts
        self.assertEqual(normalize_counts([], ["a"]), {"a": {"available": True, "total": 0}})
        self.assertEqual(normalize_counts([{"clustername": "a", "count": 6, "Secret": "SECRET_CANARY"}], ["a", "b"]), {
            "a": {"available": True, "total": 6}, "b": {"available": True, "total": 0},
        })
        row = {"ClusterName": "a", "Count": 1}
        malformed = [None, {}, [row, row], [dict(row, ClusterName="A")], [{"ClusterName": "a"}]]
        malformed += [[dict(row, Count=count)] for count in (-1, True, 1.5, 9007199254740992, "6")]
        for raw in malformed:
            with self.subTest(raw=raw), self.assertRaises(InspectionError) as raised:
                normalize_counts(raw, ["a"])
            self.assertEqual(raised.exception.code, "invalid_response")

    def test_detail_names_are_exact_unique_and_use_shared_sort_order(self):
        rows = [{"ClusterName": "demo", "Name": name} for name in ("b", "a", "A")]
        result = normalize.normalize_node_array_definitions(rows, "demo")
        self.assertEqual([item["name"] for item in result["items"]], ["A", "a", "b"])

    def test_list_enriches_only_returned_names_and_skips_empty_list(self):
        client = Client([{"ClusterName": "z"}, {"ClusterName": "a"}])
        result = read_cluster_list(client, {"limit": 1})
        self.assertEqual(client.calls, [["a"]])
        self.assertEqual(result["total"], 2)
        client = Client([])
        self.assertEqual(read_cluster_list(client)["clusters"], [])
        self.assertEqual(client.calls, [])

    def test_primary_failure_prevents_optional_queries(self):
        for raw in ([], [{"ClusterName": "other"}], [{"ClusterName": "demo", "NodeArrays": [{}]}]):
            client = Client(raw)
            with self.subTest(raw=raw), self.assertRaises(InspectionError):
                read_cluster(client, {"clusterName": "demo"})
            self.assertEqual(client.calls, [])
        client = Client([{}])
        with self.assertRaises(InspectionError):
            read_cluster_list(client)
        self.assertEqual(client.calls, [])

    def test_optional_failures_are_sanitized_but_timeout_and_cancellation_propagate(self):
        for reader, argument, key in ((read_cluster, {"clusterName": "demo"}, "cluster"), (read_cluster_list, {}, "clusters")):
            for code in ("permission_denied", "invalid_response", "timeout", "cancelled"):
                client = Client([{"ClusterName": "demo"}], error=InspectionError(code, "SECRET_CANARY"))
                with self.subTest(reader=key, code=code):
                    if code in ("timeout", "cancelled"):
                        with self.assertRaises(InspectionError) as raised:
                            reader(client, argument)
                        self.assertEqual(raised.exception.code, code)
                    else:
                        result = reader(client, argument)[key]
                        row = result[0] if key == "clusters" else result
                        self.assertEqual(row["nodeArrayDefinitions"], {"available": False, "warning": WARNING})


if __name__ == "__main__":
    unittest.main()
