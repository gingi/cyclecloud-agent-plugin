import gzip
import json
import os
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch
from types import SimpleNamespace
from urllib.parse import quote as urlquote

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
from cyclecloud_agent_inspect.adapter import CycleCloudAdapter
from cyclecloud_agent_inspect.errors import InspectionError
from cyclecloud_agent_inspect.process import Deadline, run
from cyclecloud_agent_inspect.transport import BoundedHTTP, validate_base_url

try:
    import requests
except ImportError:
    requests = None


class Handler(BaseHTTPRequestHandler):
    hits = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.hits.append((self.path, dict(self.headers)))
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/should-not-follow?secret-canary")
            self.send_header("Content-Length", "999999999")
            self.end_headers()
            return
        if self.path == "/drip":
            self.send_response(200)
            self.send_header("Content-Length", "100")
            self.end_headers()
            try:
                for _ in range(100):
                    self.wfile.write(b" ")
                    self.wfile.flush()
                    time.sleep(.05)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        body = b'{"ok":true}'
        status = 200
        if self.path.startswith("/large"):
            body = b"x" * 100000
        if self.path == "/error":
            body = b"secret-canary" * 10000
            status = 500
        if self.path == "/service-unavailable":
            body = b"secret-canary"
            status = 503
        if self.path == "/throttled":
            body = b"secret-canary"
            status = 429
        if self.path == "/unauthorized":
            body = b"secret-canary"
            status = 401
        if self.path == "/forbidden":
            status = 403
        if self.path == "/gzip":
            body = gzip.compress(b"x" * 100000)
        if self.path == "/invalid":
            body = b"secret-canary"
        self.send_response(status)
        if self.path == "/gzip":
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@unittest.skipUnless(requests, "Run with the bundled CLI Python to exercise requests")
class TransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:%d" % cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.session = requests.Session()
        self.http = BoundedHTTP(self.session, Deadline(5), byte_limit=2048)
        self.addCleanup(self.http.close)

    def test_json_and_explicit_stream_bound(self):
        self.assertEqual(self.http.get_json(self.base + "/ok"), {"ok": True})
        for path in ("/large", "/gzip", "/error"):
            with self.subTest(path=path), self.assertRaises(InspectionError) as raised:
                self.http.get_json(self.base + path)
            self.assertEqual(raised.exception.code, "invalid_response")
            self.assertNotIn("secret-canary", str(raised.exception))

    def test_raw_gzip_path_never_uses_urllib3_implicit_decompression(self):
        adapter = self.session.get_adapter(self.base)
        for payload, success in ((b'{"ok":true}', True), (b"x" * 65536, False)):
            reply = requests.Response()
            reply.status_code = 200
            reply.headers["Content-Encoding"] = "gzip"
            reply.raw = SimpleNamespace(stream=Mock(return_value=iter([gzip.compress(payload)])),
                                        close=Mock(), release_conn=Mock(), _original_response=None)
            reply.iter_content = Mock(side_effect=AssertionError("Unbounded old urllib3 decoder must never run"))
            with patch.object(adapter, "send", return_value=reply):
                if success:
                    self.assertEqual(self.http.get_json(self.base + "/ok"), {"ok": True})
                else:
                    with self.assertRaises(InspectionError) as raised:
                        self.http.get_json(self.base + "/ok")
                    self.assertEqual(raised.exception.code, "invalid_response")
            reply.iter_content.assert_not_called()
            reply.raw.stream.assert_called_once_with(65536, decode_content=False)

    def test_both_owned_session_kinds_request_identity_encoding(self):
        identity = BoundedHTTP(requests.Session(), Deadline(2), require_verified=True)
        self.addCleanup(identity.close)
        for http in (self.http, identity):
            self.assertEqual(http.session.headers["Accept-Encoding"], "identity")
            http.get_json(self.base + "/ok", headers={"Accept-Encoding": "gzip"})
            self.assertEqual(Handler.hits[-1][1]["Accept-Encoding"], "identity")

    def test_raw_stream_errors_are_sanitized(self):
        from urllib3.exceptions import ProtocolError, ReadTimeoutError
        adapter = self.session.get_adapter(self.base)
        for error, code in ((ProtocolError("secret-canary"), "network_error"),
                            (ReadTimeoutError(None, "secret-canary", "secret-canary"), "timeout")):
            reply = requests.Response()
            reply.status_code = 200
            reply.raw = SimpleNamespace(stream=Mock(side_effect=error), close=Mock(), release_conn=Mock(), _original_response=None)
            reply.iter_content = Mock(side_effect=AssertionError("Unbounded decoder"))
            with patch.object(adapter, "send", return_value=reply), self.assertRaises(InspectionError) as raised:
                self.http.get_json(self.base + "/ok")
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn("secret-canary", str(raised.exception))
            reply.iter_content.assert_not_called()

    def test_fixed_endpoint_preserves_encoded_slashes_in_cluster_name(self):
        adapter = CycleCloudAdapter.__new__(CycleCloudAdapter)
        adapter.base_url = self.base + "/prefix"
        adapter.http = self.http
        adapter.urlquote = lambda value: urlquote(value, safe="")
        self.assertEqual(adapter.get_cluster("a/../b"), {"ok": True})
        self.assertEqual(Handler.hits[-1][0], "/prefix/cloud/api/clusters/a%2F..%2Fb?summary=true&cloud_instances=true")

    def test_redirect_does_not_read_huge_body_or_follow(self):
        before = time.monotonic()
        with self.assertRaises(InspectionError) as raised:
            self.http.get_json(self.base + "/redirect")
        self.assertEqual(raised.exception.code, "upstream_error")
        self.assertLess(time.monotonic() - before, 1)
        self.assertFalse(any("should-not-follow" in path for path, _ in Handler.hits))

    def test_status_errors_and_bad_json_are_redacted(self):
        for path, code in (("/unauthorized", "authentication_required"), ("/forbidden", "permission_denied"), ("/invalid", "invalid_response")):
            with self.subTest(path=path), self.assertRaises(InspectionError) as raised:
                self.http.get_json(self.base + path)
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn("secret-canary", str(raised.exception))

    def test_identity_service_errors_are_not_reported_as_login_failure(self):
        for path in ("/service-unavailable", "/throttled"):
            with self.subTest(path=path), self.assertRaises(InspectionError) as raised:
                self.http.get(self.base + path)
            self.assertEqual(raised.exception.code, "upstream_error")
            self.assertNotIn("secret-canary", str(raised.exception))

    def test_identity_never_inherits_basic_or_netrc_auth(self):
        with patch("requests.sessions.get_netrc_auth", side_effect=AssertionError("netrc must not be consulted")):
            self.http.get_json(self.base + "/ok")
        self.assertNotIn("Authorization", Handler.hits[-1][1])

    def test_cyclecloud_inherits_verification_policy_without_changing_it(self):
        adapter = self.session.get_adapter(self.base)
        for verification in (True, False, "/explicit/cli-ca.pem"):
            self.session.verify = verification
            with self.subTest(verification=verification), patch.dict(os.environ, {"REQUESTS_CA_BUNDLE": "", "CURL_CA_BUNDLE": ""}), patch.object(adapter, "send", wraps=adapter.send) as send:
                self.assertEqual(self.http.get_json(self.base + "/ok"), {"ok": True})
                self.assertEqual(send.call_args.kwargs["verify"], verification)
                self.assertEqual(self.session.verify, verification)

    def test_identity_verification_cannot_be_disabled(self):
        identity = BoundedHTTP(requests.Session(), Deadline(2), require_verified=True)
        self.addCleanup(identity.close)
        self.assertIs(identity.session.verify, True)
        identity.session.verify = False
        with self.assertRaises(InspectionError) as raised:
            identity.get(self.base + "/ok")
        self.assertEqual(raised.exception.code, "configuration_required")
        self.assertIs(identity.session.verify, False)  # Reject; never change policy.

    def test_verified_identity_transport_rejects_plain_http(self):
        identity = BoundedHTTP(requests.Session(), Deadline(2), https_only=True)
        self.addCleanup(identity.close)
        with self.assertRaises(InspectionError) as raised:
            identity.post(self.base + "/token", data={"client_secret": "fake-secret"})
        self.assertEqual(raised.exception.code, "configuration_required")

    def test_supervision_bounds_slow_drip_despite_idle_timeout(self):
        source = ("import sys,requests; sys.path.insert(0,%r); "
                  "from cyclecloud_agent_inspect.transport import BoundedHTTP; "
                  "from cyclecloud_agent_inspect.process import Deadline; "
                  "BoundedHTTP(requests.Session(),Deadline(120)).get(%r)") % (
                      str(Path(__file__).resolve().parents[2] / "python"), self.base + "/drip")
        before = time.monotonic()
        with self.assertRaises(InspectionError) as raised:
            run([sys.executable, "-I", "-B", "-c", source], Deadline(.5))
        self.assertEqual(raised.exception.code, "timeout")
        self.assertLess(time.monotonic() - before, 2)

    def test_environment_ca_and_proxy_are_not_dropped(self):
        with patch.dict(os.environ, {"REQUESTS_CA_BUNDLE": "/explicit/test-ca.pem", "HTTPS_PROXY": "http://proxy.example:1234", "NO_PROXY": ""}):
            settings = self.session.merge_environment_settings("https://identity.example/", {}, True, None, None)
        self.assertEqual(settings["verify"], "/explicit/test-ca.pem")
        self.assertEqual(settings["proxies"]["https"], "http://proxy.example:1234")

    def test_timeout_stream_and_proxy_ca_settings_preserved(self):
        adapter = self.session.get_adapter(self.base)
        original = adapter.send
        with patch.object(adapter, "send", wraps=original) as send:
            self.http.get_json(self.base + "/ok")
        options = send.call_args.kwargs
        self.assertTrue(options["stream"])
        self.assertLessEqual(options["timeout"][0], 10)
        self.assertLessEqual(options["timeout"][1], 30)
        self.assertTrue(options["verify"])


class URLTests(unittest.TestCase):
    def test_literal_and_encoded_dot_segments_in_configuration_are_rejected(self):
        for segment in (".", "..", "%2e", "%2E%2e", ".%2e", "%2e."):
            with self.subTest(segment=segment), self.assertRaises(InspectionError) as raised:
                validate_base_url("https://server.example/prefix/" + segment + "/endpoint")
            self.assertEqual(raised.exception.code, "configuration_required")

    def test_prefix_preserved_and_invalid_bases_rejected(self):
        self.assertEqual(validate_base_url("https://server.example/prefix/"), "https://server.example/prefix")
        for value in ("ftp://server", "https://user:secret@server", "https://server/?token=secret", "https://server/?", "https://server/#secret", "https://server/#", "https://", "https://server\n", "https://server:bad", "https://server/../oops"):
            with self.subTest(value=value), self.assertRaises(InspectionError):
                validate_base_url(value)


if __name__ == "__main__":
    unittest.main()
