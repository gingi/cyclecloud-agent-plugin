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

    Run only if you trust this repository, and do not use sudo. The installer prompts for configuration before installing the plugin. For other installation methods or installer errors, see [troubleshooting](docs/troubleshooting.md).

3. Answer the installer's URL, username, and password prompts. Press Enter to keep an existing value; the saved password is shown as `********` and password input is hidden. Values are saved privately to `~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json`. Other settings are preserved; new configurations keep `enableMutations: false`.

    To skip prompts, run `sh install.sh --skip-config` (or pipe to `sh -s -- --skip-config`). Without a terminal, prompts are skipped automatically. Existing configuration is left unread and unchanged; if missing, a private template is created for you to edit before use.

    Never paste the password into Chat or commit this file. Use verified HTTPS for remote CycleCloud. For a backend in the same environment, `http://127.0.0.1:8080` is allowed for this POC. See [configuration and security](docs/configuration.md) for private CAs and all other options.

### 2. Verify the setup

1. If in VS Code, run **Developer: Reload Window** from the Command Palette.

2. Start a new agent session in VS Code or Copilot CLI, in the environment where you installed the plugin. Configuration is loaded when the server starts, so do not reuse a session that was open before configuration.

3. Send:

    > Use the cyclecloud MCP to list my clusters

4. Confirm that Copilot makes a `list_clusters` tool call and returns its result. No manual server start is needed.

If the plugin does not appear or connect, see the [discovery and enablement checks](docs/troubleshooting.md#server-absent-or-not-connected).

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

## Install a local or unpublished build

See the [development guide](docs/development.md#install-a-local-or-unpublished-build) to build and install from a checkout or distribute a self-contained local package. Local installations use the same private configuration file as remote installations.

## Update or remove

For a **local installation**, rerun `sh install.sh --local` from a new package, or follow the [local-build workflow](docs/development.md#install-a-local-or-unpublished-build). For a **remote GitHub installation**, run these commands, reload VS Code, and start a fresh connected agent session:

```bash
copilot plugin marketplace update cyclecloud-mcp
copilot plugin update cyclecloud-mcp@cyclecloud-mcp
```

To remove, end sessions using the plugin, then run:

```bash
copilot plugin uninstall cyclecloud-mcp@cyclecloud-mcp
copilot plugin marketplace remove cyclecloud-mcp
```

Delete the credential file from the Copilot data directory and revoke the dedicated account's credential. For local-package installations, also remove the VS Code copy at `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/` if it remains: current CLI versions only disable live plugins on uninstall and do not delete their files. The managed `~/.local/share/cyclecloud-mcp/marketplace/` directory and `installation.json` receipt can then be removed. Uninstalling does not delete credentials. Reload VS Code afterward.

## More information

- [Design and architecture](docs/cyclecloud-mcp-design.md)
- [Configuration and security](docs/configuration.md)
- [Troubleshooting and local installation](docs/troubleshooting.md)
- [Development guide: setup, verification, local builds, reset, and deployment](docs/development.md)
