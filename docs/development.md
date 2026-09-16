# Development guide

For normal installation and usage, see the [README](../README.md). This guide covers building, verifying, and testing changes from a development checkout.

## Setup and verification

Use the [runtime prerequisites](../README.md#quick-start-copilot-cli-and-copilot-in-vs-code), plus **Python 3.9+** for the developer reset utility and the reset/installer terminal tests.

Install development dependencies and run verification:

```bash
npm ci --ignore-scripts
npm run verify
```

Verification runs formatting checks, lint, typecheck, bundle generation, tests (including the developer reset tests), and a dependency audit. `bin/cyclecloud-mcp.mjs` is generated and ignored, not committed. A clean source checkout therefore needs its development dependencies and `npm run build` (or a command such as `npm run verify`, `npm test`, `npm run package:local`, or `npm run install:local` that builds first).

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

The **Release** workflow automates validation, packaging, tag creation, publication, and post-release verification. Run it manually from `main` with the version already merged there; no manual `git tag` or tag push is required. Manually pushed `v<version>` tags remain supported. SemVer prereleases such as `0.2.0-rc.1` are supported (no build-metadata suffix).

### Maintainer steps

1. Install development dependencies, then prepare the intended version and verify locally:

    ```bash
    npm run release:prepare -- 0.1.0
    npm run verify
    ```

    `release:prepare` updates `package.json`, both root versions in `package-lock.json`, `plugin.json`, and both marketplace versions together, preserving formatting. The MCP handshake version comes from `package.json` at build time. The command does **not** commit, tag, push, or publish. Review and merge the version changes through the normal PR process. For the first release, existing matching `0.1.0` versions need no bump.

2. After merging, choose **Actions → Release → Run workflow**, select `main`, and enter `0.1.0` (without `v`). Or dispatch it with GitHub CLI:

    ```bash
    gh workflow run release.yml --ref main -f version=0.1.0
    ```

    This is the publishing action. The workflow must exist on the default branch. Manual dispatch from another branch is refused. The run pins the selected commit even if `main` advances while verification is running.

3. Check that **all three jobs**, including **Verify public curl installation**, pass. The run summary links the release and records post-release verification status. Follow the [README verification steps](../README.md#2-verify-the-setup) for a real Copilot/VS Code and CycleCloud smoke test when preparing a demo.

### What runs automatically

- **Build (read-only):** check the requested version against every manifest/lockfile version; run the full verification suite, including local HTTP/curl regression tests; build the complete package and its source-commit metadata; verify checksums and the extracted package's default installer.
- **Publish (write access, no dependency installation):** create `v<version>` at the exact verified commit, or verify that an existing tag peels to that same commit. A different target is an error, never a forced tag update. Publish all three assets with generated release notes. Tagging and publishing occur in the **same run** because a tag created with `GITHUB_TOKEN` does not trigger another push workflow.
- **Post-release (read-only):** download the publicly published, version-pinned bootstrap through a real anonymous `curl ... | sh` pipeline. Verify checksums, installation into a temporary home, the installed version and commit, identical CLI/VS Code runtime copies, private configuration defaults, and the installed MCP bundle's initialization and read-only tool inventory. If this is the latest stable release, test the README's `latest/download/install.sh` endpoint too. Prereleases do not change latest stable.

The post-release harness uses a fake Copilot CLI for registration, but real curl, tar, packaged installer, filesystem copies, and MCP runtime. It needs no personal Copilot login or CycleCloud credentials and sends no CycleCloud requests. It does not prove VS Code UI discovery or live CycleCloud access. Public downloads are tested without `GH_TOKEN`; making the repository private would require a different distribution/verification design.

Releases are serialized so publishing and latest-link verification do not race within this workflow. A release not selected as latest still gets its version-pinned installation verified; the summary explains why the latest check was skipped.

### Persistent assets and local checks

Each release contains:

- `cyclecloud-mcp-<version>.tar.gz`: a complete `cyclecloud-mcp/` directory, including the built runtime, hidden marketplace metadata, and `SOURCE_COMMIT.json` (also retained in installed copies).
- `install.sh`: a small curl bootstrap with the exact release URL embedded. Even when fetched through `latest`, its subsequent downloads use that fixed version. This is different from the archive's `install.sh`, which installs already-extracted files without network access.
- `SHA256SUMS`: checksums for the archive and bootstrap. These are integrity checks, not signatures or provenance attestations.

**GitHub Release assets have no Actions retention expiry** and remain until explicitly deleted. The one-day Actions artifact only hands verified files between jobs.

To create all assets locally without publishing:

```bash
npm run package:release -- v0.1.0
```

Local archives can include working-tree changes; official assets are built from the workflow's pinned commit. To recheck an already published release independently, supply its full commit SHA:

```bash
npm run verify:release -- v0.1.0 <full-commit-sha>
```

Append `--latest` only when that release is the current latest stable. The command uses an isolated home, not your installed plugin or credentials.

### Failure and retry behavior

A build failure creates no tag. The tag helper safely reuses an existing matching tag, but the publisher refuses to overwrite an existing release. If publication failed after creating a tag, rerun the original failed job rather than dispatching from a newer commit. Inspect draft/partial releases before recovery; do not automatically delete or overwrite assets.

A **post-release failure means the release is already published**, not rolled back. The workflow turns red and records that fact. Inspect the failure and use **Re-run failed jobs** for transient download failures. If the package needs a fix, prepare and publish a new version; never move the old tag or replace its assets. Normal installs and updates use the release bootstrap or extracted package, not repository marketplace update commands.

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
