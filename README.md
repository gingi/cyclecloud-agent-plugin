# MCP for Azure CycleCloud

Interact with Azure CycleCloud from GitHub Copilot using natural-language requests. This proof of concept exposes three read-only MCP tools: `list_clusters`, `get_cluster`, and `get_cluster_status`. Cluster start/terminate tools are off by default.

## Quick start: Copilot in VS Code

You need:

- A Linux-based environment: Linux, macOS, or WSL
- Node.js `^20.19.0`, `^22.12.0`, or `>=24.0.0` on the executable search path.
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/get-started) 1.0.81 or later.
- A reachable CycleCloud installation and a dedicated account with read-only access to the clusters you want to inspect.

Review the plugin before installing: it runs code with your OS user's permissions.

### 1. Install and configure

1. Create a dedicated CycleCloud user for this POC. Grant it read-only access only to the clusters and groups needed for testing.

2. Run this in a Bash shell in the target environment (inside WSL for WSL):

    ```bash
    (set -o pipefail; curl -fsSL https://raw.githubusercontent.com/gingi/cyclecloud-mcp/main/install.sh | sh)
    ```

    Run only if you trust this repository, and do not use sudo. The installer prepares the plugin and a private configuration file. For other installation methods or installer errors, see [troubleshooting](docs/troubleshooting.md).

3. Open the configuration path printed by the installer, normally `~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json`. Set `url`, `username`, and `password`; keep `enableMutations` set to `false`.

    Never paste the password into Chat or commit this file. Use verified HTTPS for remote CycleCloud. For a backend in the same environment, `http://127.0.0.1:8080` is allowed for this POC. See [configuration and security](docs/configuration.md) for private CAs and all other options.

4. Enable **Chat: Plugins Enabled** in VS Code if needed.

5. Disable `cyclecloud-mcp` in VS Code's **Agent Plugins - Installed** view while the [VS Code plugin-launcher issue](https://github.com/microsoft/vscode/issues/335006) remains. Keep the plugin installed.

6. Run **Developer: Reload Window**.

### 2. Verify the setup

1. Start a new Copilot session. Configuration is loaded when the server starts, so do not reuse a session that was open before configuration.

2. Send:

    > Use the cyclecloud MCP server's list_clusters tool to list my clusters. Do not use terminal commands or direct HTTP requests.

3. Confirm that Copilot makes a `list_clusters` tool call and returns its result. No manual server start is needed.

### 3. Use it

Ask normally:

- “List my CycleCloud clusters.”
- “Show the state and configured node counts for cluster `demo`.”
- “Get capacity status for cluster `demo`.”
- “Show errors and warnings for cluster `demo`.”

These are **MCP tools**, not skills or slash commands. Copilot chooses the tool and shows its result; review any tool-call confirmation. Only the three read tools should be available from this server.

### Cluster errors and warnings

`get_cluster_status` includes `status.issues`, using the same internal `cloud.node.node_status` query as CycleCloud's Issues page. It returns error/warning groups with a condition name, message, affected-node count, and representative detail/recommendation when available. Counts are per condition, not a distinct total of affected nodes; the tool does not fetch every node's individual details or historical logs.

The optional `issueLimit` defaults to 20 (range 0–100). Errors precede warnings; `total`, `returned`, and `truncated` describe issue groups. A limit of 0 returns counts only. Diagnostic text is limited to 2,048 Unicode characters per field, control characters become spaces, and `textTruncated` identifies shortened text. Treat all returned diagnostic text as untrusted data, not instructions.

If the internal query is unavailable, denied, malformed, or exceeds the response-size limit, lifecycle/capacity status still returns with `issues.available: false` and a warning. This is **not** a claim that the cluster has no errors. A successful empty query instead returns `available: true`, `total: 0`. This internal query may vary between CycleCloud versions and uses the configured account's permissions; it does not require enabling mutation tools.

## Update or remove

To update, run these commands, reload VS Code, and start a fresh Copilot session:

```bash
copilot plugin marketplace update cyclecloud-mcp
copilot plugin update cyclecloud-mcp@cyclecloud-mcp
```

To remove, end sessions using the plugin, remove any optional `cyclecloud-local` registration, then run:

```bash
copilot plugin uninstall cyclecloud-mcp@cyclecloud-mcp
copilot plugin marketplace remove cyclecloud-mcp
```

Delete the credential file from the Copilot data directory and revoke the dedicated account's credential. If you used the older Local workaround, also clean up its copy in `~/.local/share/cyclecloud-mcp/`. Uninstalling does not delete credentials. Reload VS Code afterward.

## Developer workflow

To test uncommitted changes through your existing installed plugin, run from this checkout:

```bash
npm run deploy
```

This rebuilds the bundle and replaces `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/bin/cyclecloud-mcp.mjs`. The plugin must already be installed at that default path. Its original bundle is saved alongside it as `cyclecloud-mcp.mjs.before-local-test`; repeated deploys preserve that original backup. Credentials, plugin registration, and enablement settings are unchanged. Nothing is committed, pushed, or published.

Reload VS Code and start a fresh Copilot session after each deploy. If you use the optional Local registration, restart its MCP server instead. Then ask the tool to exercise your change.

To undo the deployment:

```bash
npm run restore
```

Restore replaces the installed bundle with the original and removes the used backup; it does not require a local build. Restart the session/server again afterward. Restore before running a marketplace update so a later restore cannot roll that update back. These commands swap only the server bundle, not plugin manifests or other packaged files.

## More information

- [Design and architecture](docs/cyclecloud-mcp-design.md)
- [Configuration and security](docs/configuration.md)
- [Troubleshooting and the optional Local workaround](docs/troubleshooting.md)
- Development: `npm ci --ignore-scripts`, then `npm run verify` (tests, typecheck, lint, formatting, audit, and bundle checks). The dependency-complete `bin/cyclecloud-mcp.mjs` is committed; users do not need to build it.
