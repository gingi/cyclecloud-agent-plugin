"""Bounded requests composition, shared by CycleCloud metadata/reads and MSAL.

Deliberately send through the configured adapter, not Session.request/send:
requests resolves a redirect's next request even with allow_redirects=False,
which can consume its body unboundedly before returning to the caller.
"""
import json
from urllib.parse import unquote, urlsplit

from .body_reader import read_body
from .command import fail
from .errors import InspectionError

HTTP_BYTE_LIMIT = 8 * 1024 * 1024


def _url(value, allow_query=False, https_only=False):
    try:
        if not isinstance(value, str) or len(value) > 16384 or any(ord(c) < 33 or ord(c) == 127 for c in value) or "\\" in value:
            fail("configuration_required")
        parsed = urlsplit(value)
        if (parsed.scheme not in (("https",) if https_only else ("http", "https"))
                or not parsed.hostname or parsed.username is not None or parsed.password is not None
                or "#" in value or ("?" in value and not allow_query)):
            fail("configuration_required")
        parsed.port  # Validate malformed ports eagerly.
        # Encoded slashes inside a quoted identifier are not path separators.
        if any(unquote(part) in (".", "..") for part in parsed.path.split("/")):
            fail("configuration_required")
        return value.rstrip("/") if not allow_query else value
    except (ValueError, UnicodeError):
        fail("configuration_required")


def validate_base_url(value, https_only=False):
    return _url(value, https_only=https_only)


class NoAuth:
    """Explicit auth prevents requests' implicit netrc credential lookup."""
    def __call__(self, request):
        return request


class BoundedHTTP:
    def __init__(self, session, deadline, byte_limit=HTTP_BYTE_LIMIT, https_only=False, require_verified=False):
        self.session = session
        self.deadline = deadline
        self.byte_limit = byte_limit
        self.https_only = https_only
        self.require_verified = require_verified
        self.session.headers["Accept-Encoding"] = "identity"
        if self.session.auth is None:
            self.session.auth = NoAuth()
        # Only this privately owned session is changed. Never patch requests/MSAL.
        for adapter in self.session.adapters.values():
            from urllib3.util.retry import Retry
            adapter.max_retries = Retry(total=0, connect=0, read=0, redirect=0, status=0)

    def close(self):
        self.session.close()

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def request(self, method, url, **kwargs):
        import requests
        from requests.cookies import extract_cookies_to_jar
        from urllib3.exceptions import HTTPError as RawHTTPError, ReadTimeoutError

        _url(url, allow_query=True, https_only=self.https_only)
        if method not in ("GET", "POST") or set(kwargs) - {"params", "data", "json", "headers", "timeout", "allow_redirects"}:
            fail("unsupported_layout")
        if self.require_verified and self.session.verify is False:
            # Identity is independently verified. CycleCloud reads/metadata keep
            # the selected CLI session's explicit TLS policy without changing it.
            fail("configuration_required")
        response = None
        try:
            self.deadline.remaining()
            request = requests.Request(method, url, **{key: value for key, value in kwargs.items()
                                                       if key in ("params", "data", "json", "headers")})
            prepared = self.session.prepare_request(request)
            prepared.headers["Accept-Encoding"] = "identity"
            remaining = self.deadline.remaining()  # Auth may itself do bounded HTTP.
            settings = self.session.merge_environment_settings(prepared.url, {}, True, None, None)
            if self.require_verified and settings["verify"] is False:
                fail("configuration_required")
            timeout = (min(10, remaining), min(30, remaining))
            response = self.session.get_adapter(prepared.url).send(prepared, timeout=timeout, **settings)
            if 300 <= response.status_code < 400:
                fail("upstream_error")
            body = read_body(response, self.deadline, self.byte_limit)
            # Expose the normal requests response interface expected by MSAL,
            # but every subsequent .text/.json/.content read is already bounded.
            response._content = body
            response._content_consumed = True
            extract_cookies_to_jar(self.session.cookies, prepared, response.raw)
            if response.status_code == 429 or response.status_code >= 500:
                # MSAL otherwise raises its own body-bearing HTTPError, which an
                # auth boundary cannot reliably distinguish from a login error.
                fail("upstream_error")
            return response
        except InspectionError:
            raise
        except (requests.exceptions.Timeout, ReadTimeoutError):
            fail("timeout")
        except (requests.exceptions.RequestException, RawHTTPError):
            fail("network_error")
        except Exception:
            # Auth factories/libraries may embed tokens/URLs/bodies in exceptions.
            fail("upstream_error")
        finally:
            if response is not None:
                response.close()

    def get_json(self, url, **kwargs):
        response = self.get(url, **kwargs)
        status = response.status_code
        if status == 401:
            fail("authentication_required")
        if status == 403:
            fail("permission_denied")
        if status == 404:
            fail("cluster_not_found")
        if not 200 <= status < 300:
            fail("upstream_error")
        try:
            return json.loads(response.content.decode("utf-8-sig"),
                              parse_constant=lambda _: fail("invalid_response"))
        except (ValueError, UnicodeError, RecursionError):
            fail("invalid_response")
