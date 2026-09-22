"""Adapter seam tests use fakes, never user credentials or interactive login."""
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, quote as urlquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
from cyclecloud_agent_inspect.adapter import CycleCloudAdapter, _make_auth, PROJECTIONS
from cyclecloud_agent_inspect.errors import InspectionError
from cyclecloud_agent_inspect.process import Deadline

try:
    import requests
except ImportError:
    requests = None


class Config:
    def __init__(self, option="msal_public_client", **values):
        self.values = {"url": "https://cc.example/prefix", "auth_option": option, **values}
        self.persist = Mock()
        self.writes = []

    def get(self, section, key, fallback=None):
        return self.values.get(key, fallback)

    def set(self, section, key, value):
        self.writes.append((section, key, value))
        self.values[key] = value

    def to_dict(self):
        return dict(self.values)


class Cache:
    def __init__(self, config):
        self.config = config
        self.persist = Mock(side_effect=lambda: config.set("cycleserver", "msal_token_cache", "normal-cache"))


class BaseAuth:
    def __init__(self, *args, **kwargs):
        raise AssertionError("Unbounded installed constructor must not run")

    def __call__(self, request):
        if self.auth_option == "msal_public_client":
            token = self.get_access_token_with_cached_account_for_public_client()
        elif self.auth_option == "msal_manged_identity_client":
            token = self.msal_client.acquire_token_for_client(resource="api://" + self.client_id)
        else:
            token = self.msal_client.acquire_token_for_client(self.scopes)
        if not token or "access_token" not in token:
            raise ValueError("secret-canary")
        self.token_cache.persist()
        self.config.persist()
        request.headers["Authorization"] = token["token_type"] + " " + token["access_token"]
        return request

    def _cache_account(self, token):
        if "id_token_claims" in token:
            self.config.set("cycleserver", "msal_username", token["id_token_claims"]["preferred_username"])


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.cli = types.ModuleType("cyclecli")
        self.cli.OPTION_USERNAME_PASSWORD = "username_password"
        self.cli.OPTION_MSAL_PUBLIC_CLIENT = "msal_public_client"
        self.cli.OPTION_MSAL_CONFIDENTIAL_CLIENT = "msal_confidential_client"
        self.cli.OPTION_MSAL_MANAGED_ID_CLIENT = "msal_manged_identity_client"
        self.cli.CycleServerSection = types.SimpleNamespace(find_section_name=lambda config: "cycleserver")
        self.installed = types.ModuleType("cyclecli.auth")
        self.installed.CycleCLIMSALAuth = BaseAuth
        self.installed.CycleCLIMSALTokenCache = Cache
        self.client = Mock()
        self.client.get_accounts.return_value = [{"username": "fake-account"}]
        self.client.acquire_token_silent_with_error.return_value = {"access_token": "secret-canary", "token_type": "Bearer", "id_token_claims": {"preferred_username": "fake-account"}}
        self.client.acquire_token_for_client.return_value = {"access_token": "secret-canary", "token_type": "Bearer"}
        for method in ("acquire_token_interactive", "initiate_device_flow", "acquire_token_by_device_flow"):
            getattr(self.client, method).side_effect = AssertionError("Interactive auth must never run")
        for name in ("PublicClientApplication", "ManagedIdentityClient", "ServicePrincipalCredential"):
            setattr(self.installed, name, Mock(return_value=self.client))
        self.installed.UserAssignedManagedIdentity = Mock(return_value={"id": "user"})
        self.installed.SystemAssignedManagedIdentity = Mock(return_value={"id": "system"})
        self.installed.ServicePrincipalAuth = Mock()
        self.cli.auth = self.installed
        self.modules = patch.dict(sys.modules, {"cyclecli": self.cli, "cyclecli.auth": self.installed})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.metadata = Mock()
        self.metadata.get_json.return_value = {"entra": {"enabled": True, "clientId": "server-client", "tenantId": "server-tenant", "endpoint": "https://login.example"}}
        self.identity = Mock()

    def auth(self, config=None):
        return _make_auth(config or Config(), self.metadata, self.identity, "https://cc.example/prefix")

    def test_public_is_silent_and_persists_only_normal_cache(self):
        config = Config(**{"use-device-code": True, "msal_username": "fake-account"})
        auth = self.auth(config)
        request = types.SimpleNamespace(headers={})
        auth(request)
        self.assertEqual(request.headers["Authorization"], "Bearer secret-canary")
        self.client.acquire_token_silent_with_error.assert_called_once_with(scopes=["api://server-client/user_access"], account={"username": "fake-account"})
        config.persist.assert_called_once_with()
        self.assertEqual({key for _, key, _ in config.writes}, {"msal_token_cache", "msal_username"})
        for method in ("acquire_token_interactive", "initiate_device_flow", "acquire_token_by_device_flow"):
            getattr(self.client, method).assert_not_called()
        self.metadata.get_json.assert_called_once_with("https://cc.example/prefix/ui/metadata")
        self.assertIs(self.installed.PublicClientApplication.call_args.kwargs["http_client"], self.identity)

    def test_absent_or_expired_public_login_never_interacts_or_persists(self):
        for accounts, token in (([], None), ([{}], None), ([{}], {"error": "secret-canary"})):
            config = Config(**{"use-device-code": True})
            self.client.get_accounts.return_value = accounts
            self.client.acquire_token_silent_with_error.return_value = token
            auth = self.auth(config)
            with self.assertRaises(InspectionError) as raised:
                auth(types.SimpleNamespace(headers={}))
            self.assertEqual(raised.exception.code, "authentication_required")
            self.assertNotIn("secret-canary", str(raised.exception))
            config.persist.assert_not_called()
        self.client.acquire_token_interactive.assert_not_called()
        self.client.initiate_device_flow.assert_not_called()

    def test_confidential_secret_certificate_and_federated_factories(self):
        for values in ({"msal_secret_or_certificate": "fake-secret"},
                       {"msal_secret_or_certificate": "/fake/cert.pem", "msal_use_cert_sn_issuer": True},
                       {"msal_federated_token": "fake-federated-token"}):
            config = Config("msal_confidential_client", msal_client_id="client", msal_tenant_id="tenant", **values)
            auth = self.auth(config)
            auth(types.SimpleNamespace(headers={}))
            args = self.installed.ServicePrincipalAuth.build_credential.call_args.kwargs
            self.assertEqual(args["secret_or_certificate"], values.get("msal_secret_or_certificate"))
            self.assertEqual(args["client_assertion"], values.get("msal_federated_token"))
            self.assertEqual(args["use_cert_sn_issuer"], values.get("msal_use_cert_sn_issuer", False))
            factory = self.installed.ServicePrincipalCredential.call_args.kwargs
            self.assertIs(factory["http_client"], self.identity)
            self.assertEqual(factory["authority"], "https://login.example/tenant")
            config.persist.assert_called_once_with()

    def test_managed_identity_constant_and_all_selectors(self):
        for selector in (None, "client_id", "object_id", "resource_id"):
            config = Config(self.cli.OPTION_MSAL_MANAGED_ID_CLIENT, **({"msal_" + selector: "fake-id"} if selector else {}))
            auth = self.auth(config)
            auth(types.SimpleNamespace(headers={}))
            if selector:
                self.installed.UserAssignedManagedIdentity.assert_called_with(**{selector: "fake-id"})
            else:
                self.installed.SystemAssignedManagedIdentity.assert_called_with()
            self.assertIs(self.installed.ManagedIdentityClient.call_args.kwargs["http_client"], self.identity)
            self.client.acquire_token_for_client.assert_called_with(resource="api://server-client")

    def test_managed_identity_multiple_selectors_rejected(self):
        with self.assertRaises(InspectionError) as raised:
            self.auth(Config(self.cli.OPTION_MSAL_MANAGED_ID_CLIENT, msal_client_id="a", msal_object_id="b"))
        self.assertEqual(raised.exception.code, "configuration_required")

    def test_unknown_auth_and_insecure_authority_rejected(self):
        with self.assertRaises(InspectionError) as raised:
            self.auth(Config("unknown-secret-canary"))
        self.assertEqual(raised.exception.code, "unsupported_authentication")
        self.metadata.get_json.return_value["entra"]["endpoint"] = "http://login.example"
        with self.assertRaises(InspectionError) as raised:
            self.auth()
        self.assertEqual(raised.exception.code, "configuration_required")

    def test_bounded_metadata_errors_propagate_sanitized(self):
        for code in ("timeout", "network_error", "cancelled", "invalid_response"):
            self.metadata.get_json.side_effect = InspectionError(code, "safe")
            with self.assertRaises(InspectionError) as raised:
                self.auth()
            self.assertEqual(raised.exception.code, code)

    @unittest.skipUnless(requests, "Run with the bundled CLI Python to exercise requests")
    def test_configured_cyclecloud_verification_is_not_inherited_by_identity(self):
        config = Config("msal_public_client", verify_certificates=False)
        config_module = types.ModuleType("cyclecloud.config")
        config_module.CycleCloudConfig = Mock(return_value=config)
        util = types.ModuleType("cyclecloud.util")
        util.urlquote = lambda value: urlquote(value, safe="")
        expressions = types.ModuleType("cyclecli.expressions")
        expressions.quote = json.dumps
        session = requests.Session()
        session.verify = False
        self.cli._get_session = Mock(return_value=session)
        with patch.dict(sys.modules, {"cyclecloud.config": config_module, "cyclecloud.util": util, "cyclecli.expressions": expressions}), patch("cyclecloud_agent_inspect.adapter._make_auth") as auth:
            adapter = CycleCloudAdapter("/explicit/fake-config", Deadline(2))
            self.addCleanup(adapter.close)
            self.assertIs(adapter.http.session, session)
            self.assertIs(session.verify, False)
            self.assertIs(adapter.identity_http.session.verify, True)
            self.assertTrue(adapter.identity_http.require_verified)
            self.assertIsNot(adapter.identity_http.session, session)
            self.assertIs(auth.call_args.args[1], adapter.http)
            self.assertIs(auth.call_args.args[2], adapter.identity_http)
            config.persist.assert_not_called()

    @unittest.skipUnless(requests, "Run with the bundled CLI Python to exercise requests")
    def test_basic_adapter_uses_raw_session_seam_and_never_msal(self):
        config_module = types.ModuleType("cyclecloud.config")
        config_module.CycleCloudConfig = Mock(return_value=Config("username_password", username="fake-user", password="secret-canary"))
        util = types.ModuleType("cyclecloud.util")
        util.urlquote = lambda value: urlquote(value, safe="")
        expressions = types.ModuleType("cyclecli.expressions")
        expressions.quote = json.dumps
        session = requests.Session()
        self.cli._get_session = Mock(return_value=session)
        with patch.dict(sys.modules, {"cyclecloud.config": config_module, "cyclecloud.util": util, "cyclecli.expressions": expressions}):
            adapter = CycleCloudAdapter("/explicit/fake-config", Deadline(2))
            self.addCleanup(adapter.close)
            self.cli._get_session.assert_called_once_with(adapter.config, skip_auth=True)
            self.assertEqual(session.auth.username, "fake-user")
            self.assertEqual(session.auth.password, "secret-canary")
            self.assertIsNone(adapter.identity_http)
            self.installed.PublicClientApplication.assert_not_called()
            config_module.CycleCloudConfig.assert_called_once_with(config_file="/explicit/fake-config")


