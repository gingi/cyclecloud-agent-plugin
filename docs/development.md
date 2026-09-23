# Development guide

The plugin is source-only. Node is development tooling and powers the small authoring validator; the inspection helper runs in the selected CycleCloud CLI's Python environment. No runtime build or server startup is required.

## Setup and verification

`main` remains the development branch; `stable` is the repository default and installation channel. Explicitly select and update `main` rather than relying on the clone or PR default:

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <feature-branch>
```

Create contributor and release-preparation PRs with `gh pr create --base main`. Never commit directly to `stable`; only promote an exact verified release commit.

Use a supported Node development version from `package.json` and Python 3.9+ for the complete development suite (the inspection source targets Python 3.8+). Install development dependencies and verify:

```sh
npm ci --ignore-scripts
npm run verify
```

Verification covers formatting, JavaScript lint/typecheck/tests, Python inspection/failure tests and dependency audit. Source/package checks validate the distributed helpers and assets. The Python suite checks all shipped Python modules and the bootstrap with `ast.parse(..., feature_version=(3, 8))`; this syntax check does not substitute for running on Python 3.8. Tests that require `requests` are skipped when it is unavailable; run with the bundled CLI Python to exercise those tests.

The canonical portable corpus is `tests/fixtures/inspect/v1/parity.json`: synthetic inputs/results generated from the original TypeScript implementation, with source commit and frozen-clock provenance. Keep it with the Python tests when upstreaming inspection into CycleCloud 8.11; do not maintain two diverging normalizers. Native routing tests use a fake capability-compatible CLI until the real implementation exists.

### Explicit packaged-CLI smoke

The default Python suite never discovers external CLI artifacts or reads the user's configuration. To opt into integration tests against a **reviewed, explicitly approved** CLI artifact:

```sh
CYCLECLOUD_TEST_CLI=/absolute/path/to/approved/cyclecloud \
  python3 -B -m unittest discover -s tests/python
