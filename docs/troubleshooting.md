# Troubleshooting

For normal installation, use the [quick start](../README.md). Installation prepares the plugin and private configuration; it does not establish that credentials or connectivity work. Verify an actual `list_clusters` tool call in a fresh connected agent session.

## Local installation without a checkout dependency

From a development checkout, run `npm run install:local`. To distribute without a checkout, run `npm run package:local`, copy the complete `dist/cyclecloud-mcp/` directory elsewhere, and run its `sh install.sh --local`. A recipient needs Node and Copilot CLI, not npm dependencies or repository access.

The installer copies the package into `~/.local/share/cyclecloud-mcp/marketplace/` and registers that persistent copy as the `cyclecloud-mcp` marketplace. Current Copilot CLI reports this as a **live** installation. VS Code does not discover that live registration: it scans `~/.copilot/installed-plugins/` instead. The installer therefore also maintains an identical copy at `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/`. Copy-based CLI installations use this path directly. Neither copy refers to the input package or development checkout; both read the same credential file. Keep both managed package directories while the plugin is installed, and update them together by rerunning the installer.

Rerunning `--local` installs changed package files and repairs missing ones. Identical payloads are left alone. Existing credentials, their mode, and deliberately disabled plugin state are preserved. The installer never copies source code, `node_modules`, `.git`, or credentials into the managed package.

`--local` explicitly switches this project's known GitHub marketplace installation to the managed local source. It refuses same-name entries from unrelated sources. A no-argument GitHub installation will not silently switch a local installation back.

### Return to the GitHub source

End sessions using this plugin, then explicitly run:

```bash
copilot plugin uninstall cyclecloud-mcp@cyclecloud-mcp
copilot plugin marketplace remove cyclecloud-mcp
copilot plugin marketplace add gingi/cyclecloud-mcp
copilot plugin install cyclecloud-mcp@cyclecloud-mcp
```

These commands install the revision from the GitHub marketplace, not uncommitted local changes. They do not delete the existing credential file. If you deliberately disabled the plugin, disable it again after reinstalling. Once the remote installation works, the unused `~/.local/share/cyclecloud-mcp/marketplace/` and `installation.json` can be removed.

## Server absent or not connected

- Run `copilot plugin list` in the environment where the agent runs. The plugin must be present and enabled. A local install may say **live** rather than **installed**. CLI inventory alone does not prove VS Code discovery: confirm the installed copy exists under `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/`. Rerun the current local installer to create or repair it.
- After installation or a configuration change, run **Developer: Reload Window** before checking **Agent Plugins - Installed**. Plugin discovery and configuration loading are not guaranteed to update an existing session.
- After reloading, ensure **Chat: Plugins Enabled** is on and `cyclecloud-mcp` is enabled in **Agent Plugins - Installed**, then start a fresh connected agent session. The global setting enables the feature, not every individual plugin. VS Code remembers per-plugin disabled state independently of Copilot CLI; the installer does not change VS Code's private enablement database.
- In WSL, install and run the agent in the same distribution. Native Windows is not supported.
- Send a real chat message before diagnosing an idle server: some agent hosts defer runtime startup until the first message.
- Open **MCP: List Servers → cyclecloud → Show Output** for the active session. A model saying a tool is unavailable is not itself a launch diagnostic.
- If output is blank, use **Developer: Open Logs Folder**. Agent-host launches report MCP inventory/errors in `agenthost.log`; native launches use the window's `mcpServer` log.
- A cloud-hosted agent does not automatically have files or credentials installed on your workstation. Install in the environment running the agent; cloud execution has not been verified for this POC.

## Installer download options

