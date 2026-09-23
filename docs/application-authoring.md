# Author a CycleCloud application project

Use `author-cyclecloud-application` to draft cluster-init project files and a companion Slurm job in your workspace. When you name a cluster, the skill uses its configured environment and attachment mappings to guide the draft.

**This is an authoring starting point, not a deployable recipe.** The bundled OpenFOAM/Slurm skeleton is deliberately incomplete, and no application/OS/MPI combination has been validated. Upload, attachment, rollout, installation, and job submission are separate actions requiring approval.

## Start a draft

[Install the plugin](../README.md#quick-start), open the workspace where you want the project, and start an agent session. For example:

> Use the author-cyclecloud-application skill to prepare an OpenFOAM cluster-init project and a Slurm example in the current workspace, targeting /shared/apps on the cluster nodes. Use cluster `demo` as the configured environment. Create local project files only; do not access or create /shared/apps on this host, upload, deploy, run installers, or submit jobs. Tell me what information is missing.

Replace `demo` with your cluster's name. `/shared/apps` is the installation prefix on cluster nodes, not the local project directory. Choose a separate workspace directory for the generated files; existing files should be inspected and preserved before changes are proposed.

The skill first discovers cluster targets, then requests only the relevant environment, storage, and attachment details. It should reuse configured OS and Slurm versions, ask about missing or conflicting facts, and ask you to choose the OpenFOAM distribution/release and other application-specific requirements. Configuration does not prove that software is installed or storage is ready.

If you do not have a reachable cluster, ask for **offline authoring**. The draft should explicitly mark unknown environment facts and attachment mappings rather than invent them. See [configuration](configuration.md) for CLI setup and [application context](application-context.md) for the evidence available from a cluster.

## What you receive

The project follows the bundled skeleton's layout:

| File                                               | Purpose                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `project.ini`                                      | Cluster-init project metadata.                                                                                      |
| `specs/install/cluster-init/scripts/10-install.sh` | Installation script to adapt for the chosen software and designated writer.                                         |
| `specs/runtime/cluster-init/scripts/10-runtime.sh` | Node-local runtime preparation.                                                                                     |
| `examples/openfoam.sbatch`                         | Slurm job example to complete with a real case and success criteria.                                                |
| `README.md`                                        | Environment assumptions, usage, and verification instructions.                                                      |
| `ATTACHMENT.md`                                    | Publication, target/spec mappings, preservation of existing specs, shared scope, rollout, and verification handoff. |

Review the files before any consequential action. Unresolved choices remain `TODO(...)` markers, and script guards must remain until the scripts implement their documented behavior. Removing placeholders alone does not make the application safe or runnable.

For shared-storage installation, identify a single writer and a readiness protocol. Compute nodes may still need local libraries and compatible MPI. A spec update does not by itself configure existing running nodes.

## Check the authored project

The bundled checker requires Node.js and Bash. Replace both paths with the installed plugin location and the authored project directory:

```sh
node "<plugin-root>/skills/author-cyclecloud-application/scripts/validate-project.mjs" \
  "<local-project-directory>"
```

It checks the fixed skeleton's required files, unresolved TODO markers, and Bash syntax. It never executes project scripts and is not a general validator for arbitrary CycleCloud projects.

| Exit code | Meaning                                                             |
| --------- | ------------------------------------------------------------------- |
| 0         | Structural, TODO, and shell-syntax checks passed.                   |
| 1         | The project is incomplete, a check failed, or Bash was unavailable. |
| 2         | The checker was invoked incorrectly.                                |

The untouched skeleton is expected to exit **1**. A passing check does not establish installation success, MPI compatibility, or Slurm execution.

## Review the deployment handoff

Before publication or cluster changes, review `ATTACHMENT.md` for:

- The intended instance, cluster, locker, project version, and selected targets.
- Actual attachment parameter names and existing specs that must be preserved.
- Shared or inherited parameter uses, HA targets, and incomplete or truncated evidence.
- A separately approved rollout, including job readiness and storage survival.
- Installation logs and serial/parallel workload checks with explicit success criteria.

Keep stages distinct: **authored**, **locally checked**, **published**, **attached**, **rolled out**, **installed**, and **workload-verified**. Inspection and local checks do not complete later stages.

For testing or extending the skill, see [authoring evaluation](development.md#application-authoring-evaluation) and the [authoring roadmap](agent-plugin-design.md#application-authoring-evolution). Current environment coverage is recorded under [verification status](development.md#verification-status).
