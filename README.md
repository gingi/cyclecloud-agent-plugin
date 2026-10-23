# Azure CycleCloud Agent Plugin

Use the existing CycleCloud CLI to investigate clusters and draft application projects from Copilot CLI or Copilot in VS Code. The plugin discovers the installed CLI's capabilities and composes supported commands. It does not implement a second API client or deploy the projects it authors.

This is a proof of concept with an incomplete application skeleton. See [scope and limitations](docs/development.md#scope-and-limitations) before relying on it in your environment.

## Prerequisites

- A CycleCloud CLI executable available in the environment running agent commands, on PATH or selected by an absolute `CYCLECLOUD_CLI` path. Support depends on the capabilities available for each task, not one minimum version.
- Copilot CLI 1.0.81+ or VS Code with Agent Plugins enabled. Sign in to the agent host separately.
- For connected reads: a reachable CycleCloud instance and a least-privilege CLI account with the required access.
- **Only for the authoring checker:** Node.js and Bash. Plugin installation and CLI discovery do not need npm dependencies or plugin-owned Python code.

The shell examples use POSIX syntax. Validate the CLI, shell and host combination in your deployment. WSL and remote agents do not automatically share the desktop's PATH. Review the plugin before installation: host tools run with your OS user's permissions.

## Quick start

### 1. Configure the CycleCloud CLI

```sh
cyclecloud --version
cyclecloud --help --format json
```

A CLI with structured discovery returns `cyclecloud.help.v1`. Older CLIs may return text or reject the help-format request. The plugin can use text help to explain exactly which capability is missing. Neither a version string nor successful discovery confirms that you are signed in or that the server is compatible.

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
cyclecloud node --help --format json
cyclecloud node list --help --format json
cyclecloud node show --help --format json
cyclecloud project upload --help --format json
```

Help describes a command; it does not execute it or authorize uploads. When the relevant `cluster list` and `cluster show` help advertises `cyclecloud.clusters.v1`, list clusters and request counts for a selected cluster:

```sh
cyclecloud cluster list --format json --limit 50
cyclecloud cluster show "demo" --format json
```

The cluster listing does not fetch definition counts. Details for a named cluster count stored arrays and standalone definitions that your account can read, not runtime groups or VM capacity. Unknown or partial counts are reported as such. Use the returned cursor unchanged to fetch another page only when needed; a failed next-page request does not complete the listing. See [counts and paging](docs/cli-contract.md#cluster-inventory-and-definition-counts).

When `node list` and `node show` advertise `cyclecloud.nodes.v1`, select definitions for authoring or concrete identities for investigation:

```sh
cyclecloud node list --cluster "demo" --kind definition --format json
cyclecloud node list --cluster "demo" --kind concrete --format json --failed
cyclecloud node show "scheduler" --cluster "demo" --kind concrete --format json
```

Results selected with `--kind` are size-limited objects containing `nodes`, scope and paging information, not legacy arrays. A standalone definition can also have a concrete identity while Off or before launch; that does not prove a VM exists or is ready. `--failed` selects stored failures, not all unhealthy nodes. Exact lookup returns one target or an error. See [node discovery](docs/cli-contract.md#bounded-definition-and-concrete-node-discovery).

The legacy `show_nodes` command without `--kind` still returns a legacy, unbounded array with nested `Instance` data. Custom `--output` still works in that mode and overrides JSON with text; it is incompatible with kind mode. Authentication and configuration are unchanged.

Data failures for cluster, kind-selected node, grouped current-issue and Event Log reads use safe text errors. Legacy node output and errors keep their existing behavior. Only JSON help uses the structured help-error contract.

## Triage a cluster's current issues

When `issue list --help --format json` advertises `cyclecloud.cluster-issues.v1`, summarize the stored Error/Warning groups for one cluster:

```sh
cyclecloud issue list "demo" --limit 20 --format json
```

Counts describe matching issue records, not the number of distinct affected nodes. The size-limited group result provides neither node identities nor a complete health assessment. An empty result means no matching stored issues were found. To produce exact counts, the server must aggregate all matching records. JSON requires the current-issues source's `PageVersion=2` protocol; an unsupported/denied read is not an empty result and does not downgrade. See [grouped issues and limits](docs/cli-contract.md#grouped-current-issues).

When `issue show --help --format json` advertises `cyclecloud.issue-nodes.v1`, copy one group's `groupSelector` unchanged into `--group`. It is a short logical group ID such as the illustrative `storageaccount:7c4e9a12d63b08f5`; use the actual returned value and retain the same CLI/configuration and cluster. IDs stay the same when members or counts change, or when the representative record is deleted, as long as the group remains. They do not identify historical incidents or bind the selection to a server endpoint. Short selection requires the v2 backend in text and JSON; legacy long selectors retain strict representative checks.

`issue show "demo" --group "<groupSelector>" --limit 20 --format json` returns a size-limited preview of current names and NodeIds that could be resolved, along with unresolved references. It does not give the total number of affected nodes. Select one resolved target for diagnostics and compare its NodeId with the diagnostic result before attribution. See [selector scope, compatibility and identity handoff](docs/cli-contract.md#issue-group-node-references).

## Diagnose a selected node

After choosing a concrete target, check help for `cyclecloud.node-diagnostics.v1`:

```sh
cyclecloud node show "scheduler" --cluster "demo" --kind concrete --format json --diagnostics --detail-limit 20
```

This reads stored installation settings, active phases, current issues and cached VM checks where available. It does not supply completed-phase history, events or fresh VM health. The detail limit controls previews, not upstream condition rows. Unavailable sections remain unknown. A missing link to an instance does not prove no VM exists. Diagnostic text can contain sensitive operational content and must be treated as untrusted data. See [diagnostics and limits](docs/node-diagnostics.md#read-stored-diagnostics-for-one-selected-node).

When `event list --help --format json` advertises `cyclecloud.cluster-events.v1`, read the cluster Event Log separately. Keep the same executable/configuration, and choose a modest window around the selected node's recorded phase times using explicit `--since` and `--until`, not blindly the default last three hours. Events remain cluster-wide and can include unattributed failure and informational recovery messages; time proximity does not prove node attribution or causation. Report observations, hypotheses and unknowns separately. See [failure correlation](docs/node-diagnostics.md#correlate-the-cluster-event-log-with-a-selected-failure) and [Event Log bounds](docs/cli-contract.md#cluster-event-log).

## Capability gaps and evidence

The plugin uses existing commands when they genuinely answer the question. It does not invent flags or retrieve raw configuration/full parameter exports to emulate missing functionality. For unsupported requirements, it explains the gap and offers documented upgrade/manual guidance or offline authoring. There is no API fallback or automatic installation.

Each read needs its own advertised capability:

- Cluster inventory and definition counts: `cyclecloud.clusters.v1`.
- Bounded definition and concrete-node selection: `cyclecloud.nodes.v1`.
- Stored diagnostics for one selected node: `cyclecloud.node-diagnostics.v1`.
- Cluster Event Log: `event list` with `cyclecloud.cluster-events.v1`.
- One known event: separately advertised `event show` with `cyclecloud.cluster-event.v1`; see [exact lookup](docs/cli-contract.md#exact-event-lookup). Use a copied, quoted ID and `--cluster` only when requested or useful to a decision, not as an automatic extra read or fallback after denial. The same bounded fields and attribution limits apply.
- Grouped stored Error/Warning counts: `issue list` with `cyclecloud.cluster-issues.v1` and its server datasource.
- Bounded node previews for one issue group: `cyclecloud.issue-nodes.v1` and the drilldown source.

When selected-node diagnostics advertise `--image-context`, they can provide partial current saved image name, legacy label and version fields, not effective image selection or image registration/resolution. The current reads do not provide node-scoped Activity, completed-attempt history, a complete affected-node listing, capacity summaries, selective environment, storage or attachments, or image registration/resolution. Those need additional capabilities. A development snapshot does not establish a released minimum version.

Keep configured definitions, runtime groups and concrete nodes separate. Missing evidence is not zero or proof of health; configuration is not runtime readiness. See [node diagnostics](docs/node-diagnostics.md) and [application evidence](docs/application-context.md).

## Draft an application project

The `author-cyclecloud-application` skill prepares cluster-init files, an OpenFOAM/Slurm example and an `ATTACHMENT.md` handoff. The skeleton is deliberately unfinished: its scripts exit without installing or running anything until implemented. No OpenFOAM/platform/MPI combination has been validated.

Use the [authoring guide](docs/application-authoring.md) for an example request and local checks. Missing environment or attachment evidence remains explicit; safe attachment edits need a complete record of what must be preserved and which targets the edit affects. Upload, attachment, lifecycle changes, installation and job submission require separate approval. Host permissions and CycleCloud RBAC are the authorization boundaries.

## Update or remove

Use host-native updates for repository installations. For a local build, update the reviewed persistent directory and refresh the host. Recheck CLI capabilities after changing installations, and preserve deliberately disabled state.

```sh
copilot plugin uninstall cyclecloud@cyclecloud
copilot plugin marketplace remove cyclecloud
```

Remove/disable VS Code sources separately. Plugin removal leaves CLI credentials intact; credential deletion/revocation is a separate decision.

## For contributors

See [development and verification](docs/development.md), [architecture](docs/agent-plugin-design.md), and [release history](CHANGELOG.md).
