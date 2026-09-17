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

Releases use a short-lived **release-preparation PR**. Request a version, review its version changes and release notes, and merge it only after checks and human approval. Publication happens from the PR's recorded merge commit, never from an arbitrary later `main`. SemVer prereleases such as `0.2.0-rc.1` are supported (no build-metadata suffix).

**Prepare or preview release** has two explicit modes: `request` opens a reviewed release PR from `main`; `preview` publishes a prerelease from a non-default branch. **Release** still runs only after an approved release PR merges. Both publication paths call the same reusable **Build and publish release** workflow, so build, packaging, checksums, and curl verification do not diverge. Direct tag pushes do not publish releases.

### One-time repository setup

GitHub requires the dispatchable `prepare-release.yml` to exist on the default branch. That initial setup is already sufficient to dispatch an updated copy from another branch, including its branch-local reusable workflow. Configure branch protection or a ruleset on `main` to require PRs, the **Build, verify, and package** check, and human approval. Dismiss stale approvals when the PR head changes. The release workflow also checks for a non-author human owner/member/collaborator's approval of the final PR head and rejects outstanding changes-requested reviews. It does not approve or merge PRs, and it does not configure repository rules on your behalf.

Choose the preparation workflow's authentication:

- **Recommended for automatic PR checks:** install a GitHub App on this repository with **Contents: read/write** and **Pull requests: read/write**. Set the repository Actions variable `RELEASE_APP_CLIENT_ID` and secret `RELEASE_APP_PRIVATE_KEY`. The workflow uses `actions/create-github-app-token` to create a short-lived, current-repository-scoped token. PRs use the app's identity, so a maintainer can review them even in a single-maintainer repository.
- **Without an App:** the workflow uses `GITHUB_TOKEN`. Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. The automation only creates PRs; it never approves them. GitHub may hold the bot-created PR's `opened`/`synchronize` workflow runs for a maintainer to select **Approve workflows to run**. Approve those checks separately from reviewing the PR. The run summary reminds you of this step.

