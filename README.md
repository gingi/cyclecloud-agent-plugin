# Azure CycleCloud Agent Plugin

Inspect CycleCloud clusters and draft application projects from Copilot CLI or Copilot in VS Code. The plugin uses your existing CycleCloud CLI configuration for read-only inspection. Its authoring skill prepares project files for review; it does not deploy them.

This is a proof of concept. The application skeleton is incomplete, and host/platform testing is limited. See [verification status](docs/development.md#verification-status) before relying on it in your environment.

## Prerequisites

- Linux, macOS, or WSL in the environment executing agent commands. Native Windows is not qualified; macOS execution has not yet been verified.
- An official CycleCloud CLI **8.10.x** installation on PATH, or an absolute `CYCLECLOUD_CLI` override. Other versions require compatible native inspection support; see [CLI compatibility](docs/cli-contract.md#cli-compatibility).
- Copilot CLI 1.0.81+ or VS Code with Agent Plugins enabled. Sign in to the agent host separately.
- For connected inspection: a reachable CycleCloud instance and a least-privilege CLI account with the required read access.
- **Only for the authoring checker:** Node.js and Bash. Inspection and plugin installation do not need npm dependencies.

Review the plugin before installation: its helpers run with your OS user's permissions.

## Quick start

### 1. Configure the CycleCloud CLI

```sh
cyclecloud --version
```

If needed, install the CLI from your trusted CycleCloud instance's **Download CLI Tools** link, then run `cyclecloud initialize` in an interactive terminal. Never paste passwords or tokens into chat. See [configuration](docs/configuration.md) for PATH/WSL differences, authentication, private CAs, and selecting an existing configuration file.

### 2. Install the plugin from local source

Use a reviewed source checkout containing the `cyclecloud` plugin or an extracted source package in a **persistent directory**. The planned repository distribution, `gingi/cyclecloud-agent-plugin`, is not available until the repository rename and this version are published; use local source for now.

For **Copilot CLI**, replace the example path with your source directory:

```sh
copilot plugin marketplace add /absolute/path/to/cyclecloud-agent-plugin
copilot plugin install cyclecloud@cyclecloud
```

Keep the source directory in place while using the plugin. A local marketplace can read that directory directly. No build or `npm install` is needed.

For **VS Code**, enable Agent Plugins and register the same persistent directory in settings:

```json
{
    "chat.plugins.enabled": true,
    "chat.pluginLocations": {
        "/absolute/path/to/cyclecloud-agent-plugin": true
    }
}
```

Merge these settings with existing entries, using a path visible to the VS Code environment executing agent commands. Start a new agent session after installation. VS Code enablement is separate from Copilot CLI registration; see [host discovery troubleshooting](docs/troubleshooting.md#host-discovery) if the skills do not appear.

For exact releases and previews, use the selected archive rather than repository registration. See [source installation options](docs/development.md#install-a-local-or-unpublished-build).

### 3. Check compatibility and inspect a cluster

From your source directory:

```sh
sh scripts/cyclecloud-inspect capabilities
sh scripts/cyclecloud-inspect clusters --schema-version 1
```

The first command checks local CLI compatibility without contacting CycleCloud. A successful response contains `result.cliVersion`, `result.inspectionContracts`, and `result.backend`. The second command contacts your configured instance and returns cluster names under `result.clusters`; an empty list means no clusters were returned. Failures contain an `error` object with a code and guidance instead of `result`.

To select another CLI installation:

```sh
CYCLECLOUD_CLI="/absolute/path/to/cyclecloud" sh scripts/cyclecloud-inspect capabilities
```

In an agent session, ask:

- “List my CycleCloud clusters.”
- “Show capacity and issues for cluster `demo`.”
- “Get application authoring context for `demo`, targeting `scheduler` and `hpc`.”
- “Prepare a cluster-init application project using the configured cluster environment.”

Replace `demo` with your cluster's name. Review terminal tool-call approvals. For setup or request failures, use the [troubleshooting guide](docs/troubleshooting.md).

## What inspection provides

| Command                    | Result                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `clusters`                 | Bounded, sorted cluster summaries                               |
| `cluster NAME`             | Lifecycle/configured node and nodearray details                 |
| `status NAME`              | Capacity/buckets and grouped errors/warnings                    |
| `application-context NAME` | Overview, then selected environment/storage/attachment evidence |

Data commands use `--schema-version 1` and return JSON under `result`. Run `sh scripts/cyclecloud-inspect --help` for options, or read the [CLI reference](docs/cli-contract.md).

Issue counts are per condition, not distinct affected-node totals. Unavailable issue queries are not proof of no errors. Application context describes configuration, not installed software or working mounts. Collections are paged and byte-limited; follow `nextOffset` when you need more entries. See [application-context semantics](docs/application-context.md).

## Draft an application project

The `author-cyclecloud-application` skill prepares cluster-init project files, an OpenFOAM/Slurm example, and an `ATTACHMENT.md` handoff. The bundled skeleton is deliberately unfinished: its scripts exit without installing or running anything until implemented. No OpenFOAM/platform/MPI combination has been validated.

Start with the [application authoring guide](docs/application-authoring.md) for an example request, expected files, and local checks. Upload, attachment, lifecycle changes, installation, and job submission require separate approval. Host permissions and CycleCloud RBAC are the authorization boundaries.

## Update or remove

For a local marketplace, update the reviewed source in its persistent location and refresh the host. For repository installations, use the host's native plugin update mechanism. Recheck compatibility after changing the CLI or plugin, and preserve any deliberate disabled state.

To remove a marketplace installation from Copilot CLI:

```sh
copilot plugin uninstall cyclecloud@cyclecloud
copilot plugin marketplace remove cyclecloud
```

Remove or disable the corresponding VS Code source separately through its UI/settings. Plugin removal leaves your CLI configuration and credentials intact; credential deletion or revocation is a separate decision.

## For contributors

See [development and verification](docs/development.md), [architecture](docs/agent-plugin-design.md), and [release history](CHANGELOG.md).
