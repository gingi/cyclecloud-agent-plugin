# Development guide

The plugin is source-only. Skills use the host's tools to invoke the selected CycleCloud CLI directly. Node powers development tooling and the small authoring checker; there is no plugin-owned Python runtime, API bridge, build step or server to start.

## Setup and verification

`main` is the repository default and development branch; `stable` is the separate verified release channel. Start development from an up-to-date `main` checkout:

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <feature-branch>
```

Create contributor and release-preparation PRs with `gh pr create --base main`. Never commit development changes directly to `stable`; tagging prepares the release merge commit, and promotion advances `stable` to that exact verified tag.

Use a supported Node version from `package.json` and Bash for parse-only authoring checks. Install development dependencies and verify:

```sh
npm ci --ignore-scripts
npm run verify
npm run package:local
npm run verify:package
```

Verification checks formatting, lint, types, tests and dependency vulnerabilities. Tests exercise authoring checks, source/package integrity and release tooling. Instruction assertions protect key guidance but are not a model-backed proof of agent compliance. The package smoke test runs the authoring checker against its intentionally incomplete skeleton. It does not execute application scripts or contact a CLI or server.

Keep CLI operation/parser/result tests in the CLI repository rather than maintain a mirrored plugin implementation. Add focused plugin guidance and integration checks when adopting a new verified contract; do not hardcode a proposed command API before it exists.

### Explicit packaged-CLI smoke

Default tests never discover an external CLI or read user configuration. To opt into offline discovery checks against a **reviewed, explicitly selected** executable:

```sh
CYCLECLOUD_TEST_CLI=/absolute/path/to/approved/cyclecloud \
  npx vitest run tests/cli-discovery.test.ts
```

The test uses a fresh temporary HOME and root/group/leaf help to check the canonical cluster, node, issue and event paths and contracts the skills consume, plus the separate legacy node fallback descriptor. It does not initialize, execute data commands, contact a real instance or validate authentication. The executable must provide `cyclecloud.help.v1` and the documented leaf output contracts. An older artifact failing this check is not proof that all its ordinary commands are unusable.

When testing a source-built CLI, explicitly configure its documented source import path if necessary; do not discover private checkout paths in plugin code. Runtime platform support belongs to the selected CLI and host.

### Synthetic cluster workflow

To exercise the public CLI beyond help, explicitly select a reviewed CLI, its Python environment and the CLI repository's `tests/cluster_json_fixture.py`:

```sh
CYCLECLOUD_TEST_CLI=/absolute/path/to/approved/cyclecloud \
CYCLECLOUD_TEST_PYTHON=/absolute/path/to/cli-python \
CYCLECLOUD_TEST_CLUSTER_FIXTURE=/absolute/path/to/cli/tests/cluster_json_fixture.py \
  npx vitest run tests/cluster-workflow.test.ts
```

Configure `PYTHONPATH` explicitly if required by a source build. This opt-in test uses the CLI-owned fixture, an ephemeral loopback port, a temporary HOME/configuration and dummy credentials. It executes inventory, cursor continuation, named detail, partial/unavailable counts and a missing-cluster failure through the public executable. Default tests skip it; no private source paths are discovered automatically and no Python/runtime helper is shipped in the plugin.

The analogous node-selection workflow uses the CLI-owned `node_json_fixture.py` and its sibling cluster fixture:

```sh
CYCLECLOUD_TEST_CLI=/absolute/path/to/approved/cyclecloud \
CYCLECLOUD_TEST_PYTHON=/absolute/path/to/cli-python \
CYCLECLOUD_TEST_NODE_FIXTURE=/absolute/path/to/cli/tests/node_json_fixture.py \
  npx vitest run tests/node-workflow.test.ts
```

It checks a definition that also has a concrete identity while Off, failed array-member selection, exact target lookup, cursor continuation and empty-array versus missing-target behavior. Like the cluster test it uses only loopback, dummy credentials and isolated files; explicitly select the reviewed fixture and any required source PYTHONPATH. All these integration tests are skipped unless their paths are supplied.

Selected-node diagnostics use the same isolated pattern with the CLI-owned diagnostics fixture and its sibling node/cluster fixtures:

```sh
CYCLECLOUD_TEST_CLI=/absolute/path/to/approved/cyclecloud \
CYCLECLOUD_TEST_PYTHON=/absolute/path/to/cli-python \
CYCLECLOUD_TEST_DIAGNOSTICS_FIXTURE=/absolute/path/to/cli/tests/node_diagnostics_fixture.py \
  npx vitest run tests/diagnostics-workflow.test.ts
