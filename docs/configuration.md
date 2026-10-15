# Configuration and guided setup

The CLI owns configuration, authentication and transport. The plugin invokes that executable directly; it has no separate credential store or API adapter.

## Find the executable

The skills select:

1. `CYCLECLOUD_CLI`, if set to an absolute executable path.
2. Otherwise, `cyclecloud` resolved from the agent process's PATH.

An invalid explicit override is an error, not permission to substitute another installation. Treat the override as one executable, never shell code. Quote the selected path and all argument values. Do not scan the filesystem, source shell profiles, assume an alias works in the agent shell, or import the CLI's private Python modules.

For example, after setting the override in the agent environment:

```sh
"$CYCLECLOUD_CLI" --help --format json
```

For a one-off manual check, invoke the intended absolute executable directly. `CYCLECLOUD_CLI` is a plugin selection convention, not a global setting that makes a different `cyclecloud` executable redirect itself.

The host, terminal, WSL distribution, remote workspace and container can have different PATHs. Reload the host after changing its environment. Select a CLI supported in the execution environment. The plugin invokes its executable directly without requiring a particular Python or package layout. This does not establish that every cross-platform combination works.

## Initialize and authenticate

For first-time setup, run the selected CLI's `initialize` command in your own interactive terminal. Enter credentials only in its prompts. Use the same executable and intended configuration as subsequent reads.

Help discovery is offline. It does not check the server, credentials or account permissions. Execution with `show_nodes --format json` retains existing authentication behavior: it may prompt or start interactive authentication, and may refresh/persist tokens. Requesting JSON does not make the command noninteractive. If login is required, stop and guide the user to their own interactive terminal; do not run an unattended wizard, supply credentials through the agent, or retry under another identity.

If an existing configuration fails authentication, confirm the intended instance/account, then run:

```sh
cyclecloud initialize --force
```

Substitute the selected executable and existing `--config` if applicable. Plain `initialize` can report that configuration loads without validating credentials. **`--force` reruns setup and may modify the active profile.** It is a deliberate operator action, not an automatic retry. Never ask for passwords/tokens in chat or place them in command arguments.

## Assisted installation is opt-in

If the CLI is missing, first ask whether it is installed elsewhere. **Do not download or install automatically.** The official package is available through **Download CLI Tools** on the intended instance's About page, or:

```text
https://<trusted-cyclecloud-host>/static/tools/cyclecloud-cli.zip
```

For an approved installation:

1. Confirm the intended trusted instance and use verified HTTPS; never disable certificate checks to download.
2. Inspect the archive/installer and explain destination and permissions before requesting execution approval. Do not invoke sudo automatically.
3. Recheck the installed CLI's actual help/options/contracts. A host-provided package may still lack the required capability; do not assume a product version or snapshot contains it.
4. Let the user initialize/sign in through their terminal.

See the [official installation guide](https://learn.microsoft.com/en-us/azure/cyclecloud/how-to/install-cyclecloud-cli?view=cyclecloud-8). Upgrading remains an explicit operator decision.

## Account and configuration selection

Use a least-privilege account scoped to the intended clusters. Installing the plugin does not reduce the permissions of an existing administrator identity.

Keep the same executable and configuration throughout an investigation. The CLI's current configuration applies by default. To select another existing configuration, use the command's documented `--config` option with the intended path; do not switch profiles silently or read credential files into the conversation. Use the path syntax supported by the selected CLI and execution environment.

## Transport and authorization

The selected CLI controls certificate verification, proxies, retries, timeouts and output behavior. Cluster JSON and kind-selected node readers have documented limits on data requests and responses and reject data-view redirects; these limits do not apply to legacy authentication or setup. The plugin does not add transport bounds or isolation. An already-insecure CLI configuration remains insecure; use verified HTTPS remotely and configure trusted CAs outside chat. Never weaken transport settings in response to a failed read.

Host terminal approvals and CycleCloud RBAC are the actual controls. Skill prose and command metadata are guidance, not a sandbox. Do not broadly approve `cyclecloud *`. Uploads, attachment edits, lifecycle actions, GHR submission, SSH, installation and jobs require separate approval.

CLI configuration and credentials remain owned by the CLI when the plugin is installed or removed. See [troubleshooting](troubleshooting.md) for failure-specific guidance.
