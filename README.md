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
- A reachable CycleCloud installation.
- A dedicated CycleCloud POC account with the smallest role and group scope needed for the demonstration.

Native Windows is not supported by this POC because credential-file ownership and mode checks are POSIX-specific. Agent Plugins package conformance is separate from runtime compatibility.

## Install from VS Code

Use a VS Code window connected to Linux, macOS, or WSL. For WSL, first run **WSL: Connect to WSL** so the MCP process runs in Linux rather than native Windows. A supported Node version must already be available to that VS Code environment.

1. Open Settings, search for `chat.plugins.enabled`, and enable **Chat: Plugins Enabled**. You can also set it in User Settings JSON:

    ```json
    {
        "chat.plugins.enabled": true
    }
    ```

2. Open the Command Palette and run **Chat: Install Plugin From Source**. Alternatively, open the Agent Customizations editor, select **Plugins**, and choose **Install Plugin from Source**.
3. Enter `https://github.com/gingi/cyclecloud-mcp.git`.
4. If prompted, sign in to GitHub through VS Code. The repository is private, so the active VS Code/Git environment must have access. An authenticated SSH URL, `git@github.com:gingi/cyclecloud-mcp.git`, is an alternative. Do not put a personal access token in the URL or settings.
5. Confirm `cyclecloud-mcp` appears under **Agent Plugins - Installed** in the Extensions view. Installed plugin MCP servers execute local code and are implicitly trusted at startup, so review the repository before enabling it.
6. The first MCP start intentionally fails because credentials are absent. Run **MCP: List Servers**, select `cyclecloud`, and choose **Show Output**. The `configuration_missing` JSON line includes the exact expected `cyclecloud.json` path. A secret-free `cyclecloud.example.json` is created beside it with mode `0600`.
7. Configure the plugin without a terminal:
    - Copy the parent directory from the reported path.
    - Use **File: Open Folder...** in a new VS Code window to open that directory.
    - In Explorer, rename `cyclecloud.example.json` to `cyclecloud.json`. Renaming preserves the owner-only file mode.
    - Edit `cyclecloud.json` in VS Code and save it. Supply the credential directly in the file, not in Chat.
    - Keep `enableMutations` set to `false`. For a local CycleCloud backend in the same WSL environment, use `http://127.0.0.1:8080`; for remote CycleCloud, prefer verified HTTPS.
8. Return to the original VS Code window. Run **MCP: List Servers**, select `cyclecloud`, and restart it.
9. Open **Configure Tools** in Chat and verify exactly `list_clusters`, `get_cluster`, and `get_cluster_status` are present. Both lifecycle tools must be absent.
10. Open Agent mode and try the read-only prompts below. Tool calls should show bounded structured results.

To update a source-installed plugin after pushing changes, run **Extensions: Check for Extension Updates**. To disable or uninstall it, use the context menu under **Agent Plugins - Installed** or the Plugins section of the Agent Customizations editor.

### Optional shell preflight

A terminal is useful only for diagnosing prerequisites; it is not part of the normal installation. These commands confirm that the VS Code environment can find Node and authenticate to the private repository:

```bash
node --version
git ls-remote https://github.com/gingi/cyclecloud-mcp.git
```

## Local checkout alternative

For development against an existing checkout, build and verify it:

```bash
npm ci --ignore-scripts
npm run verify
```

Then register its directory instead of installing from Git:

```json
{
    "chat.plugins.enabled": true,
    "chat.pluginLocations": {
        "/home/you/src/cyclecloud-mcp": true
    }
}
```

A `true` value enables the plugin; `false` keeps it registered but disabled. After changing registration, use **Developer: Reload Window** if the active agent host does not refresh its plugin cache. The package uses root `plugin.json` and `mcp.json`; do not create a workspace `.vscode/mcp.json` or install a VSIX.

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

- **Configuration missing:** run **MCP: List Servers**, select `cyclecloud`, and choose **Show Output**. Copy the `path` from the `configuration_missing` JSON event, copy the adjacent `cyclecloud.example.json` to that path, complete it outside the agent conversation, set mode `0600`, then restart the server.
- **Credential file rejected:** check ownership, exact mode, regular-file type, and symlink status.
- **TLS error:** check the URL hostname/SAN and use `caCertPath` for a private CA; do not disable verification for a remote host.
- **Mutation tools missing:** this is the safe default; confirm `enableMutations` is true only for an intentional, scoped demonstration and restart the plugin.
- **Action outcome unknown:** inspect cluster status before deciding whether to retry.
- **Server does not start:** confirm a supported Node version is on VS Code's executable search path.

## Cleanup and uninstall

1. Restore `enableMutations: false` and restart if lifecycle tools were enabled.
2. For a source installation, right-click `cyclecloud-mcp` under **Agent Plugins - Installed** and choose **Uninstall**. For a local checkout, disable or remove its `chat.pluginLocations` entry.
3. Permanently delete `${PLUGIN_DATA}/cyclecloud.json`; disabling the plugin does not delete persistent data.
4. Rotate or disable the dedicated POC credential.
5. Confirm no credential, private key, or local configuration was committed.

This POC is intended to demonstrate and assess the MCP experience. OS-backed credentials, token authentication, exhaustive filesystem hardening, durable auditing, broad compatibility CI, and marketplace publication are follow-up work if the experiment warrants production investment.
