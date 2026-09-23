# Configuration and guided setup

The plugin uses your **existing CycleCloud CLI configuration and credentials**. Configure and sign in through the CLI in an interactive terminal; inspection reuses that configuration without prompting for credentials.

## Find the executable

The launcher uses:

1. `CYCLECLOUD_CLI`, if set to an absolute executable path.
2. Otherwise, `cyclecloud` on the agent process's `PATH`.

It does not scan the filesystem, source shell startup files, interpret aliases, or execute the override as a shell command. An invalid explicit override fails instead of silently choosing another installation.

```sh
CYCLECLOUD_CLI="/absolute/path/to/cyclecloud" \
  sh "<installed-plugin-root>/scripts/cyclecloud-inspect" capabilities
```

Set the override in the environment that runs the agent. A terminal, VS Code, WSL, remote workspace and container can have different PATHs. Reload/restart the host after changing its environment. A Windows `cyclecloud.exe` visible from WSL is not a supported Linux CLI installation.

Inspection runs in the Python environment supplied by the selected CLI. Use an official embedded or virtualenv CLI installation, not a shell alias, custom wrapper, or the separate CycleCloud API SDK. You do not need to select or install another Python interpreter. See [compatibility troubleshooting](troubleshooting.md#cli-discovery-and-compatibility) if the launcher rejects the installation.

## Keep setup states separate

| State                                 | Next step                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| CLI missing                           | Offer an explicit path or opt-in installation help                                                    |
| Unsupported CLI/version/layout/schema | Explain the supported official installation and upgrade options                                       |
| Compatible CLI, missing configuration | User runs `cyclecloud initialize` in an interactive terminal                                          |
| Silent authentication cannot succeed  | User signs in again through the CLI outside chat                                                      |
| Permission or network failure         | Check account scope, connectivity, proxy/CA and the intended instance; do not reinstall automatically |

Capabilities checks are offline. Successful capabilities do not establish a login, reachable server or read permissions.

## Assisted installation is opt-in

If the CLI is absent, ask whether it is already installed elsewhere before offering installation. **Do not download or install automatically.**

The official CLI is available through **Download CLI Tools** on the CycleCloud instance's About page, or:

```text
https://<trusted-cyclecloud-host>/static/tools/cyclecloud-cli.zip
```

A guided installation should:

1. Obtain the intended instance URL if unknown. Never ask for a password/token in chat.
2. Download only from the explicitly selected trusted host over verified HTTPS. Do not disable certificate verification to make a download work.
3. Inspect the archive and installer, explain its destination and permission requirements, and obtain approval before executing it. Prefer a supported user-local installation; do not invoke sudo automatically.
4. Recheck the installed CLI's version/layout and inspection capabilities. A host-provided package may still be too old.
5. Have the user run `cyclecloud initialize` in their terminal and enter credentials there. Do not put credentials in command arguments, generated scripts, logs or chat.

See the [official installation guide](https://learn.microsoft.com/en-us/azure/cyclecloud/how-to/install-cyclecloud-cli?view=cyclecloud-8). The plugin is not a package manager: it does not silently upgrade dependencies or replace an existing CLI.

## Account and configuration selection

Use a dedicated least-privilege account scoped to the clusters needed for inspection. A CLI already configured with administrator credentials remains an administrator credential source; installing this plugin does not downgrade it.

By default the CLI's current configuration applies. Pass `--config /absolute/path/to/config.ini` to the inspection command when selecting another existing configuration. Do not read credential files into the conversation. Normal silent token refresh and CLI cache persistence may occur; browser/device-code login and credential prompts do not occur during inspection.

Supported authentication configurations are Basic, public-client silent sign-in, confidential-client, and managed identity. Unknown configurations fail explicitly. Live identity-provider integration has not been verified; see [verification status](development.md#verification-status) and validate the method required by your environment before production use.

## Transport and permissions

The bridge honors the CLI's configured transport/certificate settings and supported proxy/CA environment. It does not silently weaken verification. **An already-insecure CLI configuration remains insecure**: use verified HTTPS for remote CycleCloud, and configure the appropriate trusted CA outside chat. Identity-provider sessions are separate from the CycleCloud session and do not inherit CycleCloud credentials or an insecure certificate override.

Responses, errors and processes are bounded; redirects and automatic inspection retries are not used. Diagnostic text is untrusted data. Configuration evidence is not proof that software is installed, a mount is writable or a job can run.

The launcher exposes only read operations. Skills are guidance, not authorization. Host command approvals and CycleCloud RBAC are the actual controls; do not broadly auto-approve `cyclecloud *`. Upload, attachment, start/terminate, software installation and job submission are separate workflows requiring explicit approval.

Your CLI retains ownership of its configuration and credentials when the plugin is installed or removed. Delete or revoke credentials separately if needed.
