# Application authoring checklist

## Facts and choices to record

| Area           | Needed before a deployable recipe                                                        |
| -------------- | ---------------------------------------------------------------------------------------- |
| Application    | OpenFOAM distribution, exact release, trusted source, checksum                           |
| Platform       | OS release, architecture, compiler, compatible MPI and libraries                         |
| Shared storage | Mount availability, write permissions, designated installer node/job                     |
| Runtime        | Versioned prefix under `/shared/apps`, environment/module setup, node-local dependencies |
| Scheduler      | Partition, account if required, task layout, supported MPI launcher                      |
| Test           | Small case, expected result, bounded resources and wall time                             |

CLI inspection does not establish all these facts. Document the source of each fact; distinguish confirmed values from assumptions.

## Discover facts before asking questions

For a named cluster, read the selected installation/compute targets' environment details and the scheduler's environment details before asking for OS or Slurm versions. Do not assume all roles share an image. Reuse fresh results and summarize a small table of fact, target, source and unresolved checks.

| Fact                           | Source to use first                                                                                      | When a question is justified                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS family/release              | `platform.os`, `platform.distribution`, `platform.release`, with `platform.source` and `jetpackPlatform` | Missing or conflicting metadata, custom images with no declared release, or incompatible target platforms requiring a decision. Do not guess from the image alias or free-form label. |
| Slurm software version         | `scheduler.version` on the scheduler and relevant consumers where available                              | Missing configuration or a meaningful version conflict; do not ask again when context supplied it.                                                                                    |
| MPI/compiler/runtime libraries | Any explicitly supplied evidence; these are not established by an image alias                            | Missing information needed to select a compatible build/launcher.                                                                                                                     |
| OpenFOAM distribution/release  | User requirement or an explicitly documented supported recipe                                            | Usually a real choice. State that the bundled recipe is unfinished; do not claim a tested default.                                                                                    |

A cluster-init project version is not the Slurm software version. An OpenFOAM project's version is not necessarily its application release. `matchingRecords` counts consistent image-package metadata records, not installed images or selected package revisions.

Configured platform and Slurm values are sufficient to begin authoring under an explicit baseline. `runtimeVerified: false` means that live validation remains to do; it is not a reason to make the user reconfirm an otherwise clear configured value. Put live OS, mount, MPI and workload checks in the verification plan. When a query or metadata lookup fails, identify the exact missing fact rather than restarting a broad version questionnaire.

Example response after discovery (substitute actual evidence): “The selected targets are configured for Ubuntu 22.04, and the scheduler is configured for Slurm X. I'll target those settings and leave runtime verification in the test plan. Which OpenFOAM distribution and release do you require?”

## Project responsibilities

- `install` spec: verify prerequisites, use one writer, stage a pinned installation in a versioned location, verify it, then publish readiness. Preserve the previous installation. Cluster-init run markers are per-node, not a shared lock.
- `runtime` spec: verify access to the completed shared installation and prepare compatible node-local dependencies/environment. Do not install into the shared prefix from every node.
- Slurm example: set explicit resource limits, load the environment, prepare/decompose a small case, launch using the selected MPI integration, and document how to recognize success.
- README: record supported combinations, evidence, unresolved choices, attachment targets, rollout implications for existing nodes, verification steps, and recovery guidance.

## Context and attachment handoff

Use the installed plugin's `scripts/cyclecloud-inspect` launcher. Start `application-context NAME --schema-version 1 --view overview`; select targets before requesting details. For one `--target-name` at a time, use `--view details` and `--section environment` for platform/Slurm settings, `--section storage` for mounts/volumes, or `--section attachments` for specs/parameters/shared uses. Read `result.context` in the schema-1 envelope. Overview intentionally omits these detail collections and does not read parameter values. Do not read every target or section simply because more data exists. Values describe configuration, not runtime verification.

Collections include `offset`, `nextOffset`, `total`, `returned`, and `truncated`. Pages also have byte limits, so `returned` may be less than the requested limit. Follow the particular collection's `nextOffset` as `offset`, keeping its target/section and limits; sibling collections share the offset and can overlap. Stop when the needed evidence is complete, not when the whole cluster has been exhausted. Re-read before changes because pages are not a snapshot.

Fill `ATTACHMENT.md` with actual target-to-parameter mappings, current spec identities to preserve, and project/version/locker selections. Parameter `usedBy.items` lists include unselected definitions in the queried cluster, but not all child clusters of a root parameter scope. If a list is truncated or a mapping is unavailable, require inspection before recommending an edit. Shared or inherited scheduler parameters are not proof of a single installer node.

Give the operator concrete upload and attachment steps without executing them. Parameter labels can guide the edit form; a template-managed cluster needs a diff against its authoritative source, not reconstruction from partial inspection data. Re-read after attachment. Any start/terminate handoff requires separate approval, workload safety, storage checks, and observation of completion. Never equate accepted lifecycle requests with completed configuration or successful installation.

## What remains to implement

The starter scripts intentionally exit nonzero. Implement one documented OpenFOAM/platform/MPI combination first. Add application-specific tests before describing it as a working recipe. The local checker is not a general INI validator, permissions checker, security scanner, or compatibility test.

Publishing to a locker, attaching specs, configuring existing nodes, and submitting a test job are separate consequential actions. Uploading does not mean installed; accepting a job does not mean the workload succeeded. Do not embed credentials in generated artifacts.

## References

- [CycleCloud projects](https://learn.microsoft.com/en-us/azure/cyclecloud/how-to/projects?view=cyclecloud-8): project layout, lockers, spec references, script ordering and run markers.
- [Cluster-init reference](https://learn.microsoft.com/en-us/azure/cyclecloud/cluster-references/cluster-init-reference?view=cyclecloud-8)

Consult documentation for the selected OpenFOAM distribution and target Slurm/MPI stack when completing the recipe; no universal launcher or application version is assumed here.
