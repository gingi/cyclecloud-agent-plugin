"""POSIX process supervision; one cumulative deadline, bounded live pipe reads."""
import os
import selectors
import signal
import subprocess
import time
from types import SimpleNamespace

from .command import OUTPUT_LIMIT, fail


class Deadline:
    def __init__(self, seconds=120, expires=None):
        self.expires = time.monotonic() + seconds if expires is None else expires

    def remaining(self):
        remaining = self.expires - time.monotonic()
        if remaining <= 0:
            fail("timeout")
        return remaining


def clean_environment():
    # -I is also mandatory. Removing PYTHONHOME matters before Python startup,
    # and prevents a native CLI spawning an unisolated Python with these values.
    return {key: value for key, value in os.environ.items()
            if not key.startswith("PYTHON")}


def _kill_group(child):
    # The group may still contain descendants after its leader has exited.
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


def run(argv, deadline, probe_timeout=None, stdout_limit=OUTPUT_LIMIT, stderr_limit=65536):
    local_end = min(deadline.expires, time.monotonic() + probe_timeout) if probe_timeout else deadline.expires
    deadline.remaining()
    child = None
    selector = selectors.DefaultSelector()
    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    truncated = False
    try:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, start_new_session=True, close_fds=True,
                                 env=clean_environment())
        for name in buffers:
            pipe = getattr(child, name)
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, name)
        while selector.get_map() or child.poll() is None:
            remaining = local_end - time.monotonic()
            if remaining <= 0:
                fail("timeout")
            for key, _ in selector.select(min(remaining, .1)):
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                name = key.data
                limit = stdout_limit if name == "stdout" else stderr_limit
                available = limit - len(buffers[name])
                if len(block) > available:
                    if name == "stdout":
                        fail("output_limit")
                    truncated = True
                buffers[name].extend(block[:available])
        deadline.remaining()
        return SimpleNamespace(returncode=child.returncode, stdout=bytes(buffers["stdout"]),
                               stderr=bytes(buffers["stderr"]), stderr_truncated=truncated)
    except KeyboardInterrupt:
        fail("cancelled")
    except OSError:
        fail("unsupported_layout")
    finally:
        selector.close()
        if child is not None:
            _kill_group(child)
            for pipe in (child.stdout, child.stderr):
                if pipe is not None:
                    pipe.close()
