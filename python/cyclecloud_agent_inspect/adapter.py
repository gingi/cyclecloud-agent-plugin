"""Temporary 8.10 CLI adapter. All private installed-CLI seams live here.

No SDK, datastore, command execution, interactive login, or global patches.
Installed imports are lazy so capabilities never constructs config or auth.
"""
import re

from .command import fail
from .errors import InspectionError
from .transport import BoundedHTTP, validate_base_url

PROJECTIONS = {
    "overview": "State, ImageName, Configuration.slurm.role as SlurmRole, Configuration.slurm.partition as SlurmPartition, Configuration.slurm.ha_enabled as SlurmHaEnabled, _Template.AdditionalClusterInitSpecs as AttachmentReference",
    "environment": "Extends, State, TargetState, ImageName, MachineType, Architecture, Locker, Configuration.slurm.role as SlurmRole, Configuration.slurm.version as SlurmVersion, Configuration.slurm.partition as SlurmPartition, Configuration.slurm.ha_enabled as SlurmHaEnabled, Configuration.slurm.is_primary_scheduler as SlurmPrimaryScheduler, Configuration.slurm.autoscale as SlurmAutoscale",
    "storage": "Configuration.cyclecloud.mounts as Mounts, Volumes",
    "attachments": "ClusterInitSpecs, _Template.AdditionalClusterInitSpecs as AttachmentReference",
}


def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,256}", value):
        fail("configuration_required")
    return value


def _make_auth(config, metadata_http, identity_http, base_url):
    import cyclecli
    from cyclecli import auth as installed

    class SilentAuth(installed.CycleCLIMSALAuth):
        def __init__(self):
            # Do NOT call the installed constructor: it performs unbounded
            # metadata HTTP and creates unmanaged identity sessions.
            self.is_initialization = False
            self.config = config
            self.token_cache = installed.CycleCLIMSALTokenCache(config)
            section = cyclecli.CycleServerSection.find_section_name(config)
            self.auth_option = config.get(section, "auth_option", fallback=None)
            metadata = metadata_http.get_json(base_url + "/ui/metadata")
            try:
                entra = metadata["entra"]
                if entra["enabled"] is not True:
                    fail("unsupported_authentication")
                self.client_id = _identifier(entra["clientId"])
                self.tenant_id = _identifier(entra["tenantId"])
                self.endpoint = validate_base_url(entra["endpoint"], https_only=True)
            except (KeyError, TypeError):
                fail("invalid_response")
            get = lambda key, default=None: config.get(section, key, fallback=default)
            if self.auth_option == cyclecli.OPTION_MSAL_PUBLIC_CLIENT:
                self.scopes = ["api://%s/user_access" % self.client_id]
                self.msal_client = installed.PublicClientApplication(
                    client_id=self.client_id, authority=self.endpoint + "/" + self.tenant_id,
                    token_cache=self.token_cache, http_client=identity_http)
            elif self.auth_option == cyclecli.OPTION_MSAL_MANAGED_ID_CLIENT:
                identifiers = {key: get("msal_" + key) for key in ("client_id", "object_id", "resource_id")}
                identifiers = {key: value for key, value in identifiers.items() if value}
                if len(identifiers) > 1:
                    fail("configuration_required")
                identity = installed.UserAssignedManagedIdentity(**identifiers) if identifiers else installed.SystemAssignedManagedIdentity()
                self.scopes = ["api://%s/.default" % self.client_id]
                self.msal_client = installed.ManagedIdentityClient(identity, http_client=identity_http)
            elif self.auth_option == cyclecli.OPTION_MSAL_CONFIDENTIAL_CLIENT:
                values = config.to_dict()
                if not (values.get("msal_secret_or_certificate") or values.get("msal_federated_token")):
                    fail("authentication_required")
                credential = installed.ServicePrincipalAuth.build_credential(
                    secret_or_certificate=values.get("msal_secret_or_certificate"),
                    client_assertion=values.get("msal_federated_token"),
                    use_cert_sn_issuer=values.get("msal_use_cert_sn_issuer", False))
                client_id = _identifier(get("msal_client_id", self.client_id))
                tenant = _identifier(get("msal_tenant_id", self.tenant_id))
                principal = installed.ServicePrincipalAuth.build_from_credential(tenant, client_id, credential)
                self.scopes = ["api://%s/.default" % self.client_id]
                self.msal_client = installed.ServicePrincipalCredential(
                    principal, authority=self.endpoint + "/" + tenant,
                    token_cache=self.token_cache, http_client=identity_http)
            else:
                fail("unsupported_authentication")

        def get_access_token_with_cached_account_for_public_client(self):
            section = cyclecli.CycleServerSection.find_section_name(self.config)
            username = self.config.get(section, "msal_username", fallback=None)
            accounts = self.msal_client.get_accounts(username=username)
            if not accounts:
                fail("authentication_required")
            # Keep CLI account selection/cache conventions, never explicit flows.
            result = self.msal_client.acquire_token_silent_with_error(scopes=self.scopes, account=accounts[0])
            if not isinstance(result, dict) or not result.get("access_token"):
                fail("authentication_required")
            self._cache_account(result)
            return result

        def __call__(self, request):
            try:
                # The installed method persists the normal token cache and config
                # after a successful refresh. It does not initialize/switch profiles.
                return super().__call__(request)
            except InspectionError:
                raise
            except Exception:
                fail("authentication_required")

    try:
        return SilentAuth()
    except InspectionError:
        raise
    except (ImportError, AttributeError):
        fail("unsupported_layout")
    except Exception:
        fail("authentication_required")


