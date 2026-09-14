"""Run the installer with a controlling terminal, including when its source is piped."""
import errno
import json
import os
import pty
import select
import signal
import subprocess
import sys
import time

request = json.load(sys.stdin)
if request.get("detached"):
    result = subprocess.run(
        ["/bin/sh", request["installer"]] + request.get("args", []),
        env=request["env"], stdin=subprocess.DEVNULL, capture_output=True,
        text=True, start_new_session=True, timeout=8,
    )
    print(json.dumps({"status": result.returncode, "output": result.stdout + result.stderr}))
    sys.exit(0)

pid, terminal = pty.fork()
if pid == 0:
    if request.get("piped"):
        source = os.open(request["installer"], os.O_RDONLY)
        os.dup2(source, 0)
        os.close(source)
        args = ["/bin/sh", "-s", "--"]
    else:
        args = ["/bin/sh", request["installer"]]
    os.execve(args[0], args + request.get("args", []), request["env"])

output = b""
pending = b""
steps = iter(request.get("steps", []))
step = next(steps, None)
deadline = time.monotonic() + 8
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([terminal], [], [], 0.1)
        if not ready:
            continue
        try:
            chunk = os.read(terminal, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not chunk:
            break
        output += chunk
        pending += chunk
        if step and step[0].encode() in pending:
            os.write(terminal, step[1].encode())
            pending = b""
            step = next(steps, None)
    else:
        os.killpg(pid, signal.SIGKILL)
        raise RuntimeError("Installer terminal timed out: " + output.decode(errors="replace"))
finally:
    os.close(terminal)
    _, status = os.waitpid(pid, 0)

print(json.dumps({"status": os.waitstatus_to_exitcode(status), "output": output.decode(errors="replace")}))