```

These tests create synthetic configuration and fake credentials, use a local HTTP backend, and exercise all read commands/context sections plus failure paths. They do not initialize the CLI, contact a real CycleCloud instance, or alter user credentials. Record the exact artifact and checks run; see [verification status](#verification-status) for existing evidence.

## Verification status

The plugin is a proof of concept. Passing local checks does not qualify every CLI installer, server, identity provider, agent host, or application runtime.

| Area                     | Recorded evidence                                                                                              | Still requires verification                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Inspection core          | Synthetic golden fixtures and Python boundary, failure-path, transport, process, and launcher tests.           | Supported live CycleCloud server combinations.                                                              |
| Packaged CLI integration | A local 8.10 snapshot passed opt-in tests using synthetic configuration and a local fake backend.              | Released CLI installers and live identity-provider behavior.                                                |
| Authentication           | Unit tests exercise Basic, public-client silent, confidential-client, and managed-identity integration points. | Real Entra and managed-identity services in the intended deployment.                                        |
| Copilot CLI              | Isolated registration and launcher checks on version **1.0.86-2**, recorded on **2026-09-18** (details below). | Model-backed skill behavior and other host versions.                                                        |
| Platforms and hosts      | Local development checks.                                                                                      | macOS execution and VS Code runtime behavior; native Windows is not qualified.                              |
| Python                   | Shipped modules and bootstrap are checked with `ast.parse(..., feature_version=(3, 8))`.                       | Execution on Python 3.8 itself; syntax acceptance is not a runtime test.                                    |
| Native inspection        | Routing tests use a fake capability-compatible CLI.                                                            | The real native implementation, intended for CLI 8.11.                                                      |
| Application authoring    | Structural/TODO checks, Bash syntax checks, and skill-guidance assertions.                                     | Agent compliance, installation, and serial/parallel workloads. No OpenFOAM/OS/MPI combination is validated. |

The 2026-09-18 Copilot CLI checks used isolated state and covered non-persistent source discovery, native local marketplace registration, installation discovering both skills, live-source update preserving a disabled state, packaged launcher capabilities with the local 8.10 snapshot, and uninstall/marketplace removal leaving an empty inventory. Normal host configuration was not changed. This is host registration/launcher evidence, not a model-backed skill evaluation or a VS Code runtime test.

Update this section when an authorized environment check is completed, recording the version, environment, scope, and result rather than inferring support from a unit test.

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
2. For a named cluster, checks launcher capabilities, starts with `application-context NAME --schema-version 1 --view overview`, and selects relevant targets before requesting details for one target and section at a time.
3. Follows needed collection cursors to preserve existing specs and assess `usedBy`, inheritance, and HA scope; leaves incomplete evidence explicit and never invents attachment mappings.
4. Reads relevant environment sections and summarizes configured `platform.release` and `scheduler.version` before asking version questions. It reuses known values, asks about material conflicts or missing facts, and keeps OpenFOAM distribution/release as an application choice.
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
| Different project and software versions | Use `scheduler.version` for Slurm, never the cluster-init project revision.                 |

Repeat in Copilot CLI and VS Code before claiming cross-host behavior. Record observations and limitations in [verification status](#verification-status); instruction-text assertions and fixture tests do not prove agent compliance. Planned application implementation work belongs in the [design roadmap](agent-plugin-design.md#application-authoring-evolution).

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

Copy the complete `dist/cyclecloud-agent-plugin/` directory to a persistent destination and register it through the host. The package includes the Python inspection source, launcher, skills, assets, compatibility metadata, docs/license and hidden marketplace catalog. It excludes credentials, `node_modules`, bytecode caches and generated bundles. Install and remove the plugin through the host's native plugin mechanism.

To test a specific branch/SHA, select that reviewed source in a separate checkout/worktree and register that persistent path. Nothing silently substitutes `main`. Do not change the active checkout to test another branch.

### Repository distribution

Repository installation from `gingi/cyclecloud-agent-plugin` follows the `stable` default branch:

```sh
copilot plugin marketplace add gingi/cyclecloud-agent-plugin
copilot plugin install cyclecloud@cyclecloud
```

For VS Code, the equivalent repository path uses **Chat: Install Plugin From Source** with the reviewed repository URL.

Repository registration follows the repository's default source, not a release or preview archive. The default is `stable`, pointing to the exact published stable tag commit that passed public verification; `main` continues independently with development. For an exact release, feature-branch preview, or offline installation, verify and extract the selected source archive into a persistent directory and register that local path. Publishing a preview does not update `stable`.

### Isolated host checks

Copilot CLI supports `COPILOT_HOME` for an isolated configuration/state directory. Use `--no-auto-update` so validation does not update the host CLI. Register only the local test marketplace there; never reuse the user's normal plugin inventory for automated cleanup tests. No model invocation is required to inspect plugin registration.

VS Code `chat.pluginLocations` and `chat.plugins.marketplaces` are supported discovery surfaces. A disposable VS Code profile alone does not isolate files under a shared home directory; ensure test locations are actually separate. Register/enable through supported UI/settings, never by editing `state.vscdb`. See [host discovery](troubleshooting.md#host-discovery).

Record results in [verification status](#verification-status), separately from model-backed skill evaluations. Registration checks alone do not validate agent behavior.

### Development workflow artifacts

For a manual **Development build** dispatch, explicitly select **main** in the branch selector (or use `gh workflow run development.yml --ref main`); the repository default is `stable`. The workflow already runs on all branches and verifies and packages the selected source. Artifacts use `cyclecloud-agent-plugin-package-<ref>-<source-sha>` naming. `SOURCE_COMMIT.json` records source SHA, checkout SHA, ref, event and run metadata; a PR's source SHA and synthetic merge checkout SHA may differ. Keep the file when sharing a package.

Extract artifacts to a persistent directory for host registration. A source package does not need a compiled `bin` directory. Host discovery tests and structured-helper smoke tests are separate from agent-behavior evaluations.

## Releases and previews

Plugin release versions remain independent of CLI versions. `compatibility.json` selects the 8.10 bridge policy and required native inspection schema. Publishing the bridge does **not** wait for 8.11; removing the bridge later requires a deliberate minimum-CLI/support decision.

Prepare the version and changelog, review them through a normal PR into `main`, then **push a version tag**. The **Release** workflow builds and publishes the exact tagged commit, verifies public downloads, then promotes `stable` to that commit. Stable tags must identify a commit on `main`, regardless of the repository default; SemVer prerelease tags such as `v0.2.0-rc.1` may identify a feature-branch commit and never promote `stable`. There is no release-preparation dispatch workflow or automatic release-branch cleanup.

### Repository settings

Configure these rules in GitHub:

- Protect **`refs/heads/main` explicitly**, not a dynamic default-branch target, with required PRs and the **Verify and package source** check. Require reviews as the maintainer team grows; GitHub enforces that policy when merging.
- Protect `refs/heads/stable` against deletion and non-fast-forward updates. Do not apply a PR gate to `stable`: promotion must advance it directly to an already-reviewed release commit, without a merge commit. Ensure the promotion token can create/fast-forward that ref without bypassing deletion or non-fast-forward protection.
- Restrict creation of `v*` tags to release maintainers. Use a separate tag ruleset to block tag updates and deletions, without granting those maintainers a bypass of that rule.
- Enable [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) to lock published tags and assets. The publishing helper delegates draft creation, asset upload and publication to GitHub CLI, so all assets are staged before the release becomes immutable.

The workflow authenticates with the built-in `GITHUB_TOKEN`. Only the publishing and promotion jobs request `contents: write` at job scope; other jobs are read-only. Before operating on a fork, determine its actual provider rather than assuming GitHub tooling applies. A remote repository rename/publication is a separate confirmed operation, not a local package-generation side effect.

### Stable release

1. Start from the main branch:

    ```sh
    git fetch origin
    git switch main
    git pull --ff-only origin main
    npm run release:prepare -- 0.4.0
    ```

    Preparation fetches `origin` and its tags, creates and switches to `release/prepare-0.4.0` at the current commit, updates all four manifest/lockfile documents, and drafts `## [0.4.0]` in the changelog. It leaves changes uncommitted for review; an existing version entry is preserved.