```

This checks active-phase previews, current-issue descriptions, zero installation settings, cached VM evidence, denied sections, missing association and fatal wrong association beyond a preview. It does not run live diagnostics or validate model interpretation. Review and authorize the external fixture and executable before running; default tests skip it.

Cluster Event Log checks use the CLI-owned `cluster_events_fixture.py` and its sibling cluster fixture:

```sh
CYCLECLOUD_TEST_CLI=/absolute/path/to/approved/cyclecloud \
CYCLECLOUD_TEST_PYTHON=/absolute/path/to/cli-python \
CYCLECLOUD_TEST_EVENTS_FIXTURE=/absolute/path/to/cli/tests/cluster_events_fixture.py \
  npx vitest run tests/events-workflow.test.ts
```

Set `PYTHONPATH` explicitly if the selected fixture environment requires source imports. The fixture must support `--scenario NAME --cli ABS_EXECUTABLE -- COMMAND...`; it launches the selected public CLI with synthetic configuration, temporary HOME and loopback responses. The tests preserve cluster-wide failure and informational recovery evidence within an explicit historical window, distinguish truncated/empty selections, and check that a denied primary read fails without exposing the fixture's private error body. Exact `event show` checks use a copied ID and `--cluster` without collection/time flags, validate the singular `cyclecloud.cluster-event.v1` envelope and unchanged bounded event fields, and require missing or failed exact reads to fail rather than return empty history. Use a reviewed fixture that supports those exact-lookup scenarios; list-only fixtures are insufficient. Review and authorize the fixture and executable before opting in; missing paths skip these tests. They do not call a live server or validate model interpretation.

Grouped current-issue checks use the CLI-owned `cluster_issues_fixture.py` with the same executable-launching protocol:

```sh
CYCLECLOUD_TEST_CLI=/absolute/path/to/approved/cyclecloud \
CYCLECLOUD_TEST_PYTHON=/absolute/path/to/cli-python \
CYCLECLOUD_TEST_ISSUES_FIXTURE=/absolute/path/to/cli/tests/cluster_issues_fixture.py \
  npx vitest run tests/issues-workflow.test.ts
```

These representative checks cover curated occurrence counts, bounded/empty groups, denied reads, and summary-to-node-reference drilldown through the actual executable. For drilldown, the fixture's `--select-group 0` runs the grouped read first and substitutes its unchanged short logical ID for the literal `{groupSelector}` argument on the same temporary server/configuration. The fixture performs this substitution; it is not a production CLI placeholder or a plugin runtime helper. Keeping the selected connection is essential: a short ID is scoped to it, not an endpoint-binding token. Grouped JSON and short-ID drilldown require backend `PageVersion=2`; legacy long selectors and node cursors retain their strict compatibility semantics, and summary cursors remain representative-based.

The checks do not prove affected-node totals, live health, model compliance or server-side aggregation semantics; datastore semantics belong to the maintained backend tests. Like the other workflows, they use only isolated loopback data and are skipped unless the reviewed absolute paths are supplied.

The fixtures check known View requests, not arbitrary query execution or real account permissions. Passing proves command/result interoperability for those synthetic scenarios, not live server compatibility or model-backed skill compliance. Keep parser, transport and datastore regression tests in the CLI repository rather than copying its implementation into the plugin.

## Scope and limitations

The plugin is a proof of concept, not a production-support guarantee. Validate the intended CLI/server versions, identity provider, shell and host in your deployment. Contract checks and plugin registration do not establish live connectivity or agent behavior.

- Examples use POSIX shell syntax. Test native Windows, macOS and remote host combinations separately before claiming support.
- The application skeleton is incomplete. Structural checks do not certify an OpenFOAM/OS/MPI combination or replace live installation/workload validation.
- Structured discovery and legacy node JSON do not supply all richer diagnostic/authoring evidence. Unsupported capabilities need explicit gap guidance; do not claim complete workflow parity from a basic JSON flag.
- Diagnostic evidence has source, freshness and server-work limitations; see [node diagnostics](node-diagnostics.md).

## Diagnostic host evaluation

Use a fresh isolated host session with the reviewed plugin and an explicitly selected CLI. The contributor checkout contains `tests/fixtures/node-diagnostics-evaluation.md`: neutral prompts, labeled synthetic inputs and separate rubrics for tool actions and answers for legacy stopping, current-association versus history, filtered Event Log absence and recovery versus readiness. The casebook is not shipped in source packages.

Model-backed runs require approval and may incur charges; connected runs additionally require an authorized target. Give the model the prompt/evidence, not the evaluator rubric. Supplied-evidence cases measure interpretation only; use actual host tool requests for the legacy stop rule and supported-CLI command composition. Keep [diagnostic approvals](node-diagnostics.md#review-diagnostic-command-approvals) narrow and reject unsafe substitutes before execution.

Record exact prompts, source state, host/model versions, requested/executed commands, outputs and interventions outside shipped docs. Score tool actions separately from answer claims. A host-blocked forbidden request is a failed behavior check, and a coached correction is not an unassisted pass. Inspect the entire answer for unsupported claims even when its last paragraph is cautious. Static tests, process exit codes and a small passing sample do not establish reliable agent compliance or cross-host behavior.

## Application authoring evaluation

The user workflow and expected files are in [application authoring](application-authoring.md). The following checks are for contributors evaluating the skill and its bundled assets.

### Local checks

From the repository root:

```sh
node skills/author-cyclecloud-application/scripts/validate-project.mjs \
  skills/author-cyclecloud-application/assets/project