class QueryTests(unittest.TestCase):
    def setUp(self):
        self.adapter = CycleCloudAdapter.__new__(CycleCloudAdapter)
        self.adapter.http = Mock()
        self.adapter.base_url = "https://cc.example/prefix"
        self.adapter.urlquote = Mock(side_effect=lambda value: urlquote(value, safe=""))
        self.adapter.quote = Mock(side_effect=json.dumps)

    def query(self):
        url = self.adapter.http.get_json.call_args.args[0]
        self.assertTrue(url.startswith("https://cc.example/prefix/exec/query/"))
        self.assertEqual(self.adapter.http.get_json.call_args.kwargs["headers"], {"Accept": "*/*"})
        return parse_qs(urlsplit(url).query)["q"][0]

    def test_names_are_quoted_not_interpolated(self):
        name = 'c" \\ && Secret === true / ? # é'
        self.adapter.get_cluster(name)
        self.assertIn("/prefix/cloud/api/clusters/" + urlquote(name, safe=""), self.adapter.http.get_json.call_args.args[0])
        self.adapter.get_cluster_issues(name)
        self.assertTrue(self.query().endswith(json.dumps(name)))
        self.adapter.quote.assert_called_with(name)
        self.adapter.get_cluster_status(name)
        self.assertTrue(self.adapter.http.get_json.call_args.args[0].endswith("/status?nodes=false"))

    def test_only_fixed_projected_queries(self):
        for section in ("environment", "storage", "attachments"):
            self.adapter.get_application_nodes("c", {"view": "details", "section": section, "targetName": 'n"'})
            query = self.query()
            self.assertIn(PROJECTIONS[section], query)
            self.assertIn('&& Abstract =!= true && Name === "n\\\""', query)
            self.assertNotIn("select *", query)
        self.adapter.get_application_nodes("c")
        self.assertIn(PROJECTIONS["overview"], self.query())
        self.adapter.get_application_parameters("c", 'p"')
        self.assertIn('ParameterType === "Cloud.ClusterInitSpecs"', self.query())
        self.assertTrue(self.query().endswith('Name === "p\\\""'))
        self.adapter.get_image_metadata('im"')
        self.assertIn('PackageType == "image"', self.query())
        self.assertNotIn("Secret", self.query())


if __name__ == "__main__":
    unittest.main()
