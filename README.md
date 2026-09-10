# cyclecloud-mcp

A proof-of-concept [Agent Plugins 1.0](https://agent-plugins.org/) package that lets VS Code agent mode inspect Azure CycleCloud through a bundled stdio MCP server. Lifecycle tools are available only when an operator explicitly enables them.

## Capabilities

Read tools, registered by default:

- `list_clusters`
- `get_cluster`
- `get_cluster_status`

Optional lifecycle tools:

- `start_cluster`
- `terminate_cluster`

The server uses direct CycleCloud HTTP requests and returns bounded normalized data rather than raw records.

## Requirements and compatibility

- Linux, macOS, or WSL using its Linux filesystem.
- Node.js `^20.19.0`, `^22.12.0`, or `>=24.0.0` available on VS Code's executable search path.
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/get-started) with `plugin marketplace` support in the environment that will run the MCP process.
- A reachable CycleCloud installation.
- A dedicated CycleCloud POC account with the smallest role and group scope needed for the demonstration.

Native Windows is not supported by this POC because credential-file ownership and mode checks are POSIX-specific. Agent Plugins package conformance is separate from runtime compatibility.

## Install with GitHub Copilot CLI

VS Code must run in the target Linux or macOS environment (for WSL, use a VS Code window connected to WSL). Installed plugins execute local code and are implicitly trusted at startup, so review this repository before enabling it.

1. In VS Code, select **Terminal > New Terminal**.
2. In VS Code Settings, search for `chat.plugins.enabled` and enable **Chat: Plugins Enabled**.
3. In the terminal, add this repository's marketplace and install the plugin:

    ```bash
    copilot plugin marketplace add gingi/cyclecloud-mcp
    copilot plugin install cyclecloud-mcp@cyclecloud-mcp
    ```

4. Confirm the plugin is enabled:

    ```bash
    copilot plugin list
    ```

    The output must list `cyclecloud-mcp` as enabled.

5. In the same VS Code window, open the Command Palette and run **Developer: Reload Window**.
6. Open the Extensions view and confirm `cyclecloud-mcp` appears under **Agent Plugins - Installed**.

### First start and configuration

Installing the plugin makes the MCP server available to VS Code; it does not guarantee that the server has already started. VS Code may start it during tool discovery. Use this explicit sequence so its state and configuration path are visible:

1. Run **MCP: List Servers** and select `cyclecloud`.
2. Choose **Start**. If its state is already **Error**, VS Code already attempted the first start.
3. Select `cyclecloud` again and choose **Show Output**.
4. The first MCP start intentionally fails because credentials are absent. The `configuration_missing` JSON line includes the exact expected `cyclecloud.json` path. A secret-free `cyclecloud.example.json` is created beside it with mode `0600`.
5. Configure the plugin without putting the credential in Chat:
    - Copy the parent directory from the reported path.
    - Use **File: Open Folder...** in a new VS Code window to open that directory.
    - In Explorer, rename `cyclecloud.example.json` to `cyclecloud.json`. Renaming preserves the owner-only file mode.
    - Edit `cyclecloud.json` in VS Code and save it. Supply the credential directly in the file.
    - Keep `enableMutations` set to `false`. For a local CycleCloud backend in the same WSL environment, use `http://127.0.0.1:8080`; for remote CycleCloud, prefer verified HTTPS.
6. Return to the original VS Code window. Run **MCP: List Servers**, select `cyclecloud`, and restart it.
7. Open **Configure Tools** in Chat and verify exactly `list_clusters`, `get_cluster`, and `get_cluster_status` are present. Both lifecycle tools must be absent.
8. Open Agent mode and try the read-only prompts below. Tool calls should show bounded structured results.

### Update

Refresh the marketplace catalog, update the installed plugin, and reload VS Code:

```bash
copilot plugin marketplace update cyclecloud-mcp
copilot plugin update cyclecloud-mcp@cyclecloud-mcp
```

Then run **Developer: Reload Window**.

## Configuration

`${PLUGIN_DATA}/cyclecloud.json` is a closed JSON object:

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

Optional `caCertPath` is an absolute path to additional PEM CA certificates. The file must be regular, owned by the current user or root, not group/world writable, no larger than 1 MiB, and opened without following its final symlink component. The configured certificates extend Node's bundled roots for this client only; ambient `NODE_EXTRA_CA_CERTS` is not copied into this trust set. The CycleCloud server certificate still needs a SAN matching the configured host.

Unknown properties and invalid combinations fail startup. Credential strings are printable US-ASCII; usernames cannot contain `:`.

## Credential security

`cyclecloud.json` contains a reusable plaintext password. It is **not** encrypted storage or a secret manager.

On POSIX, the server requires the file to:

- be a regular file rather than a symlink;
- be owned by the effective user;
- have mode exactly `0600` or `0400`.

Use a dedicated POC account that is not reused by the CycleCloud CLI. Place `PLUGIN_DATA` on a local filesystem outside the plugin root and outside known backup, synchronization, profile-export, or shared-mount scopes.

These controls are stronger than ordinary plaintext/obfuscated CLI-file handling, but they do not protect against another process, extension, terminal tool, or agent running as the same OS user. The password and Basic authorization value also exist in Node memory while the server runs.

## Transport policy

TLS verification is enabled by default.

