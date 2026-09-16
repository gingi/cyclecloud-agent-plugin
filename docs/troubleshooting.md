# Troubleshooting

For normal installation, use the [quick start](../README.md). Installation prepares the plugin and private configuration; it does not establish that credentials or connectivity work. Verify an actual `list_clusters` tool call in a fresh connected agent session.

## Local installation without a checkout dependency

From a development checkout, run `npm run install:local`. To distribute without a checkout, run `npm run package:local`, copy the complete `dist/cyclecloud-mcp/` directory elsewhere, and run its `sh install.sh --local`. A recipient needs Node and Copilot CLI, not npm dependencies or repository access.

The installer copies the package into `~/.local/share/cyclecloud-mcp/marketplace/` and registers that persistent copy as the `cyclecloud-mcp` marketplace. Current Copilot CLI reports this as a **live** installation. VS Code does not discover that live registration: it scans `~/.copilot/installed-plugins/` instead. The installer therefore also maintains an identical copy at `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/`. Copy-based CLI installations use this path directly. Neither copy refers to the input package or development checkout; both read the same credential file. Keep both managed package directories while the plugin is installed, and update them together by rerunning the installer.

Rerunning `--local` installs changed package files and repairs missing ones. Identical payloads are left alone. Configuration prompts use existing values as defaults, mask the saved password, and hide password input. Enter keeps a value; other settings, the file's private mode, and deliberately disabled plugin state are preserved. Use `--skip-config` to leave existing configuration unread and unchanged. The installer never copies source code, `node_modules`, `.git`, or credentials into the managed package.

Release archives and development packages use this same installation path. Running the packaged `sh install.sh` defaults to the adjacent package; `--local [package-directory]` selects a package explicitly. If an old development installation uses this project's known GitHub marketplace source, the installer switches it to the managed package while retaining credentials and disabled state. It refuses same-name entries from unrelated sources.

### Return to a released version

End sessions using this plugin, download and verify the desired release in a fresh directory, extract it, and run `sh cyclecloud-mcp/install.sh --skip-config`. Reload VS Code and start a new agent session. This replaces both runtime copies without deleting credentials or changing a deliberately disabled state. The GitHub source repository is **not** an installable marketplace: it has no generated bundle. Do not switch back to direct repository installation.

## Server absent or not connected

