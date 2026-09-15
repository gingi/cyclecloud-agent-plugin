# Application authoring POC

## What this branch provides

A skeleton for the next plugin capability, not a working application installer:

- `skills/author-cyclecloud-application/SKILL.md`: an authoring-only workflow.
- `references/authoring.md`: environment questions, project responsibilities, and documentation links.
- `assets/project/`: project metadata, install/runtime spec stubs, a Slurm job stub, a README, and `ATTACHMENT.md` with explicit TODOs and manual publication/attachment/rollout steps.
- `scripts/validate-project.mjs`: dependency-free Node utility for the fixed skeleton's required files, TODO markers, and Bash syntax. It never executes project scripts.
- Packaging and isolated tests for copying, updating, and using the assets outside the checkout.

The skill lives in the plugin's standard root `skills/<name>/SKILL.md` layout. It uses existing MCP reads where available and the host's ordinary file tools for authoring. The read-only `get_cluster_application_context` tool supplies target-specific evidence and attachment mappings; see [its contract](application-context.md). There are no new deployment operations or credentials.

## Local checks

From the repository root:

```bash
node skills/author-cyclecloud-application/scripts/validate-project.mjs \
  skills/author-cyclecloud-application/assets/project
```

**Expected exit: 1**, because this is an unfinished scaffold. Exit 0 means only that the fixed structural/TODO/syntax checks passed; exit 2 means incorrect invocation. Node and Bash are required. Missing Bash or syntax-check timeout is a failure, never a silent pass. The checker reads only the listed skeleton files; it is not a validator for arbitrary CycleCloud projects.

```bash
npx vitest run tests/application-skill.test.ts tests/local-install.test.ts
npm run verify
```

These are structural and executable-utility tests, not agent-behavior evaluations or live OpenFOAM tests.

## Manual plugin demo

1. Build/install this branch with `npm run install:local`. This changes the local installed plugin; it does not publish the branch. Do not use bundle-only deployment for skill changes.
2. Reload VS Code and start a fresh Copilot session as described in the main README.
3. Use a separate empty workspace. Ask:

    > Use the author-cyclecloud-application skill to prepare an OpenFOAM cluster-init project under /shared/apps and a Slurm example. Create local files only; do not upload, deploy, run installers, or submit jobs. Tell me what information is missing.

4. Confirm the host loads this skill, resolves its bundled assets from the installed package, and writes only to the chosen workspace. Check it does not claim a successful installation.
5. If a cluster is named, confirm the agent starts with the compact `get_cluster_application_context` overview, chooses relevant targets, then requests one target/section at a time with `view="details"`. It should not exhaustively fetch the cluster. Follow needed collection cursors to preserve existing specs and inspect `usedBy`/HA scope before completing `ATTACHMENT.md`; leave incomplete evidence explicit. Check it does not invent runtime OS, mount health, MPI, Slurm accounts, or missing parameter mappings.
6. Confirm the agent reads the relevant environment sections and summarizes `platform.release` and `scheduler.version` before asking version questions. Known configured Ubuntu/Slurm versions should be reused, not reconfirmed merely because runtime checks remain. OpenFOAM distribution/release is still a choice. Missing or materially conflicting metadata should produce a specific question, not a blanket version questionnaire.
7. Run the checker against the authored directory. Record failures and limits honestly; unresolved drafts should fail.

Repeat host-discovery checks in Copilot CLI and VS Code before claiming support. Installation tests use a fake CLI and do not establish real-host skill discovery or agent compliance. Do not automatically run a paid/model-backed evaluation or a live installation as part of the unit suite.

## Discussion/evaluation cases

| Scenario                                | Expected behavior                                                  |
| --------------------------------------- | ------------------------------------------------------------------ |
| Named reachable cluster                 | Gather available evidence; clarify missing environment facts.      |
| No MCP connection                       | Offer offline authoring with explicit unknowns.                    |
| Ambiguous OpenFOAM distribution/version | Ask rather than silently choose incompatible software.             |
| Existing workspace files                | Inspect and preserve unrelated work.                               |
| Shared installer                        | Designate one writer; do not race installers across compute nodes. |
| Incomplete scaffold or malformed shell  | Report local check failures.                                       |
| Authoring-only request                  | No upload, deployment, installer execution, or job submission.     |

### Version-discovery evaluation cases

- **Complete context:** image metadata declares Ubuntu 22.04 and `scheduler.version` is present. Expect a sourced baseline summary and only unanswered application/build choices, not repeated Ubuntu/Slurm questions.
- **Mixed targets:** scheduler and compute images differ. Expect per-target facts and a question only if selecting a compatible installation/build strategy requires a decision.
- **Unknown custom image:** no matching image-package metadata. Expect the unresolved OS release to be called out; no image-name guessing.
- **Denied or conflicting metadata:** preserve available Slurm/configuration facts and ask about the specific missing platform fact.
- **Project/software version distinction:** a Slurm project revision differs from `scheduler.version`. Expect the software version to come from scheduler configuration, never from the project revision.

These cases still require live host evaluation; text assertions and fixture tests do not establish agent compliance.

## Next implementation steps

- Select and document one OpenFOAM release, OS/architecture, and MPI stack.
- Implement the installer and runtime preparation with pinned sources, checksums, versioned staging, readiness, and recovery behavior.
- Replace the Slurm stub with a small real case and explicit success criteria.
- Add metadata/permission and application-specific checks as needed; do not equate syntax validation with runtime compatibility.
- Evaluate the skill in both hosts, including offline and existing-file cases, and record observations rather than assuming compliance from instruction text.
- With separate authorization and an appropriate test cluster, verify installation and serial/parallel execution.

Locker publication, spec attachment, existing-node rollout, and job submission remain separate future workflows. Keep product operation semantics in CycleCloud (eventually `cyclecloud-ops`), not solely in skill prose.
