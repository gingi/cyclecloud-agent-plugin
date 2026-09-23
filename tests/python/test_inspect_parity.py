"""Language-neutral golden parity against TypeScript source 4c1c511."""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

from cyclecloud_agent_inspect import application_context, normalize
from cyclecloud_agent_inspect.context_reader import read_application_context
from cyclecloud_agent_inspect.contract import json_bytes
from cyclecloud_agent_inspect.errors import InspectionError
from cyclecloud_agent_inspect.image_platform import normalize_image_platform


class FixtureClient:
    def __init__(self, data):
        self.data = data
        self.calls = []

    def get_cluster(self, name):
        self.calls.append(("cluster", name))
        return self.data["clusters"].get(name, [])

    def get_application_nodes(self, name, selection=None):
        self.calls.append(("nodes", name, selection))
        if self.data.get("nodeError"):
            raise InspectionError(self.data["nodeError"], "Fixture lookup failed.")
        nodes = self.data["nodes"]
        if selection and selection["view"] == "details":
            return [node for node in nodes if node.get("Name") == selection["targetName"]]
        return nodes

    def get_application_parameters(self, name, parameter_name=None):
        self.calls.append(("parameters", name, parameter_name))
        return self.data["parameters"]

    def get_image_metadata(self, image):
        self.calls.append(("image", image))
        return self.data["images"]


class PortableParityTests(unittest.TestCase):
    def test_golden_corpus(self):
        corpus = json.loads((ROOT / "tests/fixtures/inspect/v1/parity.json").read_text(encoding="utf-8"))
        self.assertEqual(corpus["provenance"]["sourceCommit"], "4c1c511")
        self.assertGreaterEqual(len(corpus["cases"]), 40)
        for case in corpus["cases"]:
            with self.subTest(case=case["name"]):
                args = case["args"]
                operation = case["operation"]
                if operation == "read_application_context":
                    function = read_application_context
                    args = [FixtureClient(args[0])] + args[1:]
                elif operation == "normalize_image_platform":
                    function = normalize_image_platform
                elif hasattr(normalize, operation):
                    function = getattr(normalize, operation)
                else:
                    function = getattr(application_context, operation)
                if "error" in case:
                    with self.assertRaises(InspectionError) as caught:
                        function(*args)
                    self.assertEqual(caught.exception.code, case["error"])
                else:
                    actual = function(*args)
                    self.assertEqual(actual, case["expected"])
                    self.assertEqual(json.loads(json_bytes(actual)), case["expected"])
                    self.assertNotIn("SECRET_", json.dumps(actual, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