class CycleCloudAdapter:
    def __init__(self, config_path, deadline):
        self.http = None
        self.identity_http = None
        try:
            import requests
            import cyclecli
            from cyclecloud.config import CycleCloudConfig
            from cyclecloud.util import urlquote
            from cyclecli.expressions import quote
            self.urlquote = urlquote
            self.quote = quote
            try:
                self.config = CycleCloudConfig(config_file=config_path)
                values = self.config.to_dict()
                self.base_url = validate_base_url(values.get("url"))
            except InspectionError:
                raise
            except Exception:
                fail("configuration_required")
            option = values.get("auth_option", cyclecli.OPTION_USERNAME_PASSWORD)
            if option not in (cyclecli.OPTION_USERNAME_PASSWORD, cyclecli.OPTION_MSAL_PUBLIC_CLIENT,
                              cyclecli.OPTION_MSAL_CONFIDENTIAL_CLIENT, cyclecli.OPTION_MSAL_MANAGED_ID_CLIENT):
                fail("unsupported_authentication")
            # Private 8.10 seam: configured raw Session, no wrapper's res.text and
            # no auth constructor. Proxy/environment CA behavior remains Requests'.
            session = cyclecli._get_session(self.config, skip_auth=True)
            self.http = BoundedHTTP(session, deadline)
            if option == cyclecli.OPTION_USERNAME_PASSWORD:
                username, password = values.get("username"), values.get("password")
                if not username or not password:
                    fail("authentication_required")
                session.auth = requests.auth.HTTPBasicAuth(username, password)
            else:
                # Identity never inherits CycleCloud auth, headers or cookies.
                # Managed identity's link-local/service endpoints may use HTTP;
                # public/confidential OAuth endpoints always require verified TLS.
                self.identity_http = BoundedHTTP(requests.Session(), deadline, require_verified=True,
                                                 https_only=option != cyclecli.OPTION_MSAL_MANAGED_ID_CLIENT)
                session.auth = _make_auth(self.config, self.http, self.identity_http, self.base_url)
        except BaseException:
            self.close()
            raise

    def close(self):
        for http in (self.http, self.identity_http):
            if http is not None:
                http.close()

    def _read(self, path, accept="application/json"):
        return self.http.get_json(self.base_url + path, headers={"Accept": accept})

    def _query(self, query):
        return self._read("/exec/query/?q=" + self.urlquote(query) + "&format=json", "*/*")

    def list_clusters(self):
        return self._read("/cloud/api/clusters?summary=true&cloud_instances=true")

    def get_cluster(self, name):
        return self._read("/cloud/api/clusters/" + self.urlquote(name) + "?summary=true&cloud_instances=true")

    def get_cluster_status(self, name):
        return self._read("/clusters/" + self.urlquote(name) + "/status?nodes=false")

    def get_cluster_issues(self, name):
        return self._query("select Name, Status, Message, NodeCount, Detail, Recommendation "
                           "using cloud.node.node_status where ClusterName == " + self.quote(name))

    def get_application_nodes(self, name, selection=None):
        selection = selection or {"view": "overview"}
        details = selection.get("view") == "details"
        projection = PROJECTIONS[selection["section"] if details else "overview"]
        query = ("select Name, Template, IsArray, " + projection
                 + " from Cloud.Node where ClusterName === " + self.quote(name)
                 + " && (Template === Name || IsArray === true) && Abstract =!= true")
        if details:
            query += " && Name === " + self.quote(selection["targetName"])
        return self._query(query)

    def get_application_parameters(self, name, parameter_name=None):
        query = ("select Name, Label, ParameterType, Value from Cloud.ClusterParameter where ClusterName === "
                 + self.quote(name) + ' && ParameterType === "Cloud.ClusterInitSpecs"')
        if parameter_name is not None:
            query += " && Name === " + self.quote(parameter_name)
        return self._query(query)

    def get_image_metadata(self, image):
        return self._query("select Name, PackageType, Label, OS, JetpackPlatform from Package where Name === "
                           + self.quote(image) + ' && PackageType == "image"')
