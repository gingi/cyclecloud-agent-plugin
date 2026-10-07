# CycleCloud Agent Plugin design

## Purpose and scope

The plugin helps an agent use the existing CycleCloud CLI and prepare application projects. It is distributed as source files: skills, documentation, authoring assets and a local checker. It does not add a CLI, API bridge, MCP server, credential store or long-running service.

The workflows are:

- **CLI use:** discover the installed commands, read supported data for selected targets, interpret evidence and explain missing capabilities.
- **Application authoring:** use available configuration and explicit user choices to prepare reviewable cluster-init project files, a Slurm example and manual deployment instructions.

Inspection is read-only. Authoring writes only to the selected workspace. Uploads, attachment changes, lifecycle operations, installation and job submission are separate approved actions. The bundled application skeleton is incomplete. No combination of OpenFOAM, platform and MPI has been certified.

## Ownership

| Component                             | Responsibility                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Agent host                            | Discover skills, provide terminal and file tools, and manage permissions, approvals and installation                  |
| `use-cyclecloud` skill                | Select the executable, discover relevant help, choose commands, interpret evidence and explain gaps                   |
| CycleCloud CLI                        | Implement commands, configuration, authentication, transport, result and error contracts, and capability descriptions |
| CycleCloud service                    | Implement server behavior and enforce account authorization                                                           |
| `author-cyclecloud-application` skill | Guide local authoring from evidence and explain publication, attachment and rollout                                   |
| Local authoring checker               | Check file layout, TODO markers and Bash syntax; never install software or run workloads                              |

Skills are not security boundaries. The host can execute other commands, and the CLI includes operations that change resources. A command descriptor is not a permission grant.

## Capability-aware CLI use

Resolve the explicit `CYCLECLOUD_CLI` executable or PATH once for the task. An invalid override does not permit switching to another installation. The plugin does not import private CLI modules, validate interpreter layout, search the filesystem for installations or manage configuration separately from the CLI.

Use `--help --format json` to discover `cyclecloud.help.v1`, then request the relevant group or leaf descriptors. The child index lists commands; execution `outputs` describe what those commands return. Choose commands from their actual options, result contracts, prerequisites and effects, not a product-version threshold. Unknown metadata remains unknown. Do not load the entire help tree for every request.

Discovery is local. Running a command also depends on the server, identity and permissions. The plugin may complete a basic read without having enough evidence for a deeper investigation. Older text help remains useful, but does not establish structured contracts by inference.

### Cluster and node discovery

`cyclecloud.clusters.v1` supplies compact cluster inventory and named detail. Inventory reads selected fields without a count request for every cluster. Named detail counts stored arrays and standalone definitions the account can read. Counts distinguish `notRequested`, `available`, `partial` and `unavailable` from zero.

Paging keeps the cursor unchanged and retains the endpoint and template filter. If Unicode ordering makes a page boundary unsafe, continuation fails rather than skipping identities. Data responses, final output and data-request timeouts are bounded; authentication duration and backend scan work are not. Cluster data failures use safe text on stderr, not the JSON-help error contract.

`cyclecloud.nodes.v1` uses `node list --kind definition|concrete --cluster NAME --format json` or `node show NAME` with the same required cluster, kind and format options. It returns size-limited identity and state data without diagnostics or related configuration. Exact lookup returns one target or an error. Paging is keyed by Name and uses the same Unicode boundary checks and data limits as cluster JSON.

A standalone definition can also have a concrete identity while Off or before launch. Stored-failure filtering is not a general health check. Authoring selects definition identities before requesting separately supported environment and attachment evidence. Kind mode rejects raw projection, filter and custom-output combinations without changing legacy execution.

### Diagnostics and events

`cyclecloud.node-diagnostics.v1` adds stored evidence through `--diagnostics` on an exact concrete `node show` lookup. The CLI checks the node identity and instance association before reading installation settings, active phases, current issues or cached VM checks. Unavailable optional sections remain unknown, not evidence of health.

Preview limits and clipping do not limit upstream rows or comprehensively redact secrets. The skill tells the agent to check the source, availability and completeness of evidence rather than infer a cause from status alone. Diagnostics do not supply completed history, events or fresh cloud or guest probes.

`cyclecloud.cluster-events.v1` supplies the separate `event list` cluster Event Log read. The skill combines diagnostics for one selected node with a modest explicit window around recorded phase timestamps. It keeps cluster-wide messages, messages with no node attribution, and informational recovery.

The separately advertised `event show` contract, `cyclecloud.cluster-event.v1`, returns one event with the same bounded fields in a singular `event` envelope and canonical cluster scope. Use only a copied ID and explicit cluster when requested or useful to a repair decision. It has no time/priority/paging selection and does not trigger automatic reads after a list. Missing or failed lookup is not empty history; neither event command substitutes for a denied or failed read of the other.

Event occurrence time differs from record-update and Activity time. Nearby events do not establish causation, node attribution or a current attempt. The command bounds output; it does not fetch Activity or complete history, or guarantee bounded backend scans. Keep observations, hypotheses and unknowns separate. Missing evidence calls for separately authorized checks that distinguish possible explanations, not a private API bridge.

### Grouped issues and node references

`cyclecloud.cluster-issues.v1` supplies `issue list` for one cluster's grouped stored Error/Warning conditions. The CLI and maintained server datasource handle grouping, authorization, exact occurrence counts and bounded output. The plugin reports their scope without inferring distinct affected nodes, root cause or complete health. Exact counts still require aggregation across the cluster's matching records.