| URL and options                                              | Result                          |
| ------------------------------------------------------------ | ------------------------------- |
| HTTPS, `verifyTls: true`, optional valid `caCertPath`        | Allowed and verified            |
| HTTPS to `127.0.0.0/8` or `::1`, explicit `verifyTls: false` | Allowed only for local POC use  |
| HTTP to `127.0.0.0/8` or `::1`, default flags                | Allowed for local POC use       |
| Remote HTTP with `allowInsecureHttp: true`                   | Explicitly allowed but insecure |
| Any other combination                                        | Rejected                        |

For transport overrides, only IP literals in `127.0.0.0/8` and `::1` count as loopback; `localhost` does not. Every HTTP connection, including loopback, transmits reusable Basic credentials without TLS. Prefer verified HTTPS.

Redirects are never followed, so credentials are not forwarded to another target.

## Mutation safety

`enableMutations` defaults to `false`. When false, start and terminate are absent from MCP discovery and cannot be called through this server. Changing it requires editing the local file outside the conversation and restarting the plugin.

When enabled:

- the server emits a `mutations_enabled` startup warning;
- only one lifecycle action can run at a time;
- tool descriptions ask the agent to read status and present the exact target and recursive behavior first;
- no lifecycle request is retried automatically;
- an ambiguous HTTP response or unrecognized timeout, network failure, or cancellation at or after dispatch returns `outcome: "unknown"` and tells the user to inspect status before retrying;
- only an accepted HTTP 2xx action receives one best-effort status read.

Tool descriptions and MCP hints are advisory. Use lifecycle tools only if the tested VS Code build shows a per-call confirmation containing the exact tool and arguments, with mutation auto-approval disabled. CycleCloud authentication, RBAC, and group scope remain the actual authorization boundary. This POC does not create a durable audit log.

## Endpoint stability

The status tool uses the public `GET /clusters/{name}/status?nodes=false` API. Cluster listing/detail and lifecycle actions use CLI-backed `/cloud/api/*` and `/cloud/actions/*` endpoints that are not in the public OpenAPI contract and may change between CycleCloud releases.

## Example prompts

- “List my CycleCloud clusters.”
- “Show the state and configured node counts for cluster `demo`.”
- “Get capacity status for cluster `demo`.”
- With mutations deliberately enabled: “Check `demo` and then ask me before starting it non-recursively.”

## Development

```bash
npm ci --ignore-scripts
npm run test
npm run typecheck
npm run lint
npm run format:check
npm run audit
npm run build
```

`npm run verify` runs the complete local sequence. `bin/cyclecloud-mcp.mjs` is generated, dependency-complete, committed without a shebang, and launched by the bare `node` command declared in `mcp.json`.

## Troubleshooting

- **Plugin does not appear in VS Code:** run `copilot plugin list` in the same environment that should run the MCP process. Confirm `cyclecloud-mcp` is enabled, then run **Developer: Reload Window** and verify **Chat: Plugins Enabled** is on. For WSL, both the install command and VS Code window must use the same distribution.
- **Marketplace file not found:** the repository revision fetched by Copilot CLI does not contain `.github/plugin/marketplace.json`, so installation cannot continue. Use a published revision that includes the marketplace catalog or contact the repository maintainer.
- **An older installation already exists:** uninstall it under **Agent Plugins - Installed**, remove any `chat.pluginLocations` entry that points to a CycleCloud MCP checkout, and run **Developer: Reload Window** before following the current installation steps.
- **WSL server launches on Windows:** an error containing `LocalProcess` or a Windows path with literal `${PLUGIN_ROOT}` indicates an older VS Code source installation. Remove it as described above, install through Copilot CLI inside WSL, and reload the WSL window.
- **Configuration missing:** run **MCP: List Servers**, select `cyclecloud`, and choose **Show Output**. Copy the `path` from the `configuration_missing` JSON event, copy the adjacent `cyclecloud.example.json` to that path, complete it outside the agent conversation, set mode `0600`, then restart the server.
- **Output is blank after an error:** run **Developer: Open Logs Folder** and inspect the current window's `mcpServer` log whose name ends in `cyclecloud.log`. A launch failure can occur before this plugin writes its structured startup event.
- **Credential file rejected:** check ownership, exact mode, regular-file type, and symlink status.
- **TLS error:** check the URL hostname/SAN and use `caCertPath` for a private CA; do not disable verification for a remote host.
- **Mutation tools missing:** this is the safe default; confirm `enableMutations` is true only for an intentional, scoped demonstration and restart the plugin.
- **Action outcome unknown:** inspect cluster status before deciding whether to retry.
- **Server does not start:** confirm a supported Node version is on the MCP process's executable search path.

## Cleanup and uninstall

1. Restore `enableMutations: false` and restart if lifecycle tools were enabled.
2. Uninstall the plugin and remove its marketplace registration:

    ```bash
    copilot plugin uninstall cyclecloud-mcp@cyclecloud-mcp
    copilot plugin marketplace remove cyclecloud-mcp
    ```

3. Run **Developer: Reload Window** and confirm `cyclecloud-mcp` is absent under **Agent Plugins - Installed**.
4. Permanently delete `${PLUGIN_DATA}/cyclecloud.json`; uninstalling the plugin does not delete persistent data.
5. Rotate or disable the dedicated POC credential.
6. Confirm no credential, private key, or local configuration was committed.

This POC is intended to demonstrate and assess the MCP experience, including marketplace-based distribution. OS-backed credentials, token authentication, exhaustive filesystem hardening, durable auditing, broad compatibility CI, and public marketplace publication are follow-up work if the experiment warrants production investment.
