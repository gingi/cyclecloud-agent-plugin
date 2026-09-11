# Troubleshooting

For normal installation, use the [quick start](../README.md). Configuration can be created from the packaged template without running Copilot or the MCP server.

## Installer download options

The [README one-liner](../README.md#1-install-and-configure) streams `install.sh` from `main` directly to `sh`. It runs from any directory and needs no checkout or temporary file. Use Bash or Zsh for the outer `pipefail` option. The script itself is POSIX shell and uses the required Node runtime; it does not need `jq`, Python, npm installation, or sudo.

**Inspect-first alternative:** download `install.sh` from a reviewed commit SHA, save it locally, inspect it, then run `sh install.sh`. You can also run `sh install.sh` from a reviewed checkout. Unlike a commit SHA, `main` can change between installations.

Pinning the installer does not pin a fresh plugin installation: Copilot uses its registered marketplace catalog. Existing plugin versions are preserved, not silently upgraded.

If the repository is private, raw `curl` access may fail even when Copilot or Git is authenticated. Use an authenticated checkout and run `sh install.sh`; do not embed tokens in download URLs. Neither path is available until a revision containing the installer and template is published.

## Installer failures and reruns

- **Missing dependencies or unsupported OS:** install a supported Node version and Copilot CLI yourself. Use a Linux/macOS executable in WSL, not `node.exe`. The installer does not install dependencies or use sudo.
- **CLI JSON commands fail:** use a CLI supporting `copilot plugin list --json` and `copilot plugin marketplace list --json`. Authenticate separately and verify repository access, then rerun. The installer does not prompt for login or passwords.
- **A marketplace or plugin has a conflicting source:** inspect `copilot plugin marketplace list` and `copilot plugin list`. Resolve the conflict explicitly; the installer will not replace an unrelated registration.
- **Existing configuration is insecure or symlinked:** inspect its ownership, file type, and mode outside Chat. The installer refuses it rather than modifying credentials automatically.
- **Partial installation:** a successfully added marketplace or installed plugin is kept if a later step fails. Resolve the error and rerun; existing versions, configuration contents, and enablement choices are preserved.
- **Older plugin lacks the template or bundle:** explicitly update or repair the plugin, then rerun. A successful installer exit only confirms setup, not valid credentials or CycleCloud connectivity.
- **Custom Copilot paths:** this installer targets the default `~/.copilot/` installation and data directories. Use the manual path below if your CLI uses a different layout.

## Manual installation

If you do not want the installer, register the marketplace and install the plugin yourself:

```bash
copilot plugin marketplace add gingi/cyclecloud-mcp
copilot plugin install cyclecloud-mcp@cyclecloud-mcp
copilot plugin list
```

Skip registration/installation commands for entries you already have; do not use these as an implicit update procedure.

### Prepare configuration

Copy the template from the installed plugin. Adapt the paths if Copilot uses a non-default directory:

```bash
(
    set -eu
    umask 077
    plugin="$HOME/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp"
    data="$HOME/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp"
    test -r "$plugin/cyclecloud.example.json"
    mkdir -p "$data"
    chmod 700 "$data"
    set -C
    cat "$plugin/cyclecloud.example.json" > "$data/cyclecloud.json"
)
```

This creates a private directory and a `0600` file without running the server. It refuses to overwrite an existing `cyclecloud.json`; edit that file instead. Return to [Install and configure](../README.md#1-install-and-configure) to fill in the URL and credentials outside Chat.

## Configuration template missing

Older installations may not include `cyclecloud.example.json` at the plugin root. Update to a published revision containing the template:

```bash
copilot plugin marketplace update cyclecloud-mcp
copilot plugin update cyclecloud-mcp@cyclecloud-mcp
```

Then rerun the installer or the [manual copy command](#prepare-configuration). A template in a local checkout is not available to marketplace users until that revision is published and installed.

If updating is not possible, the server can still [generate an example as a fallback](#configuration-missing-generated-example-fallback).

## Configuration missing: generated-example fallback

`configuration_missing` means the server started but could not find `cyclecloud.json` in its data directory. It is not a required onboarding step.

1. If no example exists yet, create a Copilot session and send a request such as “Use the cyclecloud MCP server to list my clusters.” The expected failure generates a secret-free `cyclecloud.example.json` with mode `0600`.
2. Open **MCP: List Servers → cyclecloud → Show Output** in that session. Use the exact configuration path from the error, not a path guessed from another client. The default native Copilot directory is `~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/`.
3. Open the directory in an editor outside Chat. Rename `cyclecloud.example.json` to `cyclecloud.json`, preserving its private mode; do not overwrite an existing configuration. Fill in the URL and credentials and keep `enableMutations: false`.
4. Create a fresh Copilot session and retry the read-only request.

If you already configured a different client, check the path: an older Local workaround used `~/.local/share/cyclecloud-mcp/`, which Copilot does not read. Prefer [sharing the existing Copilot configuration](#consolidate-an-older-two-file-setup) rather than maintaining two credential copies.

## Starting with no output

In the tested Insiders build, a new Copilot session's runtime is deferred until the first message. Clicking the MCP Start button before that can leave the UI at “Starting” without launching a process. Send a message first; this initializes the agent runtime, not the configuration file.

If a real chat turn still fails, inspect the correct launch path:

- **Copilot session:** **MCP: List Servers → cyclecloud → Show Output** in the session-specific list.
- **Local session:** **MCP: List Servers → Show locally configured servers... → cyclecloud-local → Show Output**. Skip the middle step if already in the native list.

If output is blank, use **Developer: Open Logs Folder**. Native launches log to the window's `mcpServer` file; agent-host launches also report MCP inventory/errors in `agenthost.log` on the host running the agent. A model saying a tool is unavailable is not itself a launch diagnostic.

## Other symptoms

| Symptom                                        | Check                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copilot says `cyclecloud-local` is unavailable | The native Copilot plugin is named `cyclecloud`. Seeing a synchronized `cyclecloud-local` entry is not proof it launched.                                         |
| Plugin absent                                  | Run `copilot plugin list` in the intended environment, verify CLI enablement, and reload VS Code. Use the same WSL distribution for installation and the session. |
| Marketplace file not found                     | The fetched revision lacks `.github/plugin/marketplace.json`; use a published revision containing the catalog.                                                    |
| Process launches on Windows                    | Use the WSL-connected window and its remote configuration. Native Windows is unsupported.                                                                         |
| Credential file rejected                       | Check ownership, mode `0600` or `0400`, regular-file type, and symlink status. Do not share its contents in Chat.                                                 |
| TLS failure                                    | Check hostname/SAN and use `caCertPath` for a private CA. Do not disable verification for a remote host.                                                          |
| Lifecycle tools absent                         | This is the intended default. Do not enable mutations just to complete setup.                                                                                     |
| Action outcome unknown                         | Inspect cluster status before retrying.                                                                                                                           |
| Node cannot launch                             | Confirm a supported Node version is available in the environment running the MCP process.                                                                         |

See the [configuration and security reference](configuration.md) for option details.

## Do I need the Local workaround?

Only if you want VS Code's **Local** session type. Local is an agent execution mode, not a local model, and it can access a remote CycleCloud URL.

| Session type                  | Server name        | Setup                                                                                   |
| ----------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| Copilot agent-host/background | `cyclecloud`       | Use the [quick start](../README.md); no custom MCP JSON                                 |
| VS Code Local                 | `cyclecloud-local` | Use the [explicit-path workaround](#optional-vs-code-local-workaround)                  |
| Cloud                         | —                  | Not verified; WSL paths and credentials are not automatically available in this session |

Do not set up both paths unless you need both session types.

## Optional VS Code Local workaround

This registration reuses the quick start's credential file; do not create another copy.

### Why a workaround?

[VS Code issue #335006](https://github.com/microsoft/vscode/issues/335006) leaves `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` unresolved in canonical Agent Plugins 1.0 launches. This was reported on stable 1.136.1 and 1.137.0 and observed on Insiders 1.138.0. Copilot's independent native-plugin runtime successfully launches this package; the issue does not require changing the portable manifests.

The workaround registers the installed bundle directly as `cyclecloud-local`. **Keep `cyclecloud-mcp` installed but disabled in VS Code's Agent Plugins view. Keep it enabled in Copilot CLI if you also use Copilot sessions.** Disabling the VS Code plugin does not remove its files; uninstalling does.

### Register the server

1. Complete the [Copilot quick start](../README.md#quick-start-copilot-in-vs-code), including the credential file. This guide reuses that file; do not create another copy.
2. In a WSL window, run **MCP: Open Remote User Configuration**, not the Windows user configuration. On native Linux or macOS, use **MCP: Open User Configuration**. Default WSL files are:
    - Stable: `~/.vscode-server/data/User/mcp.json`
    - Insiders: `~/.vscode-server-insiders/data/User/mcp.json`
3. Merge this entry into `servers`, preserving any other servers and inputs. Replace `/home/you` with your absolute home path (`/Users/you` on macOS). If Copilot reported a different data directory, use it for `PLUGIN_DATA`:

    ```json
    {
        "servers": {
            "cyclecloud-local": {
                "type": "stdio",
                "command": "node",
                "args": ["/home/you/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/bin/cyclecloud-mcp.mjs"],
                "env": {
                    "PLUGIN_ROOT": "/home/you/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
                    "PLUGIN_DATA": "/home/you/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp"
                }
            }
        }
    }
    ```

    This is native VS Code `servers` configuration, not the plugin's `mcpServers` manifest. Keep credentials out of it. The bundle and both directories must exist; all paths must be absolute, with no literal `~`, `$HOME`, or plugin placeholders. The root and data directories must not contain one another.

4. Run **Developer: Reload Window**. Open **MCP: List Servers**; if it shows servers “for this session,” choose **Show locally configured servers...** at the bottom. Select `cyclecloud-local` under the remote/user configuration and choose **Start**, then **Show Output**. Despite the label “locally,” this list includes WSL remote configurations.
5. In Chat, select **Local** and Agent mode. Enable the server's tools in the tool picker if necessary, then ask:

    > Use the cyclecloud-local MCP server's list_clusters tool to list my clusters. Do not use terminal commands or direct HTTP requests.

Verify an actual tool call and result. This tests the native Local registration, not the agent session's synchronized copy. Tools are neither skills nor Command Palette commands; the three read tools should be available and both lifecycle tools absent.

## Consolidate an older two-file setup

Earlier instructions placed the Local configuration in `~/.local/share/cyclecloud-mcp/`, while Copilot used `~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/`.

If both work today:

1. Stop `cyclecloud-local`.
2. Confirm the Copilot configuration is the one you want both clients to use, including `enableMutations: false`. Review it in an editor outside Chat.
3. Change **only `PLUGIN_DATA`** in your Local MCP registration to the existing Copilot data directory. Do not copy or symlink the credential file; symlinks are rejected.
4. Restart `cyclecloud-local` and verify a read-only tool call.
5. After verification, remove the unused credential copy from `~/.local/share/cyclecloud-mcp/`.

Both clients now read the same configuration. Changing credentials or mutation settings affects both after restart. No automatic migration or deletion is performed by the plugin.

## Update and removal

Marketplace updates replace the bundle at its installed path. Restart `cyclecloud-local` afterward; update the module argument and `PLUGIN_ROOT` if the installation moves.

After a VS Code version fixes #335006, stop `cyclecloud-local`, remove only its MCP entry, re-enable the VS Code plugin, and reload. Check the new host's reported data path before configuring it; it may differ from Copilot's.

When uninstalling the POC, remove this registration before removing the installed bundle, and follow the [credential cleanup instructions](../README.md#update-or-remove). Removing a registration does not delete credentials.
