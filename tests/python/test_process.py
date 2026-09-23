import os
import signal
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
from cyclecloud_agent_inspect.errors import InspectionError
from cyclecloud_agent_inspect.process import Deadline, run


class ProcessTests(unittest.TestCase):
    def test_output_and_exit(self):
        result = run([sys.executable, "-c", "import sys; print('ok'); print('err', file=sys.stderr); sys.exit(3)"], Deadline(5))
        self.assertEqual((result.returncode, result.stdout, result.stderr), (3, b"ok\n", b"err\n"))

    def test_stdout_bounded_while_running(self):
        before = time.monotonic()
        with self.assertRaises(InspectionError) as raised:
            run([sys.executable, "-c", "import os,time; os.write(1,b'x'*2000000); time.sleep(10)"], Deadline(5), stdout_limit=1000)
        self.assertEqual(raised.exception.code, "output_limit")
        self.assertLess(time.monotonic() - before, 3)

    def test_stderr_is_drained_but_bounded(self):
        result = run([sys.executable, "-c", "import os; os.write(2,b'x'*2000000); print('ok')"], Deadline(5), stderr_limit=1000)
        self.assertEqual(len(result.stderr), 1000)
        self.assertEqual(result.stdout, b"ok\n")
        self.assertTrue(result.stderr_truncated)

    def test_timeout_kills_descendants_even_when_parent_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "orphan"
            script = "import subprocess,sys; subprocess.Popen([sys.executable,'-c',%r]);" % ("import time,pathlib; time.sleep(1); pathlib.Path(%r).write_text('orphan')" % str(marker))
            with self.assertRaises(InspectionError) as raised:
                run([sys.executable, "-c", script], Deadline(.15))
            self.assertEqual(raised.exception.code, "timeout")
            time.sleep(1.1)
            self.assertFalse(marker.exists())

    def test_success_cleans_detached_output_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "orphan"
            child = "import time,pathlib; time.sleep(.8); pathlib.Path(%r).write_text('orphan')" % str(marker)
            script = "import subprocess,sys; subprocess.Popen([sys.executable,'-c',%r],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)" % child
            run([sys.executable, "-c", script], Deadline(3))
            time.sleep(1)
            self.assertFalse(marker.exists())

    def test_cumulative_deadline(self):
        deadline = Deadline(.25)
        run([sys.executable, "-c", "import time; time.sleep(.15)"], deadline)
        with self.assertRaises(InspectionError) as raised:
            run([sys.executable, "-c", "import time; time.sleep(.15)"], deadline)
        self.assertEqual(raised.exception.code, "timeout")


if __name__ == "__main__":
    unittest.main()
