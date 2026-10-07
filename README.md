# Azure CycleCloud Agent Plugin

Use the existing CycleCloud CLI to investigate clusters and draft application projects from Copilot CLI or Copilot in VS Code. The plugin discovers the installed CLI's capabilities and composes supported commands. It does not implement a second API client or deploy the projects it authors.

This is a proof of concept with an incomplete application skeleton. See [scope and limitations](docs/development.md#scope-and-limitations) before relying on it in your environment.

## Prerequisites

- A CycleCloud CLI executable available in the environment running agent commands, on PATH or selected by an absolute `CYCLECLOUD_CLI` path. Support is determined per capability, not by a single version threshold.
- Copilot CLI 1.0.81+ or VS Code with Agent Plugins enabled. Sign in to the agent host separately.
- For connected reads: a reachable CycleCloud instance and a least-privilege CLI account with the required access.
- **Only for the authoring checker:** Node.js and Bash. Plugin installation and CLI discovery do not need npm dependencies or plugin-owned Python code.

The shell examples use POSIX syntax. Validate the CLI, shell and host combination in your deployment; WSL/remote agents do not automatically share the desktop's PATH. Review the plugin before installation: host tools run with your OS user's permissions.

## Quick start

### 1. Configure the CycleCloud CLI

```sh
cyclecloud --version
cyclecloud --help --format json
```

A CLI implementing structured discovery returns `cyclecloud.help.v1`. Older CLIs can return text or reject the help-format request; the plugin can consult text help and explain the exact capability gap. A version string or successful discovery does not establish a login or server compatibility.

If needed, install the CLI from your trusted CycleCloud instance's **Download CLI Tools** link, then run `cyclecloud initialize` in your own interactive terminal. Never paste passwords or tokens into chat. See [configuration](docs/configuration.md) for executable selection, authentication recovery, private CAs and existing configuration selection.

### 2. Install the plugin

Install from [gingi/cyclecloud-agent-plugin](https://github.com/gingi/cyclecloud-agent-plugin). No source checkout, build or `npm install` is needed.

For **Copilot CLI**:

```sh
copilot plugin marketplace add gingi/cyclecloud-agent-plugin
copilot plugin install cyclecloud@cyclecloud
```

For **VS Code**:

1. Enable Agent Plugins with `"chat.plugins.enabled": true`.
2. Run **Chat: Install Plugin From Source** from the Command Palette.
3. Enter `https://github.com/gingi/cyclecloud-agent-plugin` and approve installation if prompted.

Start a new agent session. VS Code installation is separate from Copilot CLI registration; see [host discovery troubleshooting](docs/troubleshooting.md#host-discovery). Repository installation can include unreleased changes. For exact releases, previews or local builds, see [source installation options](docs/development.md#install-a-local-or-unpublished-build).

### 3. Discover and use available commands

In an agent session, ask:

- “Check what my CycleCloud CLI supports and list my clusters.”
- “Read the state of node `scheduler` in cluster `demo`.”
- “Help diagnose a failed node in `demo`; explain any missing diagnostic or event capability.”
- “Prepare a cluster-init application project using available configuration for `demo`, and tell me which facts are missing.”

Replace the names with your authorized targets and review terminal approvals. The `use-cyclecloud` skill starts with local help, then inspects relevant command descriptors:

```sh
cyclecloud show_nodes --help --format json
cyclecloud project upload --help --format json
```

Help describes a command; it does not execute it or authorize uploads. When `show_cluster --help --format json` advertises `cyclecloud.clusters.v1`, list clusters and request counts for a selected cluster:

```sh
cyclecloud show_cluster --format json --limit 50
cyclecloud show_cluster "demo" --format json
```

Inventory does not fetch definition counts; named detail reports readable persisted arrays/standalone definitions, not runtime groups or VM capacity. Unknown/partial counts stay explicit. Follow the returned opaque cursor only when needed; a failed continuation is not a complete listing. See [counts and paging](docs/cli-contract.md#cluster-inventory-and-definition-counts).

When `show_nodes` advertises `cyclecloud.nodes.v1`, select definitions for authoring or concrete identities for investigation:

```sh
cyclecloud show_nodes --cluster "demo" --kind definition --format json
cyclecloud show_nodes --cluster "demo" --kind concrete --format json --failed
cyclecloud show_nodes "scheduler" --cluster "demo" --kind concrete --format json
```

Kind-selected results are bounded objects with `nodes`, scope and paging—not legacy arrays. A standalone definition can also have a concrete identity while Off/prelaunch; this does not establish a VM or readiness. `--failed` selects stored failures, not all unhealthy nodes. Exact lookup returns one target or an error. See [node discovery](docs/cli-contract.md#bounded-definition-and-concrete-node-discovery).

Without `--kind`, existing node JSON remains a legacy, unbounded array with nested `Instance` data. Custom `--output` is still usable in that legacy mode and overrides JSON with text; it is incompatible with kind mode. Authentication and configuration remain unchanged. Cluster, kind-selected node and Event Log data failures use safe text errors, while legacy node output/error behavior is unchanged; only JSON help uses the structured help-error contract.

## Diagnose a selected node

After choosing a concrete target, check help for `cyclecloud.node-diagnostics.v1`:

```sh
cyclecloud show_nodes "scheduler" --cluster "demo" --kind concrete --format json --diagnostics --detail-limit 20
```

This reads stored installation settings, active phases, current issues and cached VM checks where available. It does not supply completed-phase history, events or fresh VM health. The detail limit controls previews, not upstream condition rows. Unavailable sections remain unknown; a missing instance association does not prove no VM exists. Diagnostic text can contain sensitive operational content and must be treated as untrusted data. See [diagnostics and limits](docs/node-diagnostics.md#read-stored-diagnostics-for-one-selected-node).

When `show_events --help --format json` advertises `cyclecloud.cluster-events.v1`, read the cluster Event Log separately. Keep the same executable/configuration, and choose a modest window around the selected node's recorded phase times using explicit `--since` and `--until`, not blindly the default last three hours. Events remain cluster-wide and can include unattributed failure and informational recovery messages; time proximity does not prove node attribution or causation. Report observations, hypotheses and unknowns separately. See [failure correlation](docs/node-diagnostics.md#correlate-the-cluster-event-log-with-a-selected-failure) and [Event Log bounds](docs/cli-contract.md#cluster-event-log).

## Capability gaps and evidence

The plugin uses existing commands when they genuinely answer the question. It does not invent flags or retrieve raw configuration/full parameter exports to emulate missing functionality. For unsupported requirements, it explains the gap and offers documented upgrade/manual guidance or offline authoring. There is no API fallback or automatic installation.

Compact cluster inventory and definition counts require `cyclecloud.clusters.v1`. Bounded definition/concrete-node selection requires `cyclecloud.nodes.v1`. Selected-node stored diagnostics require `cyclecloud.node-diagnostics.v1`. Cluster Event Log reads require `show_events` with `cyclecloud.cluster-events.v1`. Node-scoped Activity, completed-attempt history, complete affected-node enumeration, capacity summaries, selective environment/storage/attachments and image metadata still require additional capabilities; the current reads do not provide that evidence. A development snapshot does not establish a released minimum version.

Keep configured definitions, runtime groups and concrete nodes distinct. Missing evidence is not zero or proof of health; configuration is not runtime readiness. See [node diagnostics](docs/node-diagnostics.md) and [application evidence](docs/application-context.md).

## Draft an application project

The `author-cyclecloud-application` skill prepares cluster-init files, an OpenFOAM/Slurm example and an `ATTACHMENT.md` handoff. The skeleton is deliberately unfinished: its scripts exit without installing or running anything until implemented. No OpenFOAM/platform/MPI combination has been validated.

Use the [authoring guide](docs/application-authoring.md) for an example request and local checks. Missing environment or attachment evidence remains explicit; safe attachment edits need complete preservation and scope information. Upload, attachment, lifecycle changes, installation and job submission require separate approval. Host permissions and CycleCloud RBAC are the authorization boundaries.

## Update or remove

Use host-native updates for repository installations. For a local build, update the reviewed persistent directory and refresh the host. Recheck CLI capabilities after changing installations, and preserve deliberately disabled state.

```sh
copilot plugin uninstall cyclecloud@cyclecloud
copilot plugin marketplace remove cyclecloud
```

Remove/disable VS Code sources separately. Plugin removal leaves CLI credentials intact; credential deletion/revocation is a separate decision.

## For contributors

See [development and verification](docs/development.md), [architecture](docs/agent-plugin-design.md), and [release history](CHANGELOG.md).
