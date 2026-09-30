# Troubleshooting

Start with the [quick start](../README.md). Diagnose host skill discovery, local CLI compatibility, and the actual read request separately. Contributor checks are covered under [development verification](#development-verification); failed release steps are covered under [release troubleshooting](#release-troubleshooting-maintainers).

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

| Error/state                  | Check                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configuration_required`     | Run CLI initialization separately or select an existing `--config PATH`; do not paste its contents                                                    |
| `authentication_required`    | Use **`cyclecloud initialize --force`** for an existing configuration; see [reinitialization guidance](#reinitialize-after-an-authentication-failure) |
| `unsupported_authentication` | The 8.10 adapter does not recognize that configuration; use a supported setup or verified native inspection                                           |
| `permission_denied`          | Intended account, cluster/group scope and required internal read permissions                                                                          |
| `network_error`              | Instance/identity endpoint, VPN, proxy, hostname and trusted CA settings                                                                              |
| `upstream_error`             | Service/identity failure or an unexpected redirect; do not treat it as missing CLI                                                                    |
| `invalid_response`           | Unexpected/malformed/oversized backend data; do not work around it with raw dumps                                                                     |
| `timeout`                    | Service availability and request scope; output is not proof of an empty result                                                                        |
| `output_limit`               | Request smaller supported limits/sections; no partial JSON should be used                                                                             |

Use verified HTTPS remotely. The bridge preserves the CLI's configured transport policy, so an insecure existing CLI configuration remains insecure. It does not silently disable verification or accept certificates. Identity sessions do not inherit CycleCloud credentials or its insecure override.

A successful `status` with `issues.available: false` means issue evidence was unavailable, not that the cluster is healthy. Likewise, missing storage/spec/platform evidence must remain unknown. Follow paging cursors only where needed, and re-read before making changes because pages are not an atomic snapshot.

### Reinitialize after an authentication failure

If an existing configuration fails authentication, confirm the intended CycleCloud instance and account, then run **`cyclecloud initialize --force`** in your own interactive terminal:

```sh
cyclecloud initialize --force
```

Plain `cyclecloud initialize` can report “CycleCloud is configured properly” just because the configuration loads; it does not validate the stored credentials. **`--force` reruns setup and may modify the active profile.** Use the same CLI and intended configuration as inspection, enter credentials only in the terminal prompts, and retry inspection after setup succeeds. Do not run the setup wizard through an agent's noninteractive shell tool.

For missing configuration, use plain `cyclecloud initialize` or select an existing `--config PATH`. Do not treat authentication, permission, or network failures as a reason to reinstall the CLI. Inspection allows normal silent refresh, but never browser/device-code interaction or credential prompts.

## Source packages and updates

Register a reviewed source checkout or complete extracted source package in a persistent location. No build or dependency installation is needed. A source archive is useful offline; retain `SOURCE_COMMIT.json` when supplied. Verify release checksums and source identity before registration; checksums are not publisher signatures.

For repository installations, use host-native update mechanisms. For local live sources, update the intended directory and refresh the host. Do not overwrite unknown same-name installations or enable a deliberately disabled plugin as an update shortcut.

Use the host's plugin installation and removal commands. Removing the plugin leaves CLI credentials intact.

## Authoring validator

Inspection does not need Node, but `validate-project.mjs` does. It also needs Bash for parse-only checks. Missing Node/Bash or a syntax-check timeout is a failure, not permission to claim validation succeeded. The shipped skeleton intentionally fails until TODOs and script stubs are completed; a passing structural check does not certify installation, MPI compatibility or Slurm execution.

## Development verification

Follow [setup and verification](development.md#setup-and-verification) for the normal contributor checks. Python tests that require `requests` are skipped when it is unavailable; run with the bundled CLI Python to exercise those tests. This does not opt into testing an installed CLI artifact: use the separate [explicit packaged-CLI smoke](development.md#explicit-packaged-cli-smoke) procedure for that.

## Release troubleshooting (maintainers)

The normal release workflow is in [releases and previews](development.md#releases-and-previews). Identify the failed stage before retrying: publication may already have succeeded even when the overall workflow failed. Preserve published releases, tags, assets, and `stable` history; fixes to published source require a new version.

### Preparation

A new preparation branch requires a clean checkout and an unused version. Existing branches are not reset; inspect and switch to the matching preparation branch to resume. Rerunning there preserves review edits, including uncommitted changes. Resolve fetch/authentication failures before retrying. If writes fail after branch creation, retain the branch/files for inspection and repair.

Existing changelog entries are preserved rather than regenerated. To regenerate a draft, first save any edits and remove only that version's entry, then rerun preparation on the matching branch.

### Local tagging

Mismatched versions/notes, off-main stable-release sources, dirty checkouts, failed verification, or a source that does not advance the previous release stop tagging. Existing release tags are reused only for the same selected source and exact tree; conflicting tags are never moved. Retries preserve a matching annotated or lightweight tag's commit and annotation.

If a push fails, the local tag and release commit remain: fix the cause and retry `npm run release:tag -- <version> --push` from the same source checkout. A changed `stable` base is rejected before pushing a pending tag; if `stable` has advanced to a different base, prepare a new version rather than retargeting the pending tag. A matching tag already on origin is neither changed nor pushed again.

### Validation or build failed

No release was created. Rerun the original failed jobs for transient failures. If the tagged source needs changes, commit a fix and use a new version/tag; do not move the old tag.

### Publication failed

Inspect GitHub first. An upload failure may leave a draft that automation refuses to overwrite. After inspection, either finish that draft manually using verified assets, or explicitly delete only the incomplete draft (keep the tag) and rerun publishing. If transfer artifacts expired, rerun the original workflow. If publication actually succeeded, verify the existing release instead of publishing again.

### Public release verification

If a post-release check failed, the release is already public, not rolled back, and `stable` is not promoted. Rerun failed jobs for transient failures; package defects require a new version, not replacement assets or a moved tag.

When checking an existing release locally, use a separate clean checkout of its exact tag with its own verification dependencies and harness. `verify-release.mjs` delegates to `verify-package.mjs`, which compares full source bytes against its own checkout; verifying a historic release from changed `main` is invalid. Run `npm ci --ignore-scripts`, then:

```sh
npm run verify:release -- <tag> <full-tagged-commit-sha>
```

Append `--latest` only for the current latest stable release. Verification uses isolated storage, not your installed plugin or credentials.

### Promotion failed

Leave the published release and tag intact. Inspect permissions, [branch protections](development.md#repository-settings), ancestry, or the API failure, then rerun **only the failed promotion job** (or rerun failed jobs), not all jobs: the publisher intentionally rejects existing releases. Concurrent ref creation/update rejection fails safely and is rerunnable without forced recovery; a retry for an older release cannot roll back `stable`.

If divergence requires source changes, release a new version rather than rewriting `stable` ancestry. A manual helper retry requires successful public verification evidence for the same tag/SHA; follow the procedure below.

### Manual stable promotion

Workflow reruns use the workflow and helper from the tagged commit, not updated tooling from `main`. To promote an existing release with a reviewed helper:

1. From a clean checkout of the exact tag, complete [public release verification](#public-release-verification). Record successful verification for that tag/SHA. Include `--latest` only for the current latest stable release.
2. From the reviewed tooling checkout, run:

    ```sh
    GH_REPO=gingi/cyclecloud-agent-plugin npm run release:promote -- <tag> <full-tagged-commit-sha>
    ```

    This is a remote write requiring authorization and a token with repository contents write access. The helper checks identity, release metadata, and ancestry but **does not independently run public verification**. It creates/advances `stable` to the existing release tag; it never creates commits or changes tags, releases, assets, repository settings, or existing history. Configure branch protections separately as described in [repository settings](development.md#repository-settings).
