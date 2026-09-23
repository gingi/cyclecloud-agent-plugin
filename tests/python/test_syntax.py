"""Syntax compatibility of shipped Python source, not a Python 3.8 runtime test."""
import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class SyntaxTests(unittest.TestCase):
    def test_shipped_python_supports_python38_syntax(self):
        sources = sorted((ROOT / "python").rglob("*.py"))
        self.assertTrue(sources, "Inspection Python source must be present")
        sources.append(ROOT / "scripts" / "inspect-bootstrap.py")
        for source in sources:
            with self.subTest(source=str(source.relative_to(ROOT))):
                ast.parse(source.read_text(encoding="utf-8"), filename=str(source), feature_version=(3, 8))


if __name__ == "__main__":
    unittest.main()