npx vitest run tests/application-skill.test.ts tests/source-package.test.ts
npm run verify
```

The untouched skeleton deliberately makes the checker exit **1**. The tests exercise required files, TODO markers, shell syntax, and asset use outside the checkout. They are not agent-behavior or live OpenFOAM evaluations.

### Host evaluation

Use an isolated host configuration and a separate workspace; follow [isolated host checks](#isolated-host-checks). Register the reviewed persistent source, start a fresh agent session, and use the example request in the authoring guide. A model-backed evaluation may incur charges and requires explicit approval; a live installation requires separate authorization and an appropriate test cluster. Neither is part of the unit suite.

Check that the agent:

1. Discovers the skill, resolves assets relative to the installed plugin, and writes only to the chosen workspace while preserving existing files.
2. For a named cluster, discovers the selected CLI's actual root/leaf capabilities, selects supported scoped reads and explains missing evidence without invoking a second API client or raw dumps.
3. Requires all current specs and enough evidence about inheritance, shared uses and HA targets for attachment edits; follows only documented continuation and never invents mappings from partial output.
4. Summarizes available configured OS and Slurm versions with target/source before asking questions. It reuses known facts, asks about material conflicts or gaps, and keeps OpenFOAM distribution/release as an application choice.
5. Runs the checker on the authored directory and reports both failures and unchecked runtime assumptions. It does not claim successful installation or execute deployment steps.

| Scenario                                | Expected behavior                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Named reachable cluster                 | Gather relevant evidence; clarify only missing environment facts and application choices.   |
| Missing CLI or unavailable evidence     | Offer opt-in setup or offline authoring with explicit unknowns.                             |
| Ambiguous OpenFOAM distribution/version | Ask rather than silently choose incompatible software.                                      |
| Existing workspace files                | Inspect and preserve unrelated work.                                                        |
| Shared installer                        | Designate one writer and a readiness protocol; do not race installers across compute nodes. |
| Incomplete scaffold or malformed shell  | Report local check failures; leave unresolved drafts visibly incomplete.                    |
| Authoring-only request                  | No upload, deployment, installer execution, or job submission.                              |
| Complete OS/Slurm context               | Provide a sourced baseline summary without repeating answered version questions.            |
| Mixed scheduler/compute images          | Report per-target facts; ask only when the difference requires an implementation choice.    |
| Unknown custom image                    | Mark the OS release unresolved rather than guessing from the image name.                    |
| Denied or conflicting metadata          | Preserve available facts and ask about the specific missing or conflicting evidence.        |
| Different project and software versions | Use sourced Slurm software metadata, never the cluster-init project revision.               |

Repeat in Copilot CLI and VS Code before claiming cross-host behavior; instruction-text assertions and fixture tests do not prove agent compliance. Planned application implementation work belongs in the [design roadmap](agent-plugin-design.md#application-authoring-evolution).

## Install a local or unpublished build

Use a persistent source directory. No `npm ci` or build is needed just to install the plugin:

```sh
copilot plugin marketplace add /absolute/path/to/cyclecloud-agent-plugin
copilot plugin install cyclecloud@cyclecloud
```

A local marketplace can be **live**: deleting or moving its directory can break the registration. For VS Code, use the supported `chat.pluginLocations` setting to register the same persistent directory, and enable `chat.plugins.enabled`. Do not copy files into private host caches or edit state databases to force discovery.

To make a source package from a developer checkout:

```sh
npm run package:local
npm run verify:package
```

Copy the complete `dist/cyclecloud-agent-plugin/` directory to a persistent destination and register it through the host. The package includes skills, authoring assets/checker, public docs/license and the hidden marketplace catalog. The explicit source allowlist excludes credentials, developer tests, `node_modules` and private plans. Install and remove the plugin through the host's native plugin mechanism.

To test a specific branch/SHA, select that reviewed source in a separate checkout/worktree and register that persistent path. Nothing silently substitutes `main`. Do not change the active checkout to test another branch.

### Repository distribution

Repository installation from `gingi/cyclecloud-agent-plugin` follows the `main` default branch, which can include unreleased changes:

```sh
copilot plugin marketplace add gingi/cyclecloud-agent-plugin
copilot plugin install cyclecloud@cyclecloud
```

For VS Code, the equivalent repository path uses **Chat: Install Plugin From Source** with the reviewed repository URL.

Repository registration follows the default source on `main`, not a release or preview archive. The separate `stable` branch points to verified release commits titled `Release vX.Y.Z`, each with its version tag.

The release commit is prepared before publication. Its first parent is the previous `stable` tip; its second parent is the reviewed source commit on `main`. If `stable` does not exist, the first release has no parents. The release tree exactly matches the reviewed source, whose SHA is recorded in a `Source-Commit` trailer. Public verification must pass before `stable` advances to the tagged release commit.

The merge appears in Git graphs. `git log --first-parent stable` follows the release sequence; full ancestry also includes development commits through the second parents.

To follow the release channel, select `stable` in a persistent source checkout and register that local path. For an exact release, feature-branch preview or offline installation, verify and extract the selected source archive into a persistent directory, then register its local path. Publishing a preview does not update `stable`.

### Isolated host checks

Copilot CLI supports `COPILOT_HOME` for an isolated configuration/state directory. Use `--no-auto-update` so validation does not update the host CLI. Register only the local test marketplace there; never reuse the user's normal plugin inventory for automated cleanup tests. No model invocation is required to inspect plugin registration.

VS Code supports discovery through `chat.pluginLocations` and `chat.plugins.marketplaces`. A disposable VS Code profile alone does not isolate files under a shared home directory; ensure test locations are actually separate. Register/enable through supported UI/settings, never by editing `state.vscdb`. See [host discovery](troubleshooting.md#host-discovery).

Keep host registration checks separate from model-backed skill evaluations. Registration checks alone do not validate agent behavior.

### Development workflow artifacts

For a manual **Development build** dispatch, use the default **main** branch (or `gh workflow run development.yml --ref main`), or select another branch to verify that source. The workflow already runs on all branches and verifies and packages the selected source. Artifacts use `cyclecloud-agent-plugin-package-<ref>-<source-sha>` naming. `SOURCE_COMMIT.json` records source SHA, checkout SHA, ref, event and run metadata; a PR's source SHA and synthetic merge checkout SHA may differ. Keep the file when sharing a package.

Extract artifacts to a persistent directory for host registration. A source package does not need a compiled `bin` directory. Host registration checks, CLI discovery checks and authoring-checker smoke tests are separate from evaluations of agent behavior.

## Releases and previews

Plugin release versions remain independent of CLI versions. Skills use the advertised command and result contracts needed for each task; there is no bundled compatibility implementation or single product-version gate. Clearly document capability requirements without treating an unreleased snapshot as a minimum supported release.

Prepare the version and changelog and review them through a normal PR into `main`. Then run **`release:tag` on the reviewed source**. For a stable version, the helper creates a `Release vX.Y.Z` commit from that source and tags it without moving `main` or `stable`.

Pushing the tag starts the **Release** workflow. It builds and publishes that exact commit, verifies public downloads, then advances `stable` to the tag. Stable release commits must record a source on `main`, regardless of the repository default.

SemVer prerelease tags such as `v0.2.0-rc.1` identify their feature-branch source directly and never promote `stable`. There is no release-preparation dispatch workflow or automatic release-branch cleanup.

### Repository settings

Configure these rules in GitHub:

- Protect **`refs/heads/main` explicitly**, not a dynamic default-branch target, with required PRs and the **Verify and package source** check. Require reviews as the maintainer team grows; GitHub enforces that policy when merging.
- Protect `refs/heads/stable` against deletion and non-fast-forward updates. Do not require linear history or a PR gate on `stable`: promotion advances it to an already-tagged, verified two-parent release merge. Ensure the promotion token can create/advance the ref without bypassing deletion or non-fast-forward protection. The merge preserves the previous `stable` tip as its first parent; the branch points to the release tag, not directly to its source on `main`.
- Restrict creation of `v*` tags to release maintainers. Use a separate tag ruleset to block tag updates and deletions, without granting those maintainers a bypass of that rule.
- Enable [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) to lock published tags and assets. The publishing helper delegates draft creation, asset upload and publication to GitHub CLI, so all assets are staged before the release becomes immutable.

The workflow authenticates with the built-in `GITHUB_TOKEN`. Only the publishing and promotion jobs request `contents: write` at job scope; other jobs are read-only. Before operating on a fork, determine its actual provider rather than assuming GitHub tooling applies. A remote repository rename/publication is a separate confirmed operation, not a local package-generation side effect.

### Stable release

1. Start from the main branch:

    ```sh
    git fetch origin
    git switch main
    git pull --ff-only origin main
    npm run release:prepare -- 0.4.2
    ```

    Preparation fetches `origin` and its tags, creates and switches to `release/prepare-0.4.2` at the current commit, updates all four manifest/lockfile documents, and drafts `## [0.4.2]` in the changelog. It leaves changes uncommitted for review; an existing version entry is preserved.

