# Gather application-authoring evidence

Use supported ordinary CLI reads to gather authoring facts. Start with [CLI discovery](cli-contract.md) to learn which facts the installed CLI can supply, then read only the targets and sections needed for the [authoring task](application-authoring.md).

```sh
cyclecloud --help --format json
cyclecloud node list --help --format json
```

These commands describe local syntax and result contracts, not cluster configuration. When `cyclecloud.clusters.v1` is advertised, named `cluster show` JSON returns cluster identity and counts of saved definitions the account can read. It does not list installer or consumer definitions, or provide their environment and attachment details.

When `cyclecloud.nodes.v1` is available, `node list --cluster NAME --kind definition --format json` lists readable arrays and standalone definitions so you can select targets. It returns identity, not role, image, environment, storage or attachment fields. Neither this identity-only view nor legacy node JSON establishes complete configuration or which targets share a parameter. Use additional views or image subcommands only when the selected CLI advertises the capabilities they require.

## Evidence checklist

| Area        | Facts to establish                                                                                                                     | Interpretation limits                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Targets     | Exact cluster and target name; standalone or array definition; role and relevant inherited settings                                    | Definitions differ from concrete nodes and runtime groups. A mixed raw list is not an authoritative target inventory.                |
| Environment | Image and platform for each target; declared OS release and architecture; scheduler role, version and partition; any relevant locker   | Image aliases are not OS releases. Package and project versions are not necessarily software versions.                               |
| Storage     | Selected mount and volume paths, whether storage is enabled, its type and persistence, and what the intended installation prefix needs | Configuration does not prove that a filesystem is mounted, writable or will survive rollout.                                         |
| Attachments | Ordered existing specs, source lockers, actual parameter references and labels, owner and known shared uses                            | Partial or ambiguous references, or missing information about descendants, cannot prove that an edit safely affects only one target. |

Record the source and observation time for each fact. Keep unavailable, missing, empty and partial evidence distinct. A field absent from a requested projection remains unknown. If a supported command supplies paging, follow its documented continuation only for needed entries. Do not invent cursors or imply that a page is complete.

## Discover versions before asking

For a named cluster, look for supported environment reads for the scheduler and selected installer and consumer targets. Reuse reliable user-supplied configuration when a CLI read is unavailable. Before asking questions, summarize known configured OS and Slurm versions with each value's source and target. Ask only about missing facts, conflicts that affect the implementation, and application choices.

Configured facts are a valid starting point for authoring. Plan runtime verification later rather than ask the user to reconfirm known values. Exact image metadata may be missing or ambiguous. Never infer a release from an alias or arbitrary label.

## Installation prefix versus local workspace

`/shared/apps` is the default intended prefix on cluster nodes. It is not a local project directory or a flag the plugin automatically passes to the CLI. Use the selected prefix consistently in generated scripts, storage decisions and attachment instructions. Do not access or create that remote path on the agent host, or broaden filesystem permissions to accommodate it.

A configured mountpoint can suggest where the prefix would be. Comparing path text cannot prove that storage is available, resolve symlinks or establish write access. Ask for explicit evidence when those facts affect deployment.

## When the installed CLI cannot supply the evidence

Explain the specific missing capability rather than declaring the whole plugin incompatible. Offer a documented upgrade path, relevant manual UI or template evidence, or explicitly offline authoring. Do not fetch full node configuration or parameter exports, import private CLI libraries, or fall back to raw APIs or queries.

Leave unsupported facts visible as TODOs in the draft. Documentation can explain a procedure, but it cannot establish the selected cluster's state. Attachment edits need all current entries and enough information about ownership and shared uses to preserve unrelated configuration. Otherwise, leave the handoff incomplete. For template-managed clusters, use the authoritative source instead of reconstructing it from partial reads.

Publication, attachment, rollout, installation and workload checks remain separate approved actions. Available configuration does not mean any of those stages are complete.
