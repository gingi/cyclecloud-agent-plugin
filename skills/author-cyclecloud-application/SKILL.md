---
name: author-cyclecloud-application
description: Use when preparing a CycleCloud application project, cluster-init software installation scripts, or a companion Slurm job example, including OpenFOAM on shared storage.
---

# Author a CycleCloud application project

**Proof-of-concept skeleton:** the bundled project is deliberately incomplete. No combination of OpenFOAM version, OS and MPI has been validated. Use it as an authoring starting point, not a deployable recipe.

## Boundary

Prepare reviewable files in the user's workspace. Do not deploy, upload to a locker, change cluster configuration, run installers or submit jobs as part of this skill. Those actions need separate authorization. Skill instructions are not a security boundary; host permissions and CycleCloud authorization apply.

## Workflow

1. Establish the **local project output directory** and inspect existing files before editing. Keep it separate from the **cluster installation prefix** (default `/shared/apps`). That prefix describes a destination on cluster nodes, not a CLI flag or local directory. Do not inspect or create the cluster prefix locally; do not broaden host filesystem permissions to accommodate it. Preserve unrelated work.

2. For a named cluster, follow [Use the CycleCloud CLI](../use-cyclecloud/SKILL.md). When `cyclecloud.nodes.v1` is available, use `node list --cluster NAME --kind definition --format json` to select readable arrays and standalone definitions, paging only as needed.

    Identity-only discovery does not establish installer roles, images, environment or attachment mappings. Discover further supported reads before requesting those facts. Do not enumerate every target or dump configuration and parameters to reconstruct a missing view. Basic node JSON is not complete authoring context.

    If required evidence is unavailable, explain the gap and offer manual evidence or **offline authoring** with explicit unknowns. Never install a dependency or use an API fallback automatically. See [evidence requirements](../../docs/application-context.md).

3. **Discover versions before asking.** Gather available configured OS and Slurm versions for the scheduler and selected compute and installation targets. Record each value's target and source. Do not ask the user to re-enter facts already supplied by reliable context.

    These facts are **configured but not runtime-verified**: use them as the authoring baseline and plan live checks later. Ask about missing facts, conflicts that affect the implementation, and genuine choices such as the OpenFOAM distribution and release. Do not infer OS releases from image aliases or confuse project versions with software versions. Never ask for passwords in chat.

4. Read [the authoring checklist](references/authoring.md). Find [the project skeleton](assets/project) and checker relative to this skill's installed directory, not the working directory or an assumed checkout. Copy and adapt assets into the chosen workspace, never into the plugin installation.

5. Fill in [ATTACHMENT.md](assets/project/ATTACHMENT.md) with observed targets, actual parameter names and labels, all existing specs, locker references, evidence sources and times, and known shared uses and inheritance. Do not invent attachment mappings or infer completeness from partial output.

    If you cannot establish what must be preserved or which targets share the configuration, leave the concrete edit incomplete and explain the evidence needed. Provide manual publication and attachment instructions and a separately approved rollout plan, not automation that executes deployment.

6. Replace each `TODO(...)` only with an explicit decision or implementation. Keep fail-fast guards until scripts implement their documented behavior. Missing information leaves the draft visibly incomplete.

7. Run `node "<skill-directory>/scripts/validate-project.mjs" "<output-directory>"`. The checker examines required files, TODO markers and Bash syntax without executing scripts. Do not substitute `cyclecloud project test`, which can create and operate a cluster.

8. Report files, evidence and its sources, unresolved choices, checks run and not run, and instructions for future deployment and tests. Distinguish authored, locally checked, installed and workload-verified. Local checks do not establish runtime compatibility.

## Common mistakes

- Installing shared software on every compute node: choose one installer and define how other nodes will know the installation is ready.
- Treating shared binaries as all dependencies: node-local libraries and MPI still matter.
- Assuming a spec update configures existing running nodes: plan rollout separately.
- Reconstructing authoritative cluster configuration from a partial read: request the actual template or manual evidence instead.
- Calling a recipe validated after removing TODOs: syntax checks do not prove installation or MPI correctness.