The [README one-liner](../README.md#1-install-and-configure) streams `install.sh` from `main` to `sh`. Use Bash or Zsh for the outer `pipefail` option. The script is POSIX shell and uses Node; it does not need `jq`, Python, npm installation, or sudo.

**Inspect-first alternative:** download `install.sh` from a reviewed commit SHA, inspect it, then run `sh install.sh`. Unlike a commit SHA, `main` can change. Pinning the installer does not pin a fresh remote plugin installation: Copilot uses its registered marketplace catalog. Use the self-contained local package to install an unpublished revision.

If the repository is private, raw `curl` access may fail even when Copilot or Git is authenticated. Use an authenticated checkout or a trusted local package; do not embed tokens in download URLs.

## Installer failures and reruns

- **Dependencies or OS:** use a supported Node version and Copilot CLI 1.0.81 or later on Linux, macOS, or WSL. Do not use `node.exe` inside WSL. The installer does not install dependencies, upgrade the CLI, or use sudo.
- **CLI commands fail:** check plugin support and source access. Authenticate separately if using GitHub; local packages require no GitHub marketplace download. The installer never prompts for credentials.
- **Conflicting source:** inspect `copilot plugin marketplace list` and `copilot plugin list`. Resolve unrelated same-name entries explicitly; the installer will not replace them.
- **Unsafe configuration or destination:** inspect ownership, file type, and permissions outside Chat. Symlinks and group/world-writable managed destinations are refused rather than automatically repaired.
- **Partial installation:** completed steps are kept. Resolve the error and rerun the same command. A local installation receipt preserves a disabled choice across source-switch retries; do not delete it during recovery. Credentials are never rolled back or overwritten.
- **Incomplete local package:** recopy the complete packaged directory. The installer validates the required files before changing registrations.
- **Missing configuration template:** reinstall a complete plugin package, then rerun the installer. Rerunning the remote installer alone does not replace an installed package.
- **Custom Copilot paths:** this installer targets default HOME-based paths and rejects a different `COPILOT_HOME`. Do not mix home directories between installation and the agent.

## Manual installation

If you do not want the installer, register the remote marketplace and install the plugin yourself:

```bash
copilot plugin marketplace add gingi/cyclecloud-mcp
copilot plugin install cyclecloud-mcp@cyclecloud-mcp
copilot plugin list
```

Skip commands for entries you already have. For independent local installation, use `--local` rather than registering the development checkout directly.

### Prepare configuration

For a default remote installation, copy the packaged template privately:

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

This refuses to overwrite existing configuration. Edit the URL and credentials outside Chat and keep `enableMutations: false`. The installer performs this step for both remote and local installations.

## Configuration and connection errors

Tool calls check reachability through their actual CycleCloud request, without a separate preflight request. Connection refusal, DNS failures, unreachable hosts/networks, and connection-establishment timeouts return `cyclecloud_unreachable`: check that the instance is running, the configured URL is correct, and network/VPN access is available before retrying. Authentication, TLS validation, HTTP service errors, and general request timeouts remain distinct; an interrupted lifecycle request can still have an unknown outcome.

| Symptom                        | Check                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configuration_missing`        | Open the exact path reported by the server. Rerun the installer to prepare configuration without launching the server.                                         |
| Missing configuration template | Reinstall a complete plugin package, then rerun the installer.                                                                                                 |
| `plugin_environment_invalid`   | The data directory must exist outside the installed package. Check any explicit `PLUGIN_DATA` override; an invalid override does not fall back to the default. |
| Credential file rejected       | Check ownership, mode `0600` or `0400`, regular-file type, and symlink status. Do not share its contents in Chat.                                              |
| TLS failure                    | Check hostname/SAN and use `caCertPath` for a private CA. Do not disable verification for a remote host.                                                       |
| Node cannot launch             | A supported Node must be on the executable search path of the agent's environment.                                                                             |
| Lifecycle tools absent         | Intended default. Do not enable mutations just to complete setup.                                                                                              |
| Action outcome unknown         | Inspect cluster status before retrying.                                                                                                                        |

If the configuration file is missing but its directory exists, server startup still attempts to create a secret-free `cyclecloud.example.json` there with mode `0600`. It never overwrites an existing example. This is a fallback, not a required onboarding step.

Local-package and remote-marketplace installations share `~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json`. Configure that file outside Chat; no second credential copy is needed.

See the [configuration and security reference](configuration.md) for all options.
