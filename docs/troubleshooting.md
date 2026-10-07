# Troubleshooting

Start with the [quick start](../README.md). Diagnose host skill discovery, local CLI compatibility, and the actual read request separately. Contributor checks are covered under [development verification](#development-verification); failed release steps are covered under [release troubleshooting](#release-troubleshooting-maintainers).

## Host discovery

- In Copilot CLI, inspect `copilot plugin list --json` and `copilot plugin marketplace list`. Confirm the `cyclecloud` identity and intended source; resolve unrelated same-name sources explicitly.
- A local marketplace can be a **live directory**, not a copy under `~/.copilot/installed-plugins/`. Keep that directory in place. Deleting a temporary extraction directory can break the registration.
- In VS Code, enable `chat.plugins.enabled` and inspect **Agent Plugins - Installed** or **Chat: Open Customizations → Plugins**. Individual enablement/access choices are separate from the feature-wide setting.
- For a persistent local checkout/package, register its absolute path through `chat.pluginLocations`. Set its value to `false` if intentionally disabled. Merge settings rather than replace unrelated entries.
- For a repository, use **Chat: Install Plugin From Source** or a supported `chat.plugins.marketplaces` entry. Local marketplace entries use `file:///` URIs. The [VS Code documentation](https://code.visualstudio.com/docs/copilot/customization/agent-plugins) describes these supported surfaces and CLI-installed-copy discovery.
- Reload the window/start a new agent session after changing source or enablement. Use **Chat: Configure Skills** to check skill discovery.
- WSL, remote workspaces and cloud agents run in their own environments. A desktop installation or PATH is not automatically available there. Select a CLI supported by the environment executing the command; do not assume cross-platform executable compatibility.

### Access or plugin-sync failures

If `agenthost.log` reports `Failed to sync plugin ... Access ... is not granted`, the host discovered a source but could not read it. Enablement and file-access grants are separate. Check supported trust/access UI, the path/URI's execution environment and the host version. Do not modify private state databases or broadly loosen filesystem permissions.

Compare with a terminal Copilot CLI session in the same WSL distribution to help isolate host-specific discovery or access failures. If the problem persists, report the host version, execution environment, source path or URI, and redacted error message. Never include credentials.

## CLI discovery and compatibility

```sh
cyclecloud --help --format json
cyclecloud show_nodes --help --format json
```

Use the selected absolute `CYCLECLOUD_CLI` executable when supplied, otherwise resolve PATH in the agent's environment. An invalid override does not fall back to another installation. If a terminal finds the CLI but the host does not, restart the host or supply its explicit executable path. Do not scan the filesystem or import private CLI Python modules.

| Symptom                                   | Check                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Executable missing                        | Intended absolute path, permissions and agent PATH; offer opt-in installation                            |
| Help is text or exits 1                   | Older help behavior; consult targeted text help rather than treating this alone as a missing command     |
| JSON descriptor has an unknown contract   | Mark capability unknown; consult matching documentation before relying on it                             |
| Help supports JSON but execution does not | Inspect the leaf's options and execution `outputs`; output support is per command/mode                   |
| Required evidence is absent               | State the specific gap and offer manual/upgrade/offline guidance, not an API fallback                    |
| `invalid_arguments`                       | Actual leaf help, exact quoted target names and flag conflicts; do not invent proposed view/paging flags |

Include the selected executable path and reported version when explaining compatibility; do not guess missing versions or infer a released capability from a snapshot number. Discovery is local and does not validate login/server access. See [CLI contracts](cli-contract.md) and [guided setup](configuration.md).

## Authentication, permissions and transport

`cyclecloud.error.v1` applies only to explicit JSON help failures: sanitized JSON on stderr, empty stdout, and `invalid_arguments`, `internal_error` or `cancelled`. JSON help succeeds with exit 0, fails with 1, or cancels with 130; unsupported non-JSON help formats and ordinary option errors may use text errors and status 2.

Cluster JSON, kind-selected node and Event Log data failures use safe text stderr/nonzero status, with no partial JSON document. Their setup/authentication paths still retain legacy behavior. Node execution without `--kind` retains legacy behavior throughout. Do not parse execution stderr using the help error contract or forward raw server bodies/credentials into reports. The following are symptoms to diagnose, not guaranteed machine-readable execution codes:

| Symptom                                             | Check                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Missing/invalid configuration                       | Initialize separately or select the intended existing config; do not paste its contents                                  |
| Authentication failure or interactive login request | Confirm instance/account; stop the unattended operation and use the interactive recovery below                           |
| Permission denial                                   | Intended identity, cluster/group scope and required read permissions                                                     |
| Network failure or timeout                          | Intended endpoint, relevant VPN/routes, proxy, hostname, trusted CA and request scope                                    |
| Resource not found                                  | Exact requested resource and configuration; do not interpret it as an empty inventory                                    |
| Unsupported operation/mode                          | Local command capability versus connected-server requirements                                                            |
| Text when JSON was expected                         | Check whether nonempty `--output` selected custom text; otherwise treat malformed/unexpected output as unusable evidence |
| Cancellation or incomplete response                 | The operation did not complete; do not silently retry, switch backend or infer success from exit status alone            |

Do not reinstall, change identity or use raw API calls to work around permission/authentication/network failures. Use verified HTTPS; the CLI retains its configured transport/retry/timeout behavior and the plugin adds no isolation or bounds. Never weaken certificate checks to fix connectivity.

Missing storage/spec/platform/issue evidence remains unknown, not proof of an empty configuration or healthy cluster. Host-truncated output is incomplete. Follow only documented pagination where supported and re-read before consequential changes.

### Cluster counts or continuation unavailable

Inventory `definitionCounts.status: notRequested` means counts were not fetched; select a relevant cluster and request named detail. Partial detail may preserve a known array count with null standalone count. Unavailable counts are unknown, not zero; explain the reason and do not query an alternate backend. These counts cover readable persisted definitions, not all hidden resources.

Use `page.nextCursor` unchanged with the same endpoint/configuration and template filter. A Unicode collation-boundary failure returns no JSON/cursor: propose a larger `--limit` up to 200 or an exact named lookup, using stored spelling/case for non-ASCII names. A byte-limited tied group may still prevent paging at a larger row limit. Do not fabricate a cursor, bypass the guard or call the failed listing complete. Named detail rejects paging flags; JSON also rejects `--long` and `--recursive`.

### Node selection and kind-mode conflicts

Bounded discovery requires `--cluster`, explicit `--kind definition|concrete` and `--format json`. Without kind, JSON retains the unbounded legacy body/behavior. Do not mix kind mode with raw attribute/custom-output/filter/long/summary/credential/state options. Failure/array filters apply only to concrete collections; exact NAME rejects them and paging options. A missing exact target is an error, not an empty successful collection.

A stored failure filter is not comprehensive health evidence, and a concrete target can exist while Off with no VM. Null fields remain unknown. Definition discovery can select authoring identities but cannot supply roles, images, environment or attachments. Keep the endpoint, cluster, kind and filters consistent when using an opaque continuation; cluster and node cursors are not interchangeable.

### Selected-node diagnostics unavailable or incomplete

`--diagnostics` requires exact NAME, cluster, concrete kind and JSON. It rejects collection paging/failure/array filters and raw projection/output options. `--detail-limit` is a 1–100 preview limit, not upstream condition paging. No completed history or event stream is included.

If that contract is absent or unknown, follow [limited state, then stop](node-diagnostics.md#when-rich-diagnostics-are-unavailable): at most one supported exact-node state projection, then a capability-gap summary. Do not approve `--long` or additional phase/configuration projections to compensate. If only Event Log is missing, retain supported diagnostics and explain that separate gap.

Check each section's status, scope and completeness, not just empty items. Unavailable phases/conditions have null totals/truncation and a reason; available emptiness has total zero/truncated false. `workLimit` or `responseTooLarge` is not permission to fetch a full PhaseMap or raw condition payload. A larger preview cannot recover unavailable upstream evidence. A wrong identity or association anywhere is fatal, including outside the preview.

VM `notAssociated` records a missing current link, not proof of no VM. Cached running/provisioning observations do not establish installation readiness. Text may be clipped or sensitive; `clippedFields` does not guarantee redaction. See [diagnostic evidence](node-diagnostics.md#read-stored-diagnostics-for-one-selected-node) before escalating to separately authorized logs or live checks.

### Event Log missing, empty or incomplete

Discover `show_events --help --format json` and `cyclecloud.cluster-events.v1` before executing. On an older CLI, retain legitimate node reads and explain the missing event capability; do not fabricate event flags or use raw queries. A denied or failed primary event read is nonzero, not a successful empty log. Follow the authentication/certificate guidance above, without changing identity, retrying another output mode or running an unattended login.

For an old failure, specify both timezone-aware `--since` and `--until` around recorded phase timestamps. The default until is invocation time, and the maximum interval width is seven days, not a historical-age limit. A recent window cannot establish what happened around an older incident. Empty results are scoped by readable cluster, window and priority selection; default exclusion of low priority still includes informational recovery.

If `truncated` is true, consider a narrower relevant window or a larger `--limit` up to 200. There is no cursor, total or node filter. Preserve cluster-wide/unattributed recovery events and do not infer node causation from timing. Clipped messages are not redacted. See [failure correlation](node-diagnostics.md#correlate-the-cluster-event-log-with-a-selected-failure).

### Reinitialize after an authentication failure

If an existing configuration fails authentication, confirm the intended CycleCloud instance and account, then run **`cyclecloud initialize --force`** in your own interactive terminal:

```sh
cyclecloud initialize --force
```

Plain `cyclecloud initialize` can report “CycleCloud is configured properly” just because the configuration loads; it does not validate the stored credentials. **`--force` reruns setup and may modify the active profile.** Use the same CLI and intended configuration as inspection, enter credentials only in the terminal prompts, and retry inspection after setup succeeds. Do not run the setup wizard through an agent's noninteractive shell tool.

For missing configuration, use plain `cyclecloud initialize` or select an existing `--config PATH`. Do not treat authentication, permission or network failures as a reason to reinstall. `show_nodes --format json` retains existing interactive authentication and token persistence behavior. Keep login in the user's terminal rather than retrying a different output mode or supplying credentials through the agent.

## Source packages and updates

Register a reviewed source checkout or complete extracted source package in a persistent location. No build or dependency installation is needed. A source archive is useful offline; retain `SOURCE_COMMIT.json` when supplied. Verify release checksums and source identity before registration; checksums are not publisher signatures.

For repository installations, use host-native update mechanisms. For local live sources, update the intended directory and refresh the host. Do not overwrite unknown same-name installations or enable a deliberately disabled plugin as an update shortcut.

Use the host's plugin installation and removal commands. Removing the plugin leaves CLI credentials intact.

## Authoring validator

Inspection does not need Node, but `validate-project.mjs` does. It also needs Bash for parse-only checks. Missing Node/Bash or a syntax-check timeout is a failure, not permission to claim validation succeeded. The shipped skeleton intentionally fails until TODOs and script stubs are completed; a passing structural check does not certify installation, MPI compatibility or Slurm execution.

## Development verification

Follow [setup and verification](development.md#setup-and-verification) for contributor checks. Default tests do not inspect an external CLI or use user credentials. The [explicit packaged-CLI smoke](development.md#explicit-packaged-cli-smoke) is opt-in and tests local discovery only; it does not establish server or agent behavior.

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