Grouped JSON requires backend `PageVersion=2`. It returns non-null short logical IDs in `groupSelector` and pages in stable severity, type and message order. Summary cursors are opaque and depend on a representative record. Text still ranks its preview by severity and count, without an extra ID column.

Short IDs depend on the canonical cluster and the full type, severity and message under the source's comparison rules. They do not depend on clipped display text, count, members or representative. They survive deletion of a representative while the group remains. An identical group reappearing reuses its ID; the ID is not a historical incident identity.

IDs are interpreted within the selected cluster and connection. They are not tokens that bind an endpoint or grant authorization. The server checks authorization and resolves the fixed set of candidates in that scope on every read. There is no registry, cache or stored mapping. Missing or ambiguous groups fail. Bounded results do not mean constant-time lookup or a bounded scan.

`cyclecloud.issue-nodes.v1` supplies `issue show --group`. It returns node references the source treats as distinct, resolved under the account's ordinary node-read permissions. Short-ID selection requires backend v2 in both formats. Text gives one concise preview. JSON provides NodeId-keyed cursors bound to the endpoint, canonical cluster, short ID and full logical fingerprint—the complete group identity, not just its short hash. A fingerprint mismatch fails before identity lookup or output.

Legacy long selectors and their node cursors keep strict representative checks and older backend compatibility. New reads do not automatically downgrade. The skill tells the agent to follow pages only as needed. Unresolved references consume slots and advance the cursor; they are not refilled, and diagnostics are not requested for every node. Before attributing name-based diagnostics to a selected reference, compare its NodeId with the returned NodeId. Neither issue contract supplies complete health or history, and unsupported servers do not trigger a private bridge.

### Legacy node reads

On legacy `show_nodes` without kind mode, `cyclecloud.show_nodes.legacy-json.v1` describes successful JSON output as a legacy array with optional nested `Instance` data. It has no result-size bound, is not validated or restricted to concrete nodes, and does not guarantee that secrets are excluded. Narrow selected reads with explicit fields can answer limited questions. They do not replace curated diagnostics or configuration views.

A nonempty `--output` template takes precedence over `--format json` and produces custom text. The plugin can choose text deliberately, but must not treat it as JSON or assume bounded retrieval. Execution keeps legacy authentication, persistence, interaction and raw or text errors. `cyclecloud.error.v1` applies only to explicit JSON help failures, not execution errors.

See [CLI contracts](cli-contract.md) for discovery and read behavior and [configuration](configuration.md) for setup.

## Gaps and failures

When a capability is missing, explain the specific gap and offer documented upgrade, manual or offline options. Do not implement the missing capability in the plugin, invent commands, or reconstruct it from raw configuration dumps or broad parameter exports. Documentation explains procedures; it is not live evidence.

Permission denial, authentication failure, timeout, invalid data and cancellation are operation failures, not reasons to try another backend or identity. The CLI owns configuration and authentication. Data bounds and transport behavior depend on each command contract; the plugin adds no HTTP or output budgets. Host-truncated output is incomplete evidence.

As CLI capabilities evolve, adapt the relevant skills to reviewed result contracts. Improve the CLI rather than copy its implementation into the plugin.

## Evidence and authoring

Keep these distinctions clear regardless of output schema:

- Configured definitions are not runtime groups or concrete nodes.
- Missing evidence is not a known empty result.
- Configured settings do not prove runtime readiness.
- Source timestamps are not collection time.
- Knowing some shared uses does not prove that all shared uses are known.

Use available facts for the selected targets before asking the user to repeat them. If selective reads are missing, state the unknowns or ask for authoritative manual evidence. Attachment instructions need all current specs and enough information about ownership, inheritance and shared uses to preserve unrelated configuration. Do not turn a partial read into a replacement cluster template.

The local project directory and remote installation prefix are different. `/shared/apps` describes a destination on cluster nodes, not a local filesystem destination or plugin-specific CLI flag. Plan runtime verification separately.

See [application evidence](application-context.md), [node diagnosis](node-diagnostics.md) and [authoring](application-authoring.md).

## Source distribution and verification

`plugin.json` and `.github/plugin/marketplace.json` identify the plugin. The host loads skills from their directories. Each skill resolves references and assets relative to its installed location. Installation and CLI use need no runtime build or npm dependencies. The authoring checker and contributor checks need Node and Bash.

Packaging uses an explicit allowlist of manifests, skills, assets and public documentation. It rejects symlinks and other non-regular paths, and excludes credentials, developer tests and private plans. Verification checks exact contents, identity, executable modes and source provenance. It then runs the authoring checker from an unrelated directory against the intentionally incomplete skeleton. These checks verify the artifact, not agent behavior, host installation or compatibility with a live server.

Release tooling keeps version, tag and source-identity checks, anonymous download verification and explicit stable promotion. Checksums detect corruption or inconsistency; they are not publisher signatures. See [development and releases](development.md).

## Application authoring evolution

To qualify a runnable example, choose and document one combination of OpenFOAM, OS and MPI. Implement a pinned installation, a readiness protocol with one writer, and recovery. Complete a real Slurm case with bounded resource use. Then perform separately approved live installation and workload validation. Local syntax checks cannot certify the combination.

Automated publication, spec attachment, rollout and job submission are separate workflows, not implicit extensions of authoring. Keep their operation semantics in the CLI and their authorization explicit.
