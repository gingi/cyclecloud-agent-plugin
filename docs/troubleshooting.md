# Troubleshooting

Start with the [quick start](../README.md). Diagnose host skill discovery, local CLI compatibility, and the actual read request separately.

## Host discovery

- In Copilot CLI, inspect `copilot plugin list --json` and `copilot plugin marketplace list`. Confirm the `cyclecloud` identity and intended source; resolve unrelated same-name sources explicitly.
- A local marketplace can be a **live directory**, not a copy under `~/.copilot/installed-plugins/`. Keep that directory in place. Deleting a temporary extraction directory can break the registration.
- In VS Code, enable `chat.plugins.enabled` and inspect **Agent Plugins - Installed** or **Chat: Open Customizations → Plugins**. Individual enablement/access choices are separate from the feature-wide setting.
- For a persistent local checkout/package, register its absolute path through `chat.pluginLocations`. Set its value to `false` if intentionally disabled. Merge settings rather than replace unrelated entries.
- For a repository, use **Chat: Install Plugin From Source** or a supported `chat.plugins.marketplaces` entry. Local marketplace entries use `file:///` URIs. The [VS Code documentation](https://code.visualstudio.com/docs/copilot/customization/agent-plugins) describes these supported surfaces and CLI-installed-copy discovery.
- Reload the window/start a new agent session after changing source or enablement. Use **Chat: Configure Skills** to check skill discovery.
- WSL, remote workspaces and cloud agents run in their own environments. A desktop installation or PATH is not automatically available there. Do not use a Windows CLI executable from a WSL inspection helper.

### Access or plugin-sync failures

If `agenthost.log` reports `Failed to sync plugin ... Access ... is not granted`, the host discovered a source but could not read it. Enablement and file-access grants are separate. Check supported trust/access UI, the path/URI's execution environment and the host version. Do not modify private state databases or broadly loosen filesystem permissions.

Compare with a terminal Copilot CLI session in the same WSL distribution to help isolate host-specific discovery or access failures. If the problem persists, report the host version, execution environment, source path or URI, and redacted error message. Never include credentials.

## CLI discovery and compatibility

```sh
sh "<installed-plugin-root>/scripts/cyclecloud-inspect" capabilities
```

The launcher uses absolute `CYCLECLOUD_CLI`, otherwise PATH. Run from the same environment as the agent. If the terminal finds a CLI but VS Code does not, restart the host or provide the explicit executable path in its environment. Do not scan the filesystem or substitute an unrelated Python interpreter.

Compatibility errors from the Python launcher include the resolved executable path (after following symlinks) and the version reported by its offline `--version` probe. If installation verification or version parsing fails before a version can be established, the message says the reported version could not be determined; it never echoes raw probe output. For example: `Selected CLI "/usr/local/cyclecloud-cli/embedded/bin/cyclecloud": reports version "8.9.0-SNAPSHOT". This CLI is unsupported. Use official CycleCloud 8.10.x or a contract-compatible newer CLI.`

| Error/state           | Check                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_cli`         | Correct absolute override, executable permissions or PATH; offer opt-in official installation                                            |
| `unsupported_cli`     | Supported 8.10 family for the bridge, or a compatible native schema; do not infer feature support solely from a version                  |
| `unsupported_layout`  | Official embedded/virtualenv layout and intact CLI dependencies; avoid editable wrappers or the separate API SDK in the same environment |
| `incompatible_schema` | Required schema major and read commands; update deliberately rather than scrape human tables                                             |
| `invalid_arguments`   | `--help`, exact quoted names, bounds and one-target details; `--section` is invalid with overview                                        |

The fallback is only for a recognized missing native command on supported 8.10. Native errors or malformed capability output never switch backends. An explicit invalid override never silently falls back to PATH. See [configuration and guided installation](configuration.md); a dependency check does not download, install, initialize, upgrade or request credentials.

## Authentication, permissions and transport

| Error/state                  | Check                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `configuration_required`     | Run CLI initialization separately or select an existing `--config PATH`; do not paste its contents                   |
| `authentication_required`    | Complete interactive CLI login outside chat; valid silent refresh is allowed, browser/device-code interaction is not |
| `unsupported_authentication` | The 8.10 adapter does not recognize that configuration; use a supported setup or verified native inspection          |
| `permission_denied`          | Intended account, cluster/group scope and required internal read permissions                                         |
| `network_error`              | Instance/identity endpoint, VPN, proxy, hostname and trusted CA settings                                             |
| `upstream_error`             | Service/identity failure or an unexpected redirect; do not treat it as missing CLI                                   |
| `invalid_response`           | Unexpected/malformed/oversized backend data; do not work around it with raw dumps                                    |
| `timeout`                    | Service availability and request scope; output is not proof of an empty result                                       |
| `output_limit`               | Request smaller supported limits/sections; no partial JSON should be used                                            |

Use verified HTTPS remotely. The bridge preserves the CLI's configured transport policy, so an insecure existing CLI configuration remains insecure. It does not silently disable verification or accept certificates. Identity sessions do not inherit CycleCloud credentials or its insecure override.

A successful `status` with `issues.available: false` means issue evidence was unavailable, not that the cluster is healthy. Likewise, missing storage/spec/platform evidence must remain unknown. Follow paging cursors only where needed, and re-read before making changes because pages are not an atomic snapshot.

## Source packages and updates

Register a reviewed source checkout or complete extracted source package in a persistent location. No build or dependency installation is needed. A source archive is useful offline; retain `SOURCE_COMMIT.json` when supplied. Verify release checksums and source identity before registration; checksums are not publisher signatures.

For repository installations, use host-native update mechanisms. For local live sources, update the intended directory and refresh the host. Do not overwrite unknown same-name installations or enable a deliberately disabled plugin as an update shortcut.

Use the host's plugin installation and removal commands. Removing the plugin leaves CLI credentials intact.

## Authoring validator

Inspection does not need Node, but `validate-project.mjs` does. It also needs Bash for parse-only checks. Missing Node/Bash or a syntax-check timeout is a failure, not permission to claim validation succeeded. The shipped skeleton intentionally fails until TODOs and script stubs are completed; a passing structural check does not certify installation, MPI compatibility or Slurm execution.
