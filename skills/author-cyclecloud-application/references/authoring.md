# Application authoring checklist

## Facts and choices to record

| Area           | Needed before a deployable recipe                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Application    | OpenFOAM distribution, exact release, trusted source and checksum                                      |
| Platform       | OS release, architecture, compiler, compatible MPI and libraries                                       |
| Shared storage | Configured mounts plus a separate plan to verify availability, write permissions and storage survival  |
| Runtime        | Versioned prefix under `/shared/apps`, environment/module setup and node-local dependencies            |
| Scheduler      | Target roles, software version, partition, account if required, task layout and supported MPI launcher |
| Test           | Small case, expected result, bounded resources and wall time                                           |

Document the source of each fact and distinguish configuration, user-confirmed facts, assumptions and runtime observations. CLI capability discovery alone establishes none of the cluster facts.

## Discover facts before asking questions

Use the [CLI workflow](../../use-cyclecloud/SKILL.md) to discover suitable commands. Start with selected targets and gather only supported evidence. The legacy node JSON format is not a complete configuration or attachment contract. Do not compensate for missing views with full parameter exports, raw configuration dumps, arbitrary queries or a plugin-owned API client.

Summarize available facts for the scheduler and selected compute and installation targets before asking version questions:

| Fact                              | Acceptable evidence                                                                                      | When to ask                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| OS family and release             | Exact declared image and platform metadata or authoritative user-supplied configuration, with its source | Missing, ambiguous or conflicting metadata; never guess from image aliases or labels |
| Slurm software version            | Configured value for the target or authoritative supplied evidence                                       | Missing value or a conflict that affects the recipe                                  |
| MPI, compiler and libraries       | Explicit configured or runtime evidence                                                                  | Required information absent from the selected sources                                |
| OpenFOAM distribution and release | User requirement or an explicitly documented supported recipe                                            | A genuine application choice, not a default implied by the skeleton                  |

A cluster-init project version is not the Slurm software version. An OpenFOAM project version need not equal the application release. Supplied configured versions are an authoring baseline, not proof of runtime readiness; put runtime checks in the verification plan rather than asking the user to reconfirm clear facts.

When the CLI lacks a required read, identify the missing fact and offer documentation-assisted manual collection or offline authoring. Documentation describes procedures, not the actual cluster. Ask only about facts that matter to the recipe, and keep unresolved choices as TODOs.

## Project responsibilities

- `install` spec: verify prerequisites; designate one writer; stage a pinned installation, verify it, then publish readiness. Preserve prior versions. Per-node cluster-init run markers are not a shared lock.
- `runtime` spec: check access to the completed shared installation and prepare compatible node-local dependencies/environment. Do not reinstall shared software on every consumer.
- Slurm example: explicit resource limits, environment setup, small real case, selected MPI launcher and success criteria.
- README: supported combinations, evidence sources, unresolved choices, target mappings, rollout considerations, checks and recovery.

## Attachment and rollout handoff

Collect actual target identities, current ordered specs, parameter names and labels, ownership, inheritance, lockers and known shared uses. Use a CLI capability only if its contract supplies these facts; otherwise request the relevant authoritative evidence from the template or edit form. Never assume a first page or one selected target establishes complete preservation or all affected descendants.

Before a concrete edit, require complete current entries to preserve and enough information about which targets the edit affects. Shared or inherited scheduler parameters may also configure HA targets and do not establish a single installer. If scope is unresolved, leave the edit incomplete rather than inventing a parameter name or replacing a whole cluster.

Give the operator reviewed publication/attachment steps without executing them. For template-managed clusters, propose a minimal diff against the authoritative source; partial live evidence is not a replacement template. Re-read through a supported CLI capability or the manual source after attachment. A start/terminate handoff needs separate authorization, checks that workloads are safe and storage will survive, and confirmation that each action completed.

Keep stages distinct: authored, locally checked, published, attached, rolled out, installed, workload-verified. Uploading does not mean installed; job acceptance does not mean success.

## Local validation and remaining work

The starter scripts intentionally exit nonzero. Complete one selected OpenFOAM/platform/MPI recipe before describing it as runnable. The bundled checker validates the fixed file layout, TODOs and shell syntax only; it is not an INI validator, permission audit or runtime certification. `cyclecloud project test` is not a substitute for this local checker.

Publishing, attaching, configuring existing nodes, installation and workload tests are separate consequential workflows. Do not embed credentials in artifacts.

## References

- [CycleCloud projects](https://learn.microsoft.com/en-us/azure/cyclecloud/how-to/projects?view=cyclecloud-8)
- [Cluster-init reference](https://learn.microsoft.com/en-us/azure/cyclecloud/cluster-references/cluster-init-reference?view=cyclecloud-8)
- [Application evidence requirements](../../../docs/application-context.md)

Consult documentation for the selected OpenFOAM distribution and Slurm/MPI stack; no universal launcher or application version is assumed.
