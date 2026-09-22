"""Supervised compatibility worker; dependency stdout/stderr is never public."""
import logging
import os
import sys

from . import command
from .errors import InspectionError
from .process import Deadline


def main(expires, argv):
    name = argv[0] if argv and argv[0] in command.COMMANDS else "inspect"
    # Keep a private output descriptor and discard dependency output at the OS
    # level (also covers C extensions and accidental direct os.write calls).
    output_fd = os.dup(sys.stdout.fileno())
    os.set_inheritable(output_fd, False)
    null = os.open(os.devnull, os.O_RDWR)
    os.dup2(null, 0)
    os.dup2(null, 1)
    os.dup2(null, 2)
    os.close(null)
    logging.disable(logging.CRITICAL)
    adapter = None
    try:
        parsed = command.parse_args(argv)
        deadline = Deadline(expires=float(expires))
        deadline.remaining()
        from .adapter import CycleCloudAdapter
        adapter = CycleCloudAdapter(parsed.config, deadline)
        payload = command.execute(parsed, adapter)
        deadline.remaining()
        value = command.envelope(parsed.command, result=payload)
    except KeyboardInterrupt:
        value = command.envelope(name, error=InspectionError("cancelled", ""))
    except (ImportError, AttributeError):
        value = command.envelope(name, error=InspectionError("unsupported_layout", ""))
    except Exception as error:
        value = command.envelope(name, error=error)
    finally:
        if adapter is not None:
            adapter.close()
    try:
        output = command.encode(value)
    except InspectionError as error:
        value = command.envelope(name, error=error)
        output = command.encode(value)
    with os.fdopen(output_fd, "wb") as destination:
        destination.write(output)
    return command.exit_code(value)
