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

This builds and packages the **complete plugin**, registers a persistent local marketplace under `~/.local/share/cyclecloud-mcp/marketplace/`, and maintains an identical runtime copy under `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/` for VS Code discovery. Both use the same private credential file as remote installations. Rerunning updates changed files in both locations, repairs missing files, and leaves identical payloads alone. Prompts use existing configuration values as defaults and hide passwords; disabled state is preserved. Add `--skip-config` to the installer (or run `npm run install:local -- --skip-config`) to keep existing configuration unread and unchanged. The checkout is needed only to build—not to run the installed plugin.

To install elsewhere without a checkout or npm dependencies:

```bash
npm run package:local
```

Copy the complete `dist/cyclecloud-mcp/` directory to the target environment. From that directory run:

```bash
sh install.sh --local
```

Alternatively, pass the package directory explicitly: `sh /path/to/install.sh --local /path/to/package`. The input directory can be deleted afterward; **keep the managed marketplace directory**. Local installation does not fetch the plugin from GitHub, so it works before any branch is committed or published. It still requires Node and Copilot CLI.

`--local` explicitly switches this plugin's known GitHub marketplace registration to the local copy, without creating a second plugin or credential file. It refuses unrelated same-name sources. Complete the [credential setup](../README.md#1-install-and-configure) and [verification](../README.md#2-verify-the-setup) steps, then use the native `cyclecloud` tools. See [local installation and recovery](troubleshooting.md#local-installation-without-a-checkout-dependency) for details.

### Test a branch or commit from source

The repository marketplace entry resolves from the repository's default branch. `copilot plugin marketplace add gingi/cyclecloud-mcp` cannot select an arbitrary development branch or commit.

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

- Published GitHub marketplace version:

    ```bash
    (set -o pipefail; curl -fsSL https://raw.githubusercontent.com/gingi/cyclecloud-mcp/main/install.sh | sh)
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

Restore replaces the installed bundle with the original and removes the used backup; it does not require a local build. Restart the session/server again afterward. Restore before running a marketplace update so a later restore cannot roll that update back. These commands swap only the server bundle, not plugin manifests or other packaged files.

## Further reading

- [Design and architecture](cyclecloud-mcp-design.md)
- [Configuration and security](configuration.md)
- [Troubleshooting and local installation](troubleshooting.md)
