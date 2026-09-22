"""Transport-independent failures with safe, non-response-derived messages."""


class InspectionError(Exception):
    """An inspection failure; callers must supply only sanitized messages."""

    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def invalid_response():
    raise InspectionError(
        "invalid_response", "CycleCloud returned a response the plugin could not safely use."
    )


def cluster_not_found():
    raise InspectionError("cluster_not_found", "CycleCloud did not return the requested cluster.")


def propagate_cancellation(error):
    if isinstance(error, InspectionError) and error.code == "cancelled":
        raise InspectionError("cancelled", "The CycleCloud request was cancelled.") from None
