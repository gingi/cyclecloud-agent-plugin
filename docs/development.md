# Development guide

For normal installation and usage, see the [README](../README.md). This guide covers building, verifying, and testing changes from a development checkout.

## Setup and verification

Use the [runtime prerequisites](../README.md#quick-start-copilot-in-vs-code), plus **Python 3.9+** for the developer reset utility and its tests.

Install development dependencies and run verification:

```bash
npm ci --ignore-scripts
npm run verify
```

Verification runs formatting checks, lint, typecheck, bundle generation, tests (including the developer reset tests), and a dependency audit. The dependency-complete `bin/cyclecloud-mcp.mjs` is committed; users do not need to build it.

## Install a local or unpublished build

From this checkout, with development dependencies installed:

```bash
npm run install:local
```

This builds and packages the **complete plugin**, registers a persistent local marketplace under `~/.local/share/cyclecloud-mcp/marketplace/`, and maintains an identical runtime copy under `~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/` for VS Code discovery. Both use the same private credential file as remote installations. Rerunning updates changed files in both locations, repairs missing files, and leaves identical payloads alone. It preserves existing credentials and disabled state. The checkout is needed only to build—not to run the installed plugin.

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

## Reset installation state (development only)

To preview a fresh-install reset:

```bash
npm run reset:dev
```

To perform it, fully quit VS Code (including Insiders), stop agent sessions using this plugin, and run from a standalone terminal:

```bash
npm run reset:dev -- --apply
```

**This deletes credentials.** It unregisters this plugin and marketplace, deletes the Copilot plugin data directory, installed and managed packages, `~/.local/share/cyclecloud-mcp/`, and known plugin caches, removes matching user-level MCP entries, and clears this plugin's CLI disablement and VS Code enablement/tool-cache/trust entries. Review the preview's paths before applying. Rerunning is safe when the installation is already absent.

The utility requires **Python 3.9+** and Copilot CLI on Linux, macOS, or WSL; do not use sudo. It discovers standard stable/Insiders profiles, including the Windows desktop profile from WSL. For a custom VS Code user-data directory, append `--vscode-data-dir /path/to/user-data` (repeatable). It refuses to apply while an editor or an installed CycleCloud MCP process is running; it never kills processes.

The checkout, build artifacts, unrelated plugins/settings, and shared logs/session history are preserved. Custom Copilot homes, unrecognized installations, and targeted JSONC configuration require manual cleanup; the script stops rather than rewriting comments or guessing. Workspace-specific registrations outside the standard user configuration files are not removed. This is an installation reset, not secure erasure or revocation of the CycleCloud account's password.

The developer utility is excluded from the `package:local` artifact and is never invoked by the normal installer. Its isolated filesystem/SQLite tests run with `npm run test:reset` and as part of `npm run verify`.

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
