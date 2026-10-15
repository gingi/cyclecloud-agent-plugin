# Application publication, attachment and rollout handoff

**Draft instructions only.** This document does not authorize uploads, configuration changes, lifecycle actions, installation or job submission. Complete and review the application implementation first.

## Evidence and scope

- CycleCloud instance, profile and cluster: TODO(target-cluster)
- Evidence source and observation time: TODO(observed-at)
- Selected standalone definitions and node arrays: TODO(targets)
- Configured images, roles, Slurm partitions, mounts and volume persistence: TODO(configured-environment)
- Unavailable or partial evidence and unresolved runtime checks: TODO(unknowns)

Record facts from supported CLI reads or explicitly identified authoritative manual evidence. Configuration is not runtime verification. Confirm actual OS/MPI, writable shared storage, job activity and storage survival separately. Missing evidence is unknown, not a negative finding.

## 1. Publish the reviewed project (operator step)

- Project and version: TODO(project-version)
- Target locker: TODO(locker)
- Trusted source, checksum and review status: TODO(artifact-review)

The operator configures the CLI outside chat. Confirm the intended profile and authorization before consequential actions. Check installed help for `cyclecloud locker list` and `cyclecloud project upload`; after confirming the intended locker, upload from the reviewed project directory using `cyclecloud project upload <locker-name>`. Replace and quote the actual locker name; do not run placeholders literally.

Do not overwrite a project version already in use. Confirm publication through operator CLI/storage access. Publication does not attach or install the project.

## 2. Attach the specs (operator step)

| Target                 | Role                     | Actual parameter name / UI label | Preserve existing additional specs | Add project:spec:version | Other affected targets |
| ---------------------- | ------------------------ | -------------------------------- | ---------------------------------- | ------------------------ | ---------------------- |
| TODO(installer-target) | Designated single writer | TODO(installer-parameter)        | TODO(existing-installer-specs)     | TODO(install-spec)       | TODO(shared-scope)     |
| TODO(runtime-targets)  | Application consumers    | TODO(runtime-parameters)         | TODO(existing-runtime-specs)       | TODO(runtime-spec)       | TODO(shared-scope)     |

Use an advertised selective CLI read or the authoritative template/edit form to establish complete existing specs, parameter ownership, inheritance and known shared uses. Record the source and coverage. A partial list is not enough to preserve existing entries. Reading one cluster does not establish the configuration of all its descendants. If mappings or scope are unavailable, this handoff remains **incomplete**. Do not reconstruct them from a full parameter export or raw node dump. An HA scheduler's shared parameter does not establish a single-writer installation strategy.

For a Slurm template exposing Cluster-Init fields, locate the actual discovered labels in the cluster edit form (typically Software). Add the reviewed entries while preserving existing values and order. Save only the approved configuration change.

For template-managed clusters, provide a minimal diff against the authoritative source instead. Do not rebuild the definition from partial observations or prescribe `import_cluster --force` as an attachment shortcut. Ask the template owner when mappings cannot be resolved.

## 3. Re-read and plan rollout

After attachment, verify references, versions, targets and scope through the same supported CLI capability or manual source. Missing or partial evidence means verification is incomplete. Configured specs do not prove execution.

- Newly provisioned versus existing running nodes: TODO(rollout-procedure)
- Shared-storage survival and recovery: TODO(storage-and-recovery)
- Slurm drain/maintenance readiness: TODO(workload-safety)
- Necessary actions, order and approving operator: TODO(approved-action-plan)

`terminate_cluster` and `start_cluster` require separate approval of exact targets and arguments. They do not upload or attach projects, drain jobs, or prove installation. Do not terminate by default or assume terminate/start preserves data. If a reviewed rollout requires termination, observe completion before starting; an accepted request or an unknown outcome does not establish completion. This authoring workflow executes neither action.

## 4. Verify installation and workload separately

TODO(installation-logs-and-application-specific-success-checks)

TODO(bounded-serial-and-parallel-slurm-test-and-expected-results)

Available cluster/node observations are supporting evidence only. Report stages separately: authored, locally checked, published, attached, rolled out, installed, workload-verified.