See [GitHub's token-trigger rules](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow). Use human merge/auto-merge with the required reviews; a merge performed by an independent workflow using `GITHUB_TOKEN` may suppress the downstream release event.

### Reviewed releases

1. Choose **Actions → Prepare or preview release → Run workflow**, select `main`, mode `request`, and the desired version without `v`. Or run:

    ```bash
    gh workflow run prepare-release.yml --ref main -f mode=request -f version=0.1.0
    ```

    This creates `release/v0.1.0` and a PR against `main`, not a tag or release. It updates all package/plugin/marketplace versions and prepares the `0.1.0` entry in the top-level `CHANGELOG.md`, preserving earlier release history. No new commit reaches `main` until you merge the PR.

2. Review the version changes and changelog entry. The **Development build** checks the release branch name against all manifest versions and requires a nonempty changelog entry for that version before running the full suite. Wait for those checks; download its complete package artifact for manual testing. Approve the final PR head, then merge it. A repeat request for the same version reuses the open PR **without overwriting reviewer edits**; use GitHub's normal branch-update mechanism if the base has advanced.

3. Watch the **Release** workflow through build, publication, public curl verification, and cleanup. Its summary links the release and records post-release status. The preparation branch is deleted only after successful verification, only if it still points at the merged PR head, and only if no other open PR uses it. If GitHub already auto-deleted the branch, cleanup does nothing.

Follow the [README verification steps](../README.md#2-verify-the-setup) for a real Copilot/VS Code and CycleCloud smoke test when preparing a demo.

### Preview a prerelease from a branch

Preview mode needs repository write access to dispatch Actions, but no new GitHub settings, App secret, or PR approval. Its publishing job explicitly requests `contents: write`; the repository's default token permissions can stay read-only. Keep branch protection on `main`. If you later add tag rules, ensure they allow the workflow to create the chosen prerelease tag.

The existing `prepare-release.yml` must already be registered on the default branch. Once it is, you can change that workflow on a feature branch and invoke **the branch's definition** with `--ref`. The relative reusable workflow is loaded from that same commit; it does not first need merging into `main`. While testing branch-only inputs, use the CLI rather than relying on the default branch's Run workflow form.

To test `0.1.0-rc.3`, use an unused version and a non-default branch containing your build changes:

1. Add notes under `## [Unreleased]` in `CHANGELOG.md` (or write the exact `## [0.1.0-rc.3]` entry yourself).
2. Prepare the version, run verification, and commit **all intended workflow/code changes**, the four manifest/lockfile changes, and `CHANGELOG.md` on that branch:

    ```bash
    npm run release:prepare -- 0.1.0-rc.3
    npm run verify
    # Review and commit the changes on your feature branch, then:
    git push -u origin HEAD
    ```

3. Dispatch the preview from that branch:

    ```bash
    gh workflow run prepare-release.yml \
        --ref feat/preview-releases \
        -f mode=preview \
        -f version=0.1.0-rc.3
    ```

    Replace the branch name as needed. This publishes a **real GitHub prerelease**, not a dry run. Preview mode rejects stable versions, `main`, tag refs, mismatched versions, missing changelog entries, and dirty or mismatched source checkouts. It never edits the source to silently stamp a different version into the build: manifests and notes must already be committed.

The dispatch pins the selected branch commit even if the branch advances during the run. The workflow creates/verifies the tag at that commit, uploads persistent assets with `--prerelease --latest=false`, and tests the version-pinned public curl installer. It creates no release PR, makes no commit on `main`, never updates latest stable, and never deletes the preview source branch. Tag immutability and no-overwrite rules still apply; use `rc.4` for another build after changing the source.

### Changelog format

`CHANGELOG.md` is the only maintained release-notes document. Use `## [Unreleased]` for pending notes and `## [<version>]` for each release; a ` - YYYY-MM-DD` suffix is also accepted. Subsections such as `### Added` belong inside a version's entry. Entries must be nonempty and unique; headings inside fenced examples are not treated as releases.

`release:prepare` promotes nonempty Unreleased notes to the requested version and keeps older entries. If that version already has notes, they are preserved. With no matching entry or pending notes, the local command stops before writing version changes. The hosted release-PR operation can fall back to GitHub-generated notes when Unreleased is empty. Publication extracts **only the chosen version's entry** from the committed changelog, not the entire release history.

### What runs automatically

- **Preparation:** use a clean checkout of the default branch to prepare version changes and release notes, then create one branch commit and PR through GitHub's API. The checkout is not modified, and no tag or public release is created. Requests refuse existing tags, closed release PRs, and orphan branches instead of overwriting them.
- **Shared build (read-only):** reviewed mode accepts only approved, merged `release/v<version>` PRs and pins their recorded merge SHA. Preview mode accepts only explicit prerelease dispatches on non-default branches and pins the dispatch SHA, without PR approval. Both modes validate committed manifests and the matching changelog entry, run the full suite, package the verified bundle, and check archive installation.
- **Publish (write access, no dependency installation):** create/verify `v<version>` at the validated SHA and publish the three assets with the selected **committed changelog entry**, not newly generated notes. Existing tags are never moved and existing releases are never overwritten. Tagging and publishing stay in one run; they do not depend on token-created push events.
- **Post-release (read-only):** test anonymous curl installation from the published, version-pinned bootstrap, then check installed version/commit metadata, both runtime copies, private configuration defaults, and MCP initialization/read-only tools. If this is latest stable, test `latest/download/install.sh` too. Prereleases do not change latest stable.
- **Reviewed-release cleanup only (write access, no dependency installation):** remove the preparation branch using an explicit head-SHA lease, protecting commits pushed after the PR merged. Previews have no cleanup job. Changed branches or branches with another open PR are retained.

The post-release harness uses a fake Copilot CLI for registration, but real curl, tar, packaged installer, filesystem copies, and MCP runtime. It needs no personal Copilot login or CycleCloud credentials and sends no CycleCloud requests. It does not prove VS Code UI discovery or live CycleCloud access. Public downloads are tested without `GH_TOKEN`; making the repository private would require a different distribution/verification design.

Publication is serialized across versions so publishing and latest-link verification do not race within this workflow. A release not selected as latest still gets its version-pinned installation verified; the summary explains why the latest check was skipped.

### Persistent assets and local checks

Each release contains:

- `cyclecloud-mcp-<version>.tar.gz`: a complete `cyclecloud-mcp/` directory, including the built runtime, hidden marketplace metadata, and `SOURCE_COMMIT.json` (also retained in installed copies).
- `install.sh`: a small curl bootstrap with the exact release URL embedded. Even when fetched through `latest`, its subsequent downloads use that fixed version. This is different from the archive's `install.sh`, which installs already-extracted files without network access.
- `SHA256SUMS`: checksums for the archive and bootstrap. These are integrity checks, not signatures or provenance attestations.

**GitHub Release assets have no Actions retention expiry** and remain until explicitly deleted. The one-day Actions artifact only hands verified files between jobs.

For local verification without publication, run `npm run verify`. It includes changelog and preview-gate tests, isolated GitHub-API fixtures for PR creation, approval/merge gating, and branch cleanup, plus real curl/HTTP installation tests. It creates no remote PR, tag, or release. Use the explicit preview dispatch above for a hosted branch test; a tag push alone is not a publication trigger.

To prepare versions and create all assets locally without opening a PR or publishing:

```bash
npm run release:prepare -- 0.1.0
npm run package:release -- v0.1.0
```

The local preparation command updates the four manifest/lockfile documents and promotes or retains the matching entry in `CHANGELOG.md`; `npm run release:request -- <version>` is the separate remote-PR operation used by the preparation workflow. Direct invocation of that command requires GitHub CLI authentication, `GH_REPO=owner/repository`, development dependencies, and a clean checkout matching the repository's current default branch. Prefer the workflow for its bot identity and review/check handling.

Local archives can include working-tree changes; published assets are built from the pinned merge commit or preview dispatch commit. To recheck an already published release independently, supply its full commit SHA:

```bash
npm run verify:release -- v0.1.0 <full-commit-sha>
```

Append `--latest` only when that release is the current latest stable. The command uses an isolated home, not your installed plugin or credentials.

### Failure and retry behavior

Preparation refuses dirty/stale checkouts, existing version tags, and previously closed release PRs. A request for an already-open release PR leaves its branch and reviewed files unchanged. If preparation creates a branch but PR creation fails (for example, because Actions cannot create PRs), fix the permission issue and inspect that orphan branch. Open its PR using the appropriate bot identity, or explicitly remove the inspected generated branch and request it again; the automation will not overwrite or delete it to recover. A default-branch change during preparation may require a fresh request.

A failed merged-PR approval/version/notes check or build creates no tag. The tag helper safely reuses an existing matching tag, but the publisher refuses to overwrite an existing release. If publication failed after creating a tag, rerun the original failed job so the same recorded merge commit is used. Inspect draft/partial releases before recovery; do not automatically delete or overwrite assets.

A **post-release failure means the release is already published**, not rolled back. The workflow turns red and records that fact; automatic branch cleanup does not run. Inspect the failure and use **Re-run failed jobs** for transient download failures. If the package needs a fix, request a new version's release PR or dispatch a new prerelease version from the updated preview branch; never move the old tag or replace its assets. A cleanup failure does not undo publication, and a branch with newer work or another open PR is deliberately retained. Normal installs and updates use the release bootstrap or extracted package, not repository marketplace update commands.

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
