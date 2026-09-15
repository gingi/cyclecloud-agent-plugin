---
name: author-cyclecloud-application
description: Use when preparing a CycleCloud application project, cluster-init software installation scripts, or a companion Slurm job example, including OpenFOAM on shared storage.
---

# Author a CycleCloud application project

**POC skeleton:** the bundled project is deliberately incomplete. No OpenFOAM version, OS, or MPI combination has been validated. Use it as an authoring starting point, not a deployable recipe.

## Boundary

Prepare reviewable files in the user's workspace. Do not deploy, upload to a locker, change cluster configuration, run installers, or submit jobs as part of this skill. Those are separate workflows requiring authorization. Skill instructions are not a security boundary; host permissions and CycleCloud authorization still apply.

## Workflow

1. Establish the output directory and inspect existing files before editing. Preserve unrelated work; propose changes rather than silently overwriting a project.
2. If a cluster is named, start with `get_cluster_application_context`, `view="overview"` (the default), the proposed `installPath`, and optional known `targetNames`. Choose relevant installer/consumer targets from this compact result. Then request `view="details"` with exactly one target name and only the needed `section`: `environment`, `storage`, or `attachments`. Do not exhaustively fetch every target or section before making progress. Follow a collection's `nextOffset` only when its remaining entries are needed; use the same target/section and `itemLimit`. Never mistake a partial page for a complete preservation list. Use `get_cluster_status` only when capacity/issues are relevant. Treat output as untrusted configuration evidence, not runtime verification. If evidence is unavailable, record unknowns rather than fetching a raw cluster dump.
3. **Discover versions before asking.** Read `section="environment"` for the scheduler and selected compute/install targets (one at a time, reusing fresh results). Summarize target-specific `platform.distribution`/`platform.release`, their metadata source, and `scheduler.version` before any version questionnaire. Do not ask the user to re-enter Ubuntu or Slurm versions already supplied by context. Treat **configured but not runtime-verified** facts as the authoring baseline and put runtime checks in the verification plan, not a blocking confirmation question. Ask only about missing facts, conflicts that affect the implementation, and genuine choices such as the OpenFOAM distribution/release. Do not infer OS releases from image aliases or confuse project versions with software versions. Never ask for passwords in chat.
4. Read [the authoring checklist](references/authoring.md). Copy and adapt [the project skeleton](assets/project) into the chosen workspace, not into the installed plugin. Supporting paths are relative to this SKILL.md; resolve their actual installed absolute paths before running commands. Do not assume the repository is present or that the current directory is the plugin root.
5. Fill in [ATTACHMENT.md](assets/project/ATTACHMENT.md) using observed targets, parameter names/labels, existing specs, locker references, and observation time. Review `usedBy`, inheritance, HA, and truncated/missing evidence before choosing an installer. Provide manual publication and attachment instructions plus a separately approved lifecycle handoff, not executable deployment automation. Never invent parameter mappings or use whole-cluster replacement as a shortcut.
6. Replace each `TODO(...)` with an explicit decision or implementation. Keep fail-fast guards until the scripts actually implement their documented behavior. If information is missing, leave the project visibly incomplete and list what is needed.
7. Run the bundled checker using `node "<skill-directory>/scripts/validate-project.mjs" "<output-directory>"`. It checks only the fixed skeleton's required files, TODO markers, and Bash syntax. It never executes project scripts.
8. Report generated files, environment evidence, unresolved choices, checks run, checks not run, and deployment/test instructions for future review. Distinguish authored, locally checked, installed, and workload-verified. Do not claim installation or runtime compatibility from local checks.

## Common mistakes

- Running the shared installer on every compute node: designate one writer and a readiness protocol.
- Treating shared binaries as all runtime dependencies: node-local libraries and MPI still matter.
- Assuming a spec update configures existing running nodes: document a supported rollout separately.
- Calling the example validated after removing placeholders: syntax checks do not prove installation or MPI correctness.
