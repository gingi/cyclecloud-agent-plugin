"""Isolated entrypoint: controlled plugin import path, no pip/Node dependency."""
import os
from pathlib import Path
import sys

# -I deliberately removes the script directory from sys.path. Add only the
# installed-relative plugin implementation, never CWD or caller Python paths.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        from cyclecloud_agent_inspect.worker import main
        raise SystemExit(main(sys.argv[2], sys.argv[3:]))
    from cyclecloud_agent_inspect.launcher import main
    raise SystemExit(main(sys.argv[1], sys.argv[2:]))