2. Review and edit `CHANGELOG.md` and the intended source/version changes. Commit the reviewed files, push the preparation branch, and create a PR with `gh pr create --base main`; merge it into `main` after required checks/reviews. Use a development artifact or persistent source directory for manual validation.
3. Check out the intended PR merge commit and prepare/tag its release commit:

    ```sh
    git fetch origin
    git switch --detach <merged-commit-sha>
    npm run release:tag -- 0.4.2 --push
    ```

    Tagging requires a clean checkout. It validates versions and notes, checks that the source belongs to fetched `origin/main`, and runs `npm run verify`.

    It then creates a release commit with the source's exact tree. The first parent is the current remote `stable` tip; the second is the selected source. If `stable` does not exist, the release commit has no parents.

    The new annotated tag identifies that release commit, not the checked-out preparation commit. The checkout and branches remain unchanged. Omit `--push` to prepare the tag locally; only the selected tag is pushed. For interrupted tagging or push recovery, see [local tagging troubleshooting](troubleshooting.md#local-tagging).

4. Watch **Actions → Release** through publication, public source verification, and the separate **Promote stable** job. **Do not pre-create a release in the GitHub UI**: the workflow creates it with verified assets and committed notes.

GitHub loads `.github/workflows/release.yml` from the tagged commit. Push one release tag at a time and wait for its workflow to finish. Tags pushed by another workflow using `GITHUB_TOKEN` do not normally trigger a new workflow; see [GitHub's token-trigger rules](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow).

### Preview a prerelease from a branch

Use the same process with an unused prerelease version, without merging to `main`:

```sh
npm run release:prepare -- 0.4.2-rc.1
# Review and edit notes and source on release/prepare-0.4.2-rc.1.
# Commit all reviewed changes, then:
npm run release:tag -- 0.4.2-rc.1 --push
```

This publishes a **real GitHub prerelease**, not a dry run. Prereleases never update latest stable or the `stable` branch. A tag fixes the source commit even if the feature branch advances. Use a new prerelease version for a changed build; never move a published tag. For testing without publication, use development artifacts or local packaging.

To use that exact preview, verify/extract its versioned source archive into a persistent directory and register that local path. Repository marketplace registration follows the repository's default source, not the preview tag or downloaded archive; publishing a branch preview does not update the default source.

### What runs automatically

- **Build (read-only):** validate the tag/event commit, clean committed checkout, manifest versions and changelog entry. For a stable release, validate its message, parent order, exact source tree, source ancestry against `main`, forward progress from the previous release, and unchanged `stable` base (or that it is already promoted). Run the full verification suite, package the tagged release commit, and check archive integrity/layout.
- **Publish (write access, no dependency installation):** confirm the existing remote tag still identifies the built commit, upload both assets and committed notes into a draft, then publish. Existing releases/drafts are refused; tags/assets are never overwritten. Prereleases use `--prerelease --latest=false`; GitHub selects latest for stable releases.
- **Post-release (read-only):** download anonymously, check checksums/tag/full-SHA metadata and the extracted source package, then smoke-test the packaged authoring checker. If this release is latest stable, verify its latest checksum download as well. This does not validate native Copilot/VS Code installation.

- **Promote (write access, no dependency installation):** run only after build, publication and public verification all succeed for a nonprerelease. Recheck the commit the remote tag resolves to, the published stable release metadata, release-commit parents, source tree, and source ancestry against `main`. Advance `stable` to that exact tagged commit with `force: false`. If the branch is absent, create it at a tagged release with no parents. Promotion creates no commits or tags. If `stable` already includes the tag, succeed without changes. Reject a different `stable` base or a source that does not advance. Use GitHub's compare status even when its returned commit list is truncated; API errors stop the operation.

Publication and promotion are serialized across versions. Tests use isolated fixtures/local HTTP without real CycleCloud credentials; public verification passes no GitHub token to downloads. A private repository needs a different download/authentication design. The workflow does not create/move tags or delete source branches.

### Changelog and assets

`release:prepare` drafts notes from non-merge commit subjects, oldest first, since the nearest released source reachable from `HEAD`. Direct source tags and prerelease tags count. For stable release-commit tags, it uses the validated `Source-Commit` only when its tree matches and that source is an ancestor of `HEAD`.

This avoids repeating released changes even though the release commit itself is outside `main`. If no released source is reachable, preparation uses all committed history. It fetches tags from `origin`. Use a full-history checkout; shallow clones are rejected for drafting.

Mechanical version/preparation subjects such as `chore: prepare v0.2.0`, `chore(release): 0.2.0`, and `Bump version to 0.2.0`, plus exact changelog/release-notes update subjects, are omitted. Release-tooling improvements remain. Review generated bullets for relevance and wording; if no subjects remain, write notes manually. Pending `Unreleased` notes can serve as a review checklist, but preparation drafts from committed history rather than promoting that section automatically.

Existing version entries are validated and preserved verbatim. For draft regeneration, see [preparation troubleshooting](troubleshooting.md#preparation). Entries must be nonempty and unique; an optional ` - YYYY-MM-DD` suffix is accepted. Publication uses only the chosen version's committed entry. Versions follow SemVer without build metadata.

Each release contains:

- `cyclecloud-agent-plugin-<version>.tar.gz`: the complete source plugin, hidden marketplace metadata and `SOURCE_COMMIT.json`.
- `SHA256SUMS`: integrity checks for the archive, not publisher signatures.

Release assets do not expire with Actions retention; the one-day Actions artifact transfers verified files between jobs. Local archives may include working-tree changes; published assets use the pinned tag-event commit. For stable releases, `SOURCE_COMMIT.json` records that tagged release commit in both `sourceCommit` and `checkoutCommit`; the reviewed `main` input is recorded separately in the commit's `Source-Commit` trailer.

Local `npm run verify` includes tag validation, isolated publication/promotion fixtures and curl/local-HTTP source-archive tests, with no remote writes. To build assets without publication, run `npm run package:release -- v0.4.2` after preparing that version. To recheck an existing public release, use a separate checkout at that exact tag with its own verification dependencies and harness:

```sh
npm run verify:release -- v0.2.0 <full-commit-sha>
```

Append `--latest` only for the current latest stable. Verification uses isolated storage, not your installed plugin or credentials. See [public release verification troubleshooting](troubleshooting.md#public-release-verification) for checkout mismatches or failed checks.

Existing source-tagged releases, including `v0.4.1`, remain unchanged. The next release commit may use the existing `stable` tip as its first parent, whether that tip is an ordinary `main` commit, a release snapshot, or a release merge. This helper requires new-style release-commit tags; historical source-tagged releases retain their tagged workflow/tooling. Do not move old tags or rewrite existing parent links to adopt the new process. Changes to source, docs, or tooling must reach `stable` through a verified release from `main`, not standalone commits.

For failed preparation, tagging, publication, verification, or promotion, use [release troubleshooting](troubleshooting.md#release-troubleshooting-maintainers). The [manual stable promotion procedure](troubleshooting.md#manual-stable-promotion) is documented there alongside its verification and authorization requirements.

## Local plugin removal

Use the host's native plugin uninstall and marketplace removal commands, as shown in the README. Remove or disable VS Code source registrations separately. CLI credentials belong to the CLI and are not removed with the plugin. For isolated testing, use a disposable host configuration and a persistent source directory rather than resetting a normal installation.
