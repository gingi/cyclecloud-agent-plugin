# Application publication, attachment and rollout handoff

**Draft instructions only.** This document does not authorize upload, configuration changes, lifecycle actions, installer execution, or job submission. Complete and review the application implementation first.

## Evidence and scope

- CycleCloud instance/profile and cluster: TODO(target-cluster)
- Configuration observation time: TODO(observed-at)
- Selected node/node-array definitions: TODO(targets)
- Configured images, roles, Slurm partitions, mounts and volume persistence: TODO(configured-environment)
- Unavailable/truncated evidence and unresolved runtime checks: TODO(unknowns)

Record facts from `get_cluster_application_context`; do not interpret its `evidence: configured` as runtime validation. Confirm the actual OS/MPI, shared mount readiness, permissions, job activity and storage survival separately. An absent field is not a negative finding.

## 1. Publish the reviewed project (operator step)

- Project/version: TODO(project-version)
- Target locker: TODO(locker)
- Trusted source/checksum and review status: TODO(artifact-review)

The operator configures their own CycleCloud CLI outside chat. The MCP credential file does not configure the CLI. After confirming the intended instance and locker with `cyclecloud locker list`, upload from the reviewed project directory with `cyclecloud project upload <locker-name>`. Replace the placeholder with the selected locker and quote shell arguments appropriately; do not run the placeholder command literally.

Do not overwrite a project version already in use. Confirm publication succeeded through the operator's CLI/storage access; the context tool does not enumerate uploaded artifacts. Publication does not attach or install the project.

## 2. Attach the specs (operator step)

| Target                 | Role                     | Actual parameter name / UI label | Preserve existing additional specs | Add project:spec:version | Other affected targets |
| ---------------------- | ------------------------ | -------------------------------- | ---------------------------------- | ------------------------ | ---------------------- |
| TODO(installer-target) | Designated single writer | TODO(installer-parameter)        | TODO(existing-installer-specs)     | TODO(install-spec)       | TODO(shared-scope)     |
| TODO(runtime-targets)  | Application consumers    | TODO(runtime-parameters)         | TODO(existing-runtime-specs)       | TODO(runtime-spec)       | TODO(shared-scope)     |

After choosing targets from the overview, request `view="details"`, `section="attachments"` for one target at a time. Use its discovered `attachment.parameterName`, parameter label/current specs and `usedBy.items`. Follow each needed collection's `nextOffset` until preservation/shared-scope evidence is complete; a page is not the full list. `usedBy` covers definitions in the queried cluster, not all descendants of a parent parameter scope. Check `usedBy.available`, paging/truncation, missing metadata and inheritance (from the environment section). In particular, a scheduler's parameter may also configure an HA scheduler array: that is not a single-writer installation strategy.

For a standard Slurm template that exposes these fields, open the cluster's edit form, locate the discovered Cluster-Init fields (typically in Software), and add the reviewed project/spec/version entries while preserving existing entries. Match by actual parameter metadata, not assumed names. Record the exact labels and values above before handing off. Save only the reviewed configuration change.

For a template-managed cluster, provide a minimal diff against its authoritative template/configuration instead. Do not rebuild a cluster definition from this partial context. If no simple parameter mapping is available, inspect the template or consult its owner. Do not prescribe `import_cluster --force`: replacement is not a narrow attachment edit.

## 3. Re-read and plan rollout

After the operator saves the attachment, call `get_cluster_application_context` again with `view="details"`, `section="attachments"`, and the specific target. Confirm the expected references, versions and targets. Missing or truncated evidence means this check is incomplete. Spec configuration is not proof that scripts executed.

- Newly provisioned nodes versus existing running nodes: TODO(rollout-procedure)
- Shared-storage survival and recovery: TODO(storage-and-recovery)
- Slurm job drain/maintenance readiness: TODO(workload-safety)
- Which actions are necessary, in what order, and who approves them: TODO(approved-action-plan)

The MCP can optionally expose `terminate_cluster` and `start_cluster`, but only when enabled and separately approved with exact arguments. They do not upload or attach a project, drain jobs, or prove installation. Do not terminate a running cluster by default. Do not assume terminate/start is an in-place restart or that it preserves application data. Where a reviewed rollout requires termination, wait until termination is observed before starting; an accepted request or unknown outcome is not completion. This authoring skill does not execute these actions.

## 4. Verify installation and workload separately

TODO(installation-logs-and-application-specific-success-checks)

TODO(bounded-serial-and-parallel-slurm-test-and-expected-results)

Use cluster status/issues as supporting evidence only. The current context tool does not report cluster-init execution history or submit Slurm jobs. Report stages separately: authored, locally checked, published, attached, rolled out, installed, workload-verified.
