# Configuration and security reference

Start with the [Copilot quick start](../README.md#quick-start-copilot-in-vs-code). This page is the reference for configuration options and security behavior.

## Configuration file

The server reads `${PLUGIN_DATA}/cyclecloud.json`. Copilot supplies `PLUGIN_DATA`; for the marketplace installation in the quick start, it defaults to `~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/`. The path in a `configuration_missing` event is authoritative.

The file is a closed JSON object:

```json
{
    "url": "https://cyclecloud.example.com",
    "username": "cyclecloud-poc",
    "password": "replace-outside-the-agent-conversation",
    "verifyTls": true,
    "allowInsecureHttp": false,
    "enableMutations": false,
    "requestTimeoutMs": 30000,
    "actionTimeoutMs": 60000,
    "debug": false
}
```

Unknown properties and invalid combinations fail startup. Credential strings are printable US-ASCII; usernames cannot contain `:`. Restart the server or create a fresh Copilot session after editing the file.

Optional `caCertPath` is an absolute path to additional PEM CA certificates. The file must be regular, owned by the current user or root, not group/world writable, no larger than 1 MiB, and opened without following its final symlink component. These certificates extend Node's bundled roots for this client only; ambient `NODE_EXTRA_CA_CERTS` is not copied into this trust set. The CycleCloud certificate still needs a SAN matching the configured hostname.

## Credentials and permissions

`cyclecloud.json` contains a reusable plaintext password. It is not encrypted storage or a secret manager. The server requires the file to:

- Be a regular file, not a symlink.
- Be owned by the effective OS user.
- Have mode exactly `0600` or `0400`.

Use a dedicated CycleCloud POC account, not an administrator account or the account reused by your CycleCloud CLI. Grant only the role and group scope needed for the demonstration; begin with read-only access. Separate accounts per operator preserve attribution and independent revocation.

Place `PLUGIN_DATA` on a local filesystem outside the plugin root and outside backup, synchronization, profile-export, or shared-mount scopes. Keep the directory private, for example with mode `0700`. When using [both supported session paths](troubleshooting.md#optional-vs-code-local-workaround), point them at the same data directory rather than creating a second credential file.

The runtime requires absolute, existing `PLUGIN_ROOT` and `PLUGIN_DATA` directories. After resolving real paths, they must be distinct and neither may contain the other. The server does not intentionally write beneath the plugin root.

These checks do not protect against another process, extension, terminal tool, or agent running as the same OS user. The password and Basic authorization value also exist in Node memory while the server runs. CycleCloud authentication, RBAC, and group scope are the actual authorization boundary.

## Transport policy

TLS verification is enabled by default.

| URL and options                                              | Result                          |
| ------------------------------------------------------------ | ------------------------------- |
| HTTPS, `verifyTls: true`, optional valid `caCertPath`        | Allowed and verified            |
| HTTPS to `127.0.0.0/8` or `::1`, explicit `verifyTls: false` | Allowed only for local POC use  |
| HTTP to `127.0.0.0/8` or `::1`, default flags                | Allowed for local POC use       |
| Remote HTTP with `allowInsecureHttp: true`                   | Explicitly allowed but insecure |
| Any other combination                                        | Rejected                        |

For transport overrides, only IP literals in `127.0.0.0/8` and `::1` count as loopback; `localhost` does not. Every HTTP connection, including loopback, transmits reusable Basic credentials without TLS. Prefer verified HTTPS. Redirects are never followed, so credentials are not forwarded to another target.

## Optional lifecycle tools

`enableMutations` defaults to `false`. In this mode, `start_cluster` and `terminate_cluster` are absent from discovery and cannot be called through this server. Enabling them requires editing the credential/configuration file outside Chat and restarting the server.

When enabled:

- The server emits a `mutations_enabled` startup warning.
- Only one lifecycle action runs at a time.
- Tool descriptions ask the agent to read status and present the exact target and recursive behavior first.
- Lifecycle requests are never retried automatically.
- An ambiguous response or unrecognized timeout, network failure, or cancellation at or after dispatch returns `outcome: "unknown"`; inspect cluster status before retrying.
- Only an accepted HTTP 2xx action receives one best-effort status read.

Tool descriptions and MCP hints are advisory. Use lifecycle tools only if the chosen client/session shows a per-call confirmation with the exact tool and arguments, with mutation auto-approval disabled. The read-only setup verification does not establish that a session is suitable for mutation testing. This POC does not create a durable audit log.

For an intentionally enabled demonstration, a suitable prompt is: “Check `demo` and then ask me before starting it non-recursively.”

For missing configuration, startup errors, and client-specific workarounds, see [troubleshooting](troubleshooting.md).

## Endpoint stability and POC limits

The status tool uses the public `GET /clusters/{name}/status?nodes=false` API. Cluster listing/detail and lifecycle actions use CLI-backed `/cloud/api/*` and `/cloud/actions/*` endpoints that are not in the public OpenAPI contract and may change between CycleCloud releases.

The server makes direct CycleCloud HTTP requests and returns bounded normalized data. OS-backed credentials, token authentication, exhaustive filesystem hardening, durable auditing, broad compatibility CI, and public marketplace publication remain follow-up work if the POC warrants production investment.
