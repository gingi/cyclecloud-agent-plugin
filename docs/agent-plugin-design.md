# CycleCloud Agent Plugin design

## Purpose and scope

The plugin helps an agent use the existing CycleCloud CLI and prepare application projects. It is a source-distributed collection of skills, documentation, authoring assets and a local checker. It does not add a CLI, API bridge, MCP server, credential store or long-running service.

The workflows are:

- **CLI use:** discover the installed command surface, perform supported scoped reads, interpret evidence and explain missing capabilities.
- **Application authoring:** use available configured evidence and explicit user choices to prepare reviewable cluster-init project files, a Slurm example and a manual deployment handoff.

Inspection is read-only. Authoring writes only to the selected workspace. Uploads, attachment changes, lifecycle operations, installation and job submission are separate approved actions. The bundled application skeleton is incomplete and no OpenFOAM/platform/MPI combination is certified.

## Ownership

| Component                             | Responsibility                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Agent host                            | Skill discovery, terminal/file tools, permissions, approvals and installation                                       |
| `use-cyclecloud` skill                | Executable selection, progressive help discovery, task/command selection, evidence interpretation and gap guidance  |
| CycleCloud CLI                        | Command implementation, configuration, authentication, transport, result/error contracts and capability description |
| CycleCloud service                    | Server behavior and account authorization                                                                           |
| `author-cyclecloud-application` skill | Evidence-driven local authoring and publication/attachment/rollout instructions                                     |
| Local authoring checker               | Fixed-layout, TODO and Bash syntax checks; never installation or workload execution                                 |

Skills are not security boundaries. The host can execute other commands, and the CLI includes consequential operations. A command descriptor is not a permission grant.

## Capability-aware CLI use

Resolve the explicit `CYCLECLOUD_CLI` executable or PATH once for the task. Invalid explicit overrides do not fall through. No private CLI imports, interpreter-layout validation, filesystem installation search or alternate configuration authority are needed.

Use `--help --format json` to discover `cyclecloud.help.v1`, then request relevant group/leaf descriptors. Child indexes and execution `outputs` are distinct. Select commands based on their actual options, result contracts, prerequisites and effects, not a product-version threshold. Unknown metadata remains unknown. Do not load the entire help tree for every request.

Discovery is local; operation availability also depends on the server, identity and permissions. A plugin may complete a basic read while lacking the evidence for a deeper investigation. Older text help remains useful for guidance, but does not acquire structured contracts by inference.

`cyclecloud.clusters.v1` supplies compact cluster inventory and named detail. Inventory uses projected reads without per-cluster count enrichment; named detail counts readable persisted array/standalone definitions. Counts expose not-requested, available, partial and unavailable states rather than conflating missing data with zero. Opaque cursor paging preserves the endpoint/template filter; unsafe Unicode continuation boundaries fail rather than skip identities. Data responses/final output and data-request timeouts are bounded, not authentication duration or backend scan work. Cluster data failures use safe text stderr, not the JSON-help error contract.

`cyclecloud.nodes.v1` is selected by explicit `show_nodes --kind definition|concrete --cluster NAME --format json`. It supplies bounded identity/state discovery without diagnostics or configuration joins, exact one-or-error lookups, Name-keyed opaque paging and the same Unicode continuation guard/data bounds as cluster JSON. Standalone definitions and concrete identities can overlap while Off/prelaunch; stored-failure filtering is not general health detection. Authoring uses definition identities before requesting separately supported environment/attachment evidence. Kind mode rejects raw projection/filter/custom-output combinations rather than changing legacy execution.

`cyclecloud.node-diagnostics.v1` adds selected-node stored evidence via `--diagnostics` on exact concrete lookup. Identity/association validation precedes installation/active-phase/current-issue/cached-VM reads; optional unavailable sections do not become empty health findings. Preview limits and clipping do not imply upstream row limits or comprehensive secret redaction. The plugin interprets source/availability/completeness instead of inferring a root cause from status. This is not completed history, events or fresh cloud/guest probing.

The no-kind node contract, `cyclecloud.show_nodes.legacy-json.v1`, describes successful effective JSON output as a legacy array with optional nested `Instance` data. It is not bounded, secret-minimal, validated or concrete-only. Narrow selected reads and explicit fields can answer limited questions; they do not replace curated diagnostics or configuration views. A nonempty `--output` template takes precedence over `--format json` and produces custom text; the plugin can choose this deliberately without treating it as JSON or assuming retrieval bounds. Execution retains legacy authentication, persistence, interaction and raw/text error behavior. `cyclecloud.error.v1` applies only to explicit JSON help failures, not execution errors.

See [CLI contracts](cli-contract.md) for supported discovery/read behavior and [configuration](configuration.md) for setup.

## Gaps and failures

Missing capability produces a precise explanation and documented upgrade/manual/offline options, not a plugin-owned implementation. Do not invent commands or reconstruct a missing feature from raw configuration dumps or broad parameter exports. Documentation provides procedural knowledge, not live evidence.

Permission denial, authentication failure, timeout, invalid data and cancellation are operation failures, not excuses to try another backend or identity. CLI configuration/authentication remains authoritative; data-read bounds and transport behavior are specific to each command contract. The plugin adds no HTTP or output budgets. Host-truncated output is incomplete evidence.

As ordinary CLI capabilities evolve, adapt the relevant skills to reviewed result contracts. Improvements belong in the CLI rather than a mirrored product implementation in the plugin.

## Evidence and authoring

Preserve domain distinctions independently of any one output schema: configured definitions versus runtime groups/concrete nodes; missing versus empty evidence; configured settings versus runtime readiness; source timestamps versus collection time; and known shared scope versus proven completeness.

Authoring uses target-specific available facts before asking redundant questions. Missing selective reads require explicit unknowns or authoritative manual evidence. Attachment instructions need complete current specs and enough ownership/inheritance/shared-use information to preserve unrelated configuration. Partial reads must not become a replacement cluster template.

The local project directory and remote installation prefix are distinct. `/shared/apps` is data describing cluster nodes, not a local filesystem destination or a plugin-specific CLI flag. Runtime verification remains a separate plan.

See [application evidence](application-context.md), [node diagnosis](node-diagnostics.md) and [authoring](application-authoring.md).

## Source distribution and verification

`plugin.json` and `.github/plugin/marketplace.json` identify the plugin. The host loads skills from their directories; skills resolve their own references/assets relative to the installed location. No runtime build or npm dependencies are needed for installation or CLI use. Node/Bash are required for the authoring checker and contributor validation.

Packaging uses an explicit allowlist of manifests, skills, assets and public documentation. It rejects symlinked/non-regular paths and excludes credentials, developer tests and private plans. Verification checks exact contents, identity, executable modes and provenance, then exercises the authoring checker from an unrelated directory against the intentionally incomplete skeleton. This is artifact verification, not agent-behavior, host-installation or live-server qualification.

Release tooling preserves version/tag/source-identity checks, anonymous download verification and explicit stable promotion. Checksums detect corruption/inconsistency but are not publisher signatures. See [development and releases](development.md).

## Application authoring evolution

To qualify a runnable example, choose and document one OpenFOAM/OS/MPI combination; implement pinned installation, a single-writer readiness protocol and recovery; complete a real bounded Slurm case; and perform separately approved live installation/workload validation. Local syntax checks cannot certify that combination.

Automated publication, spec attachment, rollout and job submission are separate workflows, not implicit extensions of authoring. Keep their operation semantics in the CLI and their authorization explicit.
