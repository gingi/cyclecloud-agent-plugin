# Gather application-authoring evidence

Gather application-authoring evidence through supported ordinary CLI reads. Use [CLI discovery](cli-contract.md) to determine which facts the installed CLI can supply, then gather only the targets and sections needed for the [authoring task](application-authoring.md).

```sh
cyclecloud --help --format json
cyclecloud show_nodes --help --format json
```

These commands discover local syntax/contracts, not cluster configuration. Where `cyclecloud.clusters.v1` is advertised, named `show_cluster` JSON supplies cluster identity and readable persisted definition counts; it does not enumerate installer/consumer definitions or supply their environment and attachment details. When `cyclecloud.nodes.v1` is available, `show_nodes --cluster NAME --kind definition --format json` enumerates readable array/standalone identities for target selection. It does not expose role, image, environment, storage or attachment fields. Neither this identity-only view nor legacy node JSON establishes complete configuration or shared parameter scope. Do not assume additional views or image subcommands exist merely because a newer design proposes them.

## Evidence checklist

| Area        | Facts to establish                                                                                                            | Interpretation limits                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Targets     | Exact cluster/name, standalone or array definition, role and relevant inheritance                                             | Definitions differ from concrete nodes and runtime groups; a mixed raw list is not an authoritative target inventory |
| Environment | Target-specific image/platform, declared OS release, architecture, scheduler role/version/partition and locker where relevant | Image aliases are not OS releases; package/project versions are not necessarily software versions                    |
| Storage     | Selected mount/volume paths, enablement, type and persistence needed for the intended prefix                                  | Configuration does not establish a mounted, writable filesystem or survival through rollout                          |
| Attachments | Ordered existing specs, source lockers, actual parameter references/labels, owner and known shared uses                       | Partial/ambiguous references or incomplete descendant coverage cannot establish a safe single-target edit            |

Record source and observation time for each fact. Keep unavailable, missing, empty and partial evidence distinct. A field absent from a requested projection remains unknown. When a supported command supplies paging, follow its documented continuation only for needed entries; do not invent cursors or imply that a page is complete.

## Discover versions before asking

For a named cluster, look for supported environment reads for the scheduler and selected installer/consumer targets. Reuse reliable user-supplied configuration when a CLI read is unavailable. Summarize known configured OS and Slurm versions with source/target before asking questions; ask only about missing facts, material conflicts and application choices.

Configured facts are a valid authoring baseline. Runtime verification belongs in the later verification plan, not a redundant request to reconfirm known values. Exact image metadata may be missing or ambiguous; never infer a release from an alias or arbitrary label.

## Installation prefix versus local workspace

`/shared/apps` is the default intended prefix on cluster nodes. It is not a local project directory or a flag the plugin automatically passes to the CLI. Keep the selected prefix consistent in generated scripts, storage reasoning and attachment instructions. Do not access/create that remote path on the agent host or broaden filesystem permissions to accommodate it.

A configured mountpoint can suggest where the prefix would reside, but a lexical comparison cannot prove live availability, symlink resolution or write access. Ask for explicit evidence when those facts affect deployment.

## When the installed CLI cannot supply the evidence

Explain the specific missing capability rather than declaring the whole plugin incompatible. Offer a documented upgrade path, relevant manual UI/template evidence, or explicitly offline authoring. Do not fetch full node configuration or parameter exports, import private CLI libraries, or use a raw API/query fallback.

Keep unsupported facts visible as TODOs in the draft. Documentation can guide a procedure but cannot establish the selected cluster's state. Attachment edits require complete current entries and enough ownership/shared-use evidence to preserve unrelated configuration; otherwise leave the handoff incomplete. For template-managed clusters, work from the authoritative source instead of reconstructing it from partial reads.

Publication, attachment, rollout, installation and workload checks remain separate approved actions. Available configuration does not establish any of those stages as complete.