2. Review and edit `CHANGELOG.md` and the intended source/version changes. Commit the reviewed files, push the preparation branch, and create a PR with `gh pr create --base main`; merge it into `main` after required checks/reviews. Use a development artifact or persistent source directory for manual validation.
3. Check out the intended PR merge commit and tag it:

    ```sh
    git fetch origin
    git switch --detach <merged-commit-sha>
    npm run release:tag -- 0.4.0 --push
    ```

    Tagging requires a clean checkout, validates versions/notes and ancestry against fetched `origin/main`, and runs `npm run verify`. New tags are annotated and identify the checked-out commit, not a later `main` tip. Existing annotated or lightweight tags are reused unchanged only when they identify that same commit. Omit `--push` for a local tag; add it when ready to publish. Only the selected tag is pushed.

4. Watch **Actions → Release** through publication, public source verification, and the separate **Promote stable** job. **Do not pre-create a release in the GitHub UI**: the workflow creates it with verified assets and committed notes.

GitHub loads `.github/workflows/release.yml` from the tagged commit. Push one release tag at a time and wait for its workflow to finish. Tags pushed by another workflow using `GITHUB_TOKEN` do not normally trigger a new workflow; see [GitHub's token-trigger rules](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow).

### Preview a prerelease from a branch

Use the same process with an unused prerelease version, without merging to `main`:

```sh
npm run release:prepare -- 0.4.0-rc.1
# Review and edit notes and source on release/prepare-0.4.0-rc.1.
# Commit all reviewed changes, then:
npm run release:tag -- 0.4.0-rc.1 --push
```

This publishes a **real GitHub prerelease**, not a dry run. Prereleases never update latest stable or the `stable` branch. A tag fixes the source commit even if the feature branch advances. Use a new prerelease version for a changed build; never move a published tag. For testing without publication, use development artifacts or local packaging.

To use that exact preview, verify/extract its versioned source archive into a persistent directory and register that local path. Repository marketplace registration follows the repository's default source, not the preview tag or downloaded archive; publishing a branch preview does not update the default source.

### What runs automatically

- **Build (read-only):** validate the tag/event commit, stable-release ancestry against `main`, clean committed checkout, manifest versions and changelog entry; run the full verification suite; package source and check archive integrity/layout.
- **Publish (write access, no dependency installation):** confirm the existing remote tag still identifies the built commit, upload both assets and committed notes into a draft, then publish. Existing releases/drafts are refused; tags/assets are never overwritten. Prereleases use `--prerelease --latest=false`; GitHub selects latest for stable releases.
- **Post-release (read-only):** download anonymously, check checksums/tag/full-SHA metadata and the extracted source package, then exercise bounded launcher smoke. If this release is latest stable, verify its latest checksum download as well. This does not validate native Copilot/VS Code installation.

- **Promote (write access, no dependency installation):** only after build, publication, and public verification all succeed for a nonprerelease, recheck the remote tag's peeled SHA, published stable release metadata, and ancestry against a snapshot of `main`. Create `stable` if absent or fast-forward it to the exact tag commit with `force: false`. An equal/newer `stable` is a successful no-op; divergence or API errors fail closed. Compare status is authoritative even when GitHub truncates the returned commit list.

Publication and promotion are serialized across versions. Tests use isolated fixtures/local HTTP without real CycleCloud credentials; public verification passes no GitHub token to downloads. A private repository needs a different download/authentication design. The workflow does not create/move tags or delete source branches.

### Changelog and assets

`release:prepare` drafts notes from non-merge commit subjects, oldest first, since the nearest reachable SemVer `v*` tag through `HEAD`. Prerelease tags count; without release tags it uses all committed history. Preparation fetches tags from `origin`; use a full-history checkout because shallow clones are rejected for drafting.

Mechanical version/preparation subjects such as `chore: prepare v0.2.0`, `chore(release): 0.2.0`, and `Bump version to 0.2.0`, plus exact changelog/release-notes update subjects, are omitted. Release-tooling improvements remain. Review generated bullets for relevance and wording; if no subjects remain, write notes manually. Pending `Unreleased` notes can serve as a review checklist, but preparation drafts from committed history rather than promoting that section automatically.

Existing version entries are validated and preserved verbatim. To regenerate a draft, first save any edits and remove only that version's entry. Entries must be nonempty and unique; an optional ` - YYYY-MM-DD` suffix is accepted. Publication uses only the chosen version's committed entry. Versions follow SemVer without build metadata.

Each release contains:

- `cyclecloud-agent-plugin-<version>.tar.gz`: the complete source plugin, hidden marketplace metadata and `SOURCE_COMMIT.json`.
- `SHA256SUMS`: integrity checks for the archive, not publisher signatures.

Release assets do not expire with Actions retention; the one-day Actions artifact transfers verified files between jobs. Local archives may include working-tree changes; published assets use the pinned tag-event commit.

Local `npm run verify` includes tag validation, isolated publication/promotion fixtures and curl/local-HTTP source-archive tests, with no remote writes. To build assets without publication, run `npm run package:release -- v0.4.0` after preparing that version. To recheck an existing public release, use a separate checkout at that exact tag with its own verification dependencies and harness:

```sh
npm run verify:release -- v0.2.0 <full-commit-sha>
```

Append `--latest` only for the current latest stable. Verification uses isolated storage, not your installed plugin or credentials. `verify-release.mjs` delegates to `verify-package.mjs`, which compares full source bytes against its own checkout; verifying a historic release from changed `main` is invalid.

### Stable-channel migration

This code change does not create `stable`, change the repository default, or configure protection. Perform those operational steps separately after review:

1. Retain the existing `v0.2.0` and `v0.3.0` tags and ordinary ancestry. Initial `stable` should point exactly to `v0.3.0`, whose history already includes `v0.2.0`; do not rewrite tags, reset history, or manufacture a stable-only merge.
2. Record successful public verification of `v0.3.0` at its full peeled commit SHA. Run `npm ci --ignore-scripts` and `npm run verify:release -- v0.3.0 <full-v0.3.0-commit-sha>` from a separate exact **`v0.3.0` checkout, using that release's source and verification harness**, not the modified `main` checkout. Include `--latest` only if it remains latest stable.
3. Old release workflow reruns use the old tagged workflow; they cannot acquire the new promotion job. After the preceding verification succeeds, invoke the reviewed promotion helper from the updated tooling checkout with that same tag and full SHA:

    ```sh
    GH_REPO=gingi/cyclecloud-agent-plugin npm run release:promote -- v0.3.0 <full-v0.3.0-commit-sha>
    ```

    This is an authorized remote write requiring a token with repository contents write access. The helper checks identity, release metadata, and ancestry but **does not independently run public verification**; manual invocations require recorded successful verification evidence for the same SHA. It only creates/advances `stable`, never tags, releases, assets, or settings.

4. Configure the explicit `main` and `stable` protections above, then separately change the default branch to `stable`. Confirm contributor PR bases and manual Development dispatches still select `main`.

The source and docs visible on initial `stable` remain exactly as shipped in `v0.3.0`, including their older guidance, until the next release. Never merge standalone docs/tooling changes into `stable` to update them; release through `main` and promote the verified tag instead.

### Failure and retry behavior

- **Preparation:** a new preparation branch requires a clean checkout and an unused version. Existing branches are not reset; inspect and switch to the matching preparation branch to resume. Rerunning there preserves review edits, including uncommitted changes. Resolve fetch/authentication failures before retrying. If writes fail after branch creation, retain the branch/files for inspection and repair.
- **Local tagging:** mismatched versions/notes, unmerged stable commits, dirty checkouts or failed verification stop tagging. Existing tags are reused only for the selected commit; conflicting tags are never moved. If a push fails, the local tag remains: fix the cause and retry `npm run release:tag -- <version> --push`. A matching tag already on origin is neither changed nor pushed again.
- **Validation/build failed:** no release was created. Rerun the original failed jobs for transient failures. If the tagged source needs changes, commit a fix and use a new version/tag; do not move the old tag.
- **Publication failed:** inspect GitHub first. An upload failure may leave a draft that automation refuses to overwrite. After inspection, either finish that draft manually using verified assets, or explicitly delete only the incomplete draft (keep the tag) and rerun publishing. If transfer artifacts expired, rerun the original workflow. If publication actually succeeded, verify the existing release instead of publishing again.
- **Post-release check failed:** the release is already public, not rolled back, and `stable` is not promoted. Rerun failed jobs for transient failures; package defects require a new version, not replacement assets or a moved tag.
- **Promotion failed:** leave the published release and tag intact. Inspect permissions, branch protections, ancestry, or the API failure, then rerun **only the failed promotion job** (or rerun failed jobs), not all jobs: the publisher intentionally rejects existing releases. Concurrent ref creation/update rejection fails safely and is rerunnable without forced recovery; a retry for an older release cannot roll back `stable`. If divergence requires source changes, release a new version rather than rewriting `stable` ancestry. A manual helper retry requires successful public verification evidence for the same tag/SHA.

## Local plugin removal

Use the host's native plugin uninstall and marketplace removal commands, as shown in the README. Remove or disable VS Code source registrations separately. CLI credentials belong to the CLI and are not removed with the plugin. For isolated testing, use a disposable host configuration and a persistent source directory rather than resetting a normal installation.
