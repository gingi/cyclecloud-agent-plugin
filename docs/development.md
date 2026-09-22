# Development guide

For normal installation and usage, see the [README](../README.md). This guide covers building, verifying, and testing changes from a development checkout.

## Setup and verification

Use the [runtime prerequisites](../README.md#quick-start-copilot-cli-and-copilot-in-vs-code), plus **Python 3.9+** for the developer reset utility and the reset/installer terminal tests.

Install development dependencies and run verification:

```bash
npm ci --ignore-scripts
npm run verify
```

Verification runs formatting checks, lint, typecheck, bundle generation, tests (including the developer reset tests), and a dependency audit. The `test` script builds once through its `pretest` hook; CI packages that verified bundle without rebuilding it. Local packaging commands still build first. `bin/cyclecloud-mcp.mjs` is generated and ignored, not committed. A clean source checkout therefore needs its development dependencies and `npm run build` (or a command such as `npm run verify`, `npm test`, `npm run package:local`, or `npm run install:local` that builds first).

## Install a local or unpublished build

From this checkout, with development dependencies installed:

```bash
npm run install:local
```

This builds and packages the **complete plugin**, registers a persistent local marketplace under `~/.local/share/cyclecloud-mcp/marketplace/`, and maintains an identical runtime copy under `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/` for VS Code discovery. Both use the same private credential file as release installations. Rerunning updates changed files in both locations, repairs missing files, and leaves identical payloads alone. Prompts use existing configuration values as defaults and hide passwords; disabled state is preserved. Add `--skip-config` to the installer (or run `npm run install:local -- --skip-config`) to keep existing configuration unread and unchanged. The checkout is needed only to build—not to run the installed plugin.

To install elsewhere without a checkout or npm dependencies:

```bash
npm run package:local
```

Copy the complete `dist/cyclecloud-mcp/` directory to the target environment. From that directory run:

```bash
sh install.sh --local
```

Alternatively, pass the package directory explicitly: `sh /path/to/install.sh --local /path/to/package`. The input directory can be deleted afterward; **keep the managed marketplace directory**. Local installation does not fetch the plugin from GitHub, so it works before any branch is committed or published. It still requires Node and Copilot CLI.

The installer uses the adjacent package by default; `--local` remains an explicit alias and accepts another package directory. It switches this plugin's old development GitHub marketplace registration to the managed copy, without creating a second plugin or credential file. It refuses unrelated same-name sources. Complete the [credential setup](../README.md#1-install-and-configure) and [verification](../README.md#2-verify-the-setup) steps, then use the native `cyclecloud` tools. See [local installation and recovery](troubleshooting.md#local-installation-without-a-checkout-dependency) for details.

### Test a branch or commit from source

The GitHub repository contains source, not the built runtime. Direct repository marketplace installation is unsupported; use release assets or build the desired source ref.

To test an unpublished branch or exact SHA, check out that ref locally, then build and install it:

```bash
git fetch origin <branch>
git switch --detach <commit-sha> # or: git switch <branch>
npm ci --ignore-scripts
npm run install:local -- --skip-config
```

`npm run package:local` uses the same checked-out source and produces a self-contained `dist/cyclecloud-mcp/` package. The branch or SHA matters only when selecting the source; neither command silently substitutes `main`.

### Test a development workflow artifact

The **Development build** workflow runs for every pushed branch, pull request, and manually selected `workflow_dispatch` ref. It verifies the source, builds the ignored bundle, packages the complete installable directory, and uploads an artifact named `cyclecloud-mcp-package-<ref>-<source-sha>`. `SOURCE_COMMIT.json` records the full source SHA, checked-out SHA, ref, event, and run metadata. For pull requests, the source SHA is the PR head while the checked-out SHA can be GitHub's synthetic merge commit.

Download the artifact from the workflow run in GitHub, extract it, and run from the extracted package root:

```bash
sh install.sh --local --skip-config
```

With GitHub CLI, for example:

```bash
gh run download <run-id> --name <artifact-name> --dir cyclecloud-mcp-artifact
sh cyclecloud-mcp-artifact/install.sh --local --skip-config
```

The artifact is the installable package, not a source checkout: it includes the generated `bin/cyclecloud-mcp.mjs` and hidden `.github/plugin/marketplace.json`, but excludes development dependencies and source files. Keep `SOURCE_COMMIT.json` when sharing it so the build remains traceable.

## Publish a release

Prepare the version and changelog, review them through a normal PR, then **push a version tag**. The **Release** workflow builds and publishes the exact tagged commit. Stable tags must identify a commit on the default branch; SemVer prerelease tags such as `v0.2.0-rc.1` may identify a feature-branch commit.

### Repository settings

Configure these rules in GitHub:

- Protect the default branch with required PRs and the **Build, verify, and package** check. Require reviews as the maintainer team grows; GitHub enforces that policy when merging.
- Restrict creation of `v*` tags to release maintainers. Use a separate tag ruleset to block tag updates and deletions, without granting those maintainers a bypass of that rule.
- Enable [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) to lock published tags and assets. The workflow uploads all assets to a draft before publishing, so it works with immutability enabled.

The workflow authenticates with the built-in `GITHUB_TOKEN`. Only the publishing job requests `contents: write`; other jobs are read-only.

### Stable release

1. Start from the main branch:

    ```bash
    git checkout main
    npm run release:prepare -- 0.3.0
    ```

    Preparation fetches `origin` and its tags, creates and switches to `release/prepare-0.3.0` at your current commit, updates all four manifest/lockfile documents, and drafts `## [0.3.0]` in the changelog. It returns with the changes uncommitted, ready for editing. An existing version entry is preserved.

2. Review and edit `CHANGELOG.md` and any other release changes. Commit the reviewed files, push the preparation branch, open a PR, and merge after the required checks/reviews. For manual testing, use the Development build artifact and the [README verification steps](../README.md#2-verify-the-setup).
3. Check out the intended PR merge commit and tag it:

    ```bash
    git fetch origin
    git switch --detach <merged-commit-sha>
    npm run release:tag -- 0.3.0 --push
    ```

    The tag command requires a clean checkout, checks versions and notes, confirms stable commits belong to the origin default branch, and runs `npm run verify`. New tags are annotated and identify the checked-out commit, not a later default-branch tip. Existing annotated or lightweight tags are reused unchanged only when they identify that same commit. Omit `--push` to create only a local tag; add it when ready to publish. Only the selected tag is pushed.

4. Watch **Actions → Release** through publication and public installation verification. **Do not pre-create a release in the GitHub UI**: the workflow creates it with the verified assets and committed notes.

GitHub loads `.github/workflows/release.yml` from the tagged commit. Push one release tag at a time and wait for its workflow to finish. Tags pushed by another workflow using `GITHUB_TOKEN` do not normally trigger a new workflow; see [GitHub's token-trigger rules](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow).

### Preview a prerelease from a branch

Use the same process with an unused prerelease version, without merging to the default branch:

```bash
npm run release:prepare -- 0.3.0-rc.1
# Review and edit the notes and source on release/prepare-0.3.0-rc.1.
# Commit all reviewed changes, then:
npm run release:tag -- 0.3.0-rc.1 --push
```

This publishes a **real GitHub prerelease**, not a dry run. Prereleases never update latest stable. A tag fixes the source commit even if the feature branch advances. Use a new prerelease version for a changed build. For testing without publication, use the Development build artifacts or local packaging instead.

### What runs automatically

- **Build (read-only):** validate the tag/event commit, stable-branch ancestry, committed manifest versions, and changelog entry; run the full verification suite; package the verified bundle; check checksums and archive installation.
- **Publish (write access, no dependency installation):** confirm the existing remote tag still identifies the built commit, upload the three assets and committed notes into a draft, then publish. Existing releases/drafts are refused; tags and assets are never overwritten. Prereleases are explicitly excluded from latest; GitHub selects latest for stable releases.
- **Post-release (read-only):** test anonymous curl installation, installed version/commit metadata, both runtime copies, private configuration defaults, and MCP initialization/read-only tools. If this release is latest stable, test `latest/download/install.sh` too.

Publication is serialized across versions. The post-release harness uses a fake Copilot CLI for registration, but real curl, tar, packaged installer, filesystem copies, and MCP runtime. It needs no personal Copilot login or real CycleCloud credentials and sends no CycleCloud requests. It does not prove VS Code UI discovery or live CycleCloud access. Public downloads use no `GH_TOKEN`; a private repository would need a different distribution design.

### Changelog and assets

Changelog notes are drafted and reviewed during release preparation. `release:prepare` adds a `## [<version>]` entry using non-merge commit subjects, oldest first, since the nearest reachable SemVer `v*` tag through the current `HEAD`. Prerelease tags count as releases; with no release tags, the draft uses all committed history. Preparation fetches tags from `origin`; use a full-history checkout because shallow clones are rejected for drafting.

Mechanical version/preparation subjects such as `chore: prepare v0.2.0`, `chore(release): 0.2.0`, and `Bump version to 0.2.0`, plus exact changelog/release-notes update subjects, are omitted. Improvements to release tooling remain in the draft. Review the generated bullets for relevance and wording before committing them. If no subjects remain, write the version's notes manually.

Existing version entries are validated and preserved verbatim, so rerunning preparation keeps your edits. To regenerate a draft, remove only that version's entry after saving any edits you want to retain. Entries must be nonempty and unique; a ` - YYYY-MM-DD` heading suffix is also accepted. Publication uses only the chosen version's committed entry. Versions follow SemVer without a build-metadata suffix.

Each release contains:

- `cyclecloud-mcp-<version>.tar.gz`: the complete plugin, built runtime, hidden marketplace metadata, and `SOURCE_COMMIT.json`.
- `install.sh`: a curl bootstrap with the exact release URL embedded; even a download through `latest` then fetches assets from that fixed version.
- `SHA256SUMS`: checksums for the archive and bootstrap (integrity checks, not signatures).

GitHub Release assets do not expire with Actions retention. The one-day Actions artifact only transfers verified files between jobs. Local archives can include working-tree changes; published assets always use the pinned tag-event commit.

For local verification, run `npm run verify`. It includes tag validation, isolated publication fixtures, and real curl/HTTP installation tests without remote writes. To build release assets locally, run `npm run package:release -- v0.2.0` after preparing that version. To recheck an existing public release independently:

```bash
npm run verify:release -- v0.2.0 <full-commit-sha>
```

Append `--latest` only when it is the current latest stable release. Verification uses an isolated home, not your installed plugin or credentials.

### Failure and retry behavior

- **Preparation:** a new preparation branch requires a clean checkout and an unused version. If its branch already exists, inspect and switch to it before rerunning; the command does not reset branches or discard edits. Rerunning on the matching preparation branch preserves review edits, including uncommitted changes. Fix fetch/authentication failures before retrying. If a file write fails after branch creation, the branch and files remain for inspection and repair.
- **Local tagging:** version/notes mismatches, unmerged stable commits, dirty checkouts, or failed verification stop tagging. Existing tags are reused only when they identify the selected commit; conflicting tags are never moved. If a push fails, the local tag remains: fix the cause and rerun `npm run release:tag -- <version> --push`. A matching tag already on origin is left unchanged and does not trigger another workflow run.
- **Validation/build failed:** no release was created. For transient failures, use **Re-run failed jobs** on the original run. If the tagged source needs changes, commit a fix and use a new version/tag; do not move the old tag.
- **Publication failed:** inspect GitHub first. An upload failure can leave an unpublished draft; the workflow deliberately refuses to overwrite it. After inspecting it, either finish that draft manually with the verified assets, or delete only the incomplete draft (keep its tag) and rerun the failed publishing job. If the transfer artifact has expired, rebuild by rerunning the original workflow. If publication actually succeeded despite a connection error, verify the existing release instead of trying to publish it again.
- **Post-release check failed:** the release is already public, not rolled back. Rerun the failed verification job for transient download failures. For a package defect, release a new version; never replace published assets or move its tag.

Install and update using the release bootstrap or extracted package.

## Application authoring skill

See [the authoring guide](application-authoring.md) for the new skill skeleton, local checker, and manual demo checklist. Skill changes require a **full local package installation**, not `npm run deploy`, which copies only the MCP bundle. Adding skill files also requires updating the explicit file lists in `scripts/package-local.mjs`, `install.sh`, and the packaging test in `tests/local-install.test.ts`.

## Reset installation state

Reset the installation when you need to test installation and credential setup from scratch, verify cleanup and reinstallation behavior, or rule out stale installed files, plugin registrations, or filesystem caches while debugging. For routine code changes, rerun `npm run install:local` instead of resetting.

### Choose your test environment

- **Normal development or debugging:** use your regular VS Code profile. You do not need a disposable profile to reset and reinstall the plugin.
- **First-install testing:** use an empty disposable profile to test discovery, enablement, and access choices without your regular profile's saved settings. Resetting the installed plugin alone does not clear all of VS Code's remembered state. Do not create or open the disposable profile until after applying the reset, or the profile can discover the existing shared plugin before it is removed.

Profiles isolate VS Code settings and private plugin state, **not the installed plugin or its processes**. They share the same home directory and `~/.copilot` installation and credentials, so resetting from a test profile also affects the installation used by your regular profile. Switching profiles is not a workaround for a running-process reset refusal; follow the shutdown steps below regardless of which profile you choose.

### Reset and reinstall

The utility requires **Python 3.9+** and Copilot CLI on Linux, macOS, or WSL; do not use sudo. **Applying the reset deletes the plugin's stored credentials**, so be ready to configure them again during installation.

1. Stop standalone Copilot CLI sessions using this plugin and **fully quit VS Code and VS Code Insiders**, including the disposable-profile window if you created one.
2. Open a **standalone terminal** (a standalone WSL terminal for a WSL checkout, not VS Code's integrated terminal) and change to this checkout.
3. Preview the reset and review the listed paths:

    ```bash
    npm run reset:dev
    ```

4. Apply the reset **before reopening VS Code**:

    ```bash
    npm run reset:dev:apply
    ```

    This is shorthand for `npm run reset:dev -- --apply`. Avoid editing the affected configuration files during reset. Rerunning is safe when the installation is already absent.

The utility discovers standard stable/Insiders profiles, including the Windows desktop profile from WSL. For a custom VS Code user-data directory, append `-- --vscode-data-dir /path/to/user-data` to **both** npm commands above; repeat the flag for additional directories.

If the reset reports `Stop the installed CycleCloud MCP process before --apply`, ensure the owning agent/editor has exited. VS Code's MCP picker can show `cyclecloud` as **Stopped** while a Copilot headless agent still owns a running MCP subprocess. The guard checks for installed or cached MCP processes, not whether VS Code is open, but fully quitting the editor is the reliable way to stop editor-owned instances. The reset never kills processes itself.

For first-install testing, prepare the disposable profile now, while the shared plugin installation is absent:

1. Open VS Code and choose **File → New Window with Profile → New Profile…**.
2. Create an empty profile named `CycleCloud MCP Test`, without copying settings or extensions from an existing profile, and open a window with it.
3. Install or enable GitHub Copilot in that profile if needed, then open this repository in the same Linux, macOS, or WSL environment.
4. Fully quit VS Code and VS Code Insiders again before reinstalling.

Keep VS Code closed while reinstalling so an agent cannot launch the server before installation is complete. Choose one reinstall path:

- Current local checkout:

    ```bash
    npm run install:local
    ```

- Published release: download, verify, and extract the chosen [release archive](../README.md#1-install-and-configure), then run:

    ```bash
    sh /path/to/extracted/cyclecloud-mcp/install.sh
    ```

Then reopen VS Code with your chosen profile and this repository. Verify that `cyclecloud-mcp` is enabled in **Agent Plugins: Installed**, start a new agent session, and follow the [quick-start verification steps](../README.md#2-verify-the-setup).

When first-install testing is complete, switch back to your normal profile and remove `CycleCloud MCP Test` using VS Code's profile management UI. Removing the profile does not undo changes to the shared plugin installation.

### Scope and limitations

The reset unregisters this plugin and marketplace, deletes the Copilot plugin data directory (including credentials), installed and managed packages, `~/.local/share/cyclecloud-mcp/`, and known filesystem plugin caches. It also removes matching user-level MCP/plugin registrations and clears this plugin's explicit enablement flags in JSON settings.

The checkout, build artifacts, unrelated plugins/settings, and shared logs/session history are preserved. The reset does not open or modify VS Code's `state.vscdb`: remembered plugin enablement, marketplace trust, and tool metadata in that database remain, so reinstalling in an existing profile may retain previous choices. This is why first-install testing uses a disposable profile in addition to the installation reset.

Custom Copilot homes, unrecognized installations, and targeted JSONC configuration require manual cleanup; the script stops rather than rewriting comments or guessing. Workspace-specific registrations outside the standard user configuration files are not removed. This is an installation reset, not secure erasure or revocation of the CycleCloud account's password.

The developer utility is excluded from the `package:local` artifact and is never invoked by the normal installer. Its isolated cleanup and database-preservation tests run with `npm run test:reset` and as part of `npm run verify`.

## Bundle-only deployment

Use [local installation](#install-a-local-or-unpublished-build) for full plugin changes, including manifests. The **bundle-only** deployment commands below target an existing default copy-based installation; they do not target a live local marketplace installation.

To test only server-bundle changes through that copy-based installation, run from this checkout:

```bash
npm run deploy
```

This rebuilds the bundle and replaces `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/bin/cyclecloud-mcp.mjs`. The plugin must already be installed at that default path. Its original bundle is saved alongside it as `cyclecloud-mcp.mjs.before-local-test`; repeated deploys preserve that original backup. Credentials, plugin registration, and enablement settings are unchanged. Nothing is committed, pushed, or published.

Reload VS Code and start a fresh Copilot session after each deploy. Then ask the tool to exercise your change.

To undo the deployment:

```bash
npm run restore
```

Restore replaces the installed bundle with the original and removes the used backup; it does not require a local build. Restart the session/server again afterward. Restore before installing a new package so a later restore cannot roll that update back. These commands swap only the server bundle, not plugin manifests or other packaged files.

## Further reading

- [Design and architecture](cyclecloud-mcp-design.md)
- [Configuration and security](configuration.md)
- [Troubleshooting and local installation](troubleshooting.md)