- Run `copilot plugin list` in the environment where the agent runs. The plugin must be present and enabled. A local install may say **live** rather than **installed**. CLI inventory alone does not prove VS Code discovery: confirm the installed copy exists under `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/`. Rerun the current local installer to create or repair it.
- After installation or a configuration change, start a new agent session in VS Code or Copilot CLI. In VS Code, run **Developer: Reload Window** before checking **Agent Plugins - Installed**. Plugin discovery and configuration loading are not guaranteed to update an existing session.
- In VS Code, ensure **Chat: Plugins Enabled** is on and `cyclecloud-mcp` is enabled in **Agent Plugins: Installed**, then approve any access prompt and start a new agent session. The global setting enables the feature, not every individual plugin. VS Code remembers per-plugin enablement and access state independently of Copilot CLI; the installer cannot safely change VS Code's private state database.
- If `agenthost.log` says `Failed to sync plugin ... Access ... is not granted`, VS Code discovered the installation but could not read it through the agent-host file-access service. This can happen even when the plugin is enabled and no approval prompt appears; see [WSL/remote Agent Host plugin-sync failures](#wslremote-agent-host-plugin-sync-failures).
- In WSL, install and run the agent in the same distribution. Native Windows is not supported.
- Send a real chat message before diagnosing an idle server: some agent hosts defer runtime startup until the first message.
- Open **MCP: List Servers → cyclecloud → Show Output** for the active session. A model saying a tool is unavailable is not itself a launch diagnostic.
- If output is blank, use **Developer: Open Logs Folder**. Agent-host launches report MCP inventory/errors in `agenthost.log`; native launches use the window's `mcpServer` log.
- A cloud-hosted agent does not automatically have files or credentials installed on your workstation. Install in the environment running the agent; cloud execution has not been verified for this POC.

### WSL/remote Agent Host plugin-sync failures

An enabled plugin can still fail to load into a VS Code agent session. In VS Code Insiders `1.138.0-insider` on WSL, the following error was observed before the installed MCP server started:

```text
[AgentPluginManager] Failed to sync plugin
file:///home/<user>/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp:
Access ... is not granted.
```

Plugin enablement and the agent host's file-access grants are separate. This error path rejects the read without opening an approval prompt; it does not necessarily mean the user missed a trust dialog. Reinstalling, toggling enablement, or changing filesystem permissions does not address a URI-translation defect.

Inspection of that build identified a suspected WSL URI mismatch: the client grants access to a `vscode-remote://…` plugin URI, the transport sends it to the host as `file:///home/…`, and the reverse file request is not translated back to the granted URI. This was established by code inspection, not an end-to-end reproduction of the proposed cause.

**Workaround to try:** run `copilot` directly in a WSL terminal in the distribution where the plugin is installed, then ask it to use the registered `list_clusters` tool. This avoids VS Code's plugin-sync transport. A terminal command that constructs an MCP client and launches the development checkout is not verification of the installed plugin, even if it returns clusters.

If reporting the issue upstream, include the VS Code version and commit, WSL distribution, enabled-plugin state, and redacted `agenthost.log` sync error. Describe the URI mismatch as a suspected cause. Do not include the credential file.

## Installer download options

The README curl command downloads the **release asset** `install.sh`, a bootstrap that fetches and verifies its pinned package before installing. To select an exact release or prerelease, replace the version in this command:

```bash
(set -o pipefail; curl -fsSL https://github.com/gingi/cyclecloud-mcp/releases/download/v0.1.0/install.sh | sh)
```

Add `sh -s -- --skip-config` instead of `sh` to preserve configuration without prompts. The bootstrap requires curl and tar, cleans up temporary downloads, and never falls back to the repository's default branch. The source repository's `install.sh` is a different script that requires an adjacent built package. Until the first release exists, release URLs return 404; use a development workflow artifact or build from source.

For inspect-first or offline installation, download **all three** assets (`cyclecloud-mcp-<version>.tar.gz`, `install.sh`, and `SHA256SUMS`) from the same [GitHub Release](https://github.com/gingi/cyclecloud-mcp/releases). The automatic **Source code** archives are not installable. With GitHub CLI:

```bash
gh release download v0.1.0 --repo gingi/cyclecloud-mcp \
    --pattern 'cyclecloud-mcp-*.tar.gz' --pattern install.sh --pattern SHA256SUMS \
    --dir cyclecloud-mcp-release
```

Use a fresh directory for each download. From that directory, verify with `shasum -a 256 -c SHA256SUMS` (or `sha256sum -c SHA256SUMS` on Linux/WSL), then extract the matching archive. Review the package before running `sh cyclecloud-mcp/install.sh`. The installed plugin comes entirely from that archive, not the repository's current default branch. Keep `SOURCE_COMMIT.json` when sharing packages to retain their source identity.

This repository's release bootstrap and post-release workflow assume public, anonymously downloadable assets. If using a private fork, download all assets through an authenticated browser or `gh`, then use the extracted package's installer offline; the public curl verification workflow would need adapting. Do not embed tokens in download URLs. After download and extraction, package installation needs only Node and Copilot CLI, not repository access, npm dependencies, `jq`, Python, or sudo.

## Installer failures and reruns

- **Dependencies or OS:** use a supported Node version and Copilot CLI 1.0.81 or later on Linux, macOS, or WSL. Do not use `node.exe` inside WSL. The installer does not install dependencies, upgrade the CLI, or use sudo.
- **CLI commands fail:** check plugin support and source access. Authenticate separately if using GitHub; local packages require no GitHub marketplace download. The installer prompts only for CycleCloud configuration, never GitHub authentication.
- **Conflicting source:** inspect `copilot plugin marketplace list` and `copilot plugin list`. Resolve unrelated same-name entries explicitly; the installer will not replace them.
- **Unsafe configuration or destination:** inspect ownership, file type, and permissions outside Chat. Symlinks and group/world-writable managed destinations are refused rather than automatically repaired.
- **Partial installation:** completed steps, including any configuration saved before plugin installation, are kept. Resolve the error and rerun the same command; Enter keeps saved values, or `--skip-config` bypasses the prompts. A local installation receipt preserves a disabled choice across source-switch retries; do not delete it during recovery.
- **Configuration prompts:** the installer uses the controlling terminal, independently of stdin. Ctrl-C or Ctrl-D cancels without saving partial answers. Invalid JSON is left untouched; repair it outside Chat or use `--skip-config`. The prompts check URL and credential syntax and validate the URL against the preserved transport settings, but do not test connectivity or authentication. An invalid transport combination stops setup without saving; use a compatible URL (prefer verified HTTPS) or explicitly edit the conflicting settings outside Chat and rerun. See the [transport policy](configuration.md#transport-policy).
- **Unattended installation:** add `--skip-config` (also works with `--local`). If passing the script through stdin, supply the package explicitly with `sh -s -- --local /path/to/package --skip-config`. When no terminal is available this behavior is automatic: existing configuration stays unread and unchanged; a missing file is populated with the private template after installation and must be edited before use.
- **Incomplete local package:** recopy the complete packaged directory. The installer validates the required files before changing registrations.
- **Missing configuration template:** download or rebuild a complete package, then rerun its installer. Source-only downloads are not installable.
- **Custom Copilot paths:** this installer targets default HOME-based paths and rejects a different `COPILOT_HOME`. Do not mix home directories between installation and the agent.

## Manual installation

Use the packaged installer for supported installation: it maintains both the CLI marketplace and the VS Code-discoverable runtime copy. Registering an extracted package directly can leave a live CLI registration that VS Code does not discover, and deleting that download can break the installation. Registering the GitHub source repository does not fetch release assets.

To configure manually rather than answer prompts, run `sh cyclecloud-mcp/install.sh --skip-config`, then edit the private configuration file outside Chat. The recovery command below is useful if configuration was subsequently removed.

### Prepare configuration

For an installed package with missing configuration, copy the packaged template privately:

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

This refuses to overwrite existing configuration. Edit the URL and credentials outside Chat and keep `enableMutations: false`. With `--skip-config` or no terminal, the installer performs this template-only step for both release and development installations; otherwise it prompts and saves configuration before installing the plugin.

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

Release and development installations share `~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json`. Configure that file outside Chat; no second credential copy is needed.

See the [configuration and security reference](configuration.md) for all options.
