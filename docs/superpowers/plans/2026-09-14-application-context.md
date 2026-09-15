# Application Context Implementation Plan

**Goal:** Add read-only `get_cluster_application_context` and teach the authoring skill to produce a target-specific `ATTACHMENT.md` without publishing or modifying a cluster.

**Architecture:** Reuse authenticated, bounded HTTP reads. Verify the cluster identity with the existing cluster read, then use fixed `/exec/query/` projections for standalone nodes/nodearrays and cluster-init parameters. Normalize only explicitly allowed fields in a dedicated module; do not expose arbitrary configuration, parameter values, credentials, or raw expressions. Optional unavailable evidence remains explicit. All context describes configuration, not runtime verification.

**Tech Stack:** TypeScript, existing MCP SDK/Zod/Undici, Vitest, Node validator, packaged Markdown/assets.

This continues the approved R1 POC recommendation on the current feature branch. No new worktree, commits, deployment, or model-backed evaluation is required.

## Backend evidence

- `cloud/cluster/rest/clusters_url.py` returns full or summarized records; full records omit node-array definitions and include unnecessary sensitive data.
- `cloud/cluster/clusters.py:update_parameters` selects definitions with `Template === Name || IsArray === true`.
- `_Template.AdditionalClusterInitSpecs` preserves a simple `$ParameterName` reference; `ClusterInitSpecs` contains merged specs with `AdditionalSpec` flags.
- Parameter definitions live on the root cluster (`ParentName` chain); obtain them only through scoped authorized queries, projecting only `Cloud.ClusterInitSpecs` parameters.
- Slurm configuration, mount definitions, images, Extends, and project/locker identities can be selected from node definitions. Actual software, permissions, filesystem health, artifacts in storage and scheduler state are not established.

## Steps

- [x] Add failing tests for exact scoped query routes, escaping, and selected fields.
- [x] Add client methods for fixed node-context and parameter-metadata reads, using the existing wildcard Accept convention for `/exec/query/`.
- [x] Add fixture-driven tests for normalized topology, images, Slurm fields, mounts, path coverage, spec attachments, shared parameter references, secret omission, malformed data, case collisions, bounds, unavailable evidence, and defensive-copy behavior.
- [x] Implement `src/application-context.ts`: closed allowlists, bounded collections, source/coverage metadata, no raw configuration/parameter/URL output. Reuse existing wire validation helpers rather than duplicating them.
- [x] Integrate orchestration in `src/tools.ts`: verify identity first; resolve parent parameter scope with a bounded/cycle-checked traversal; preserve context when optional reads fail, but propagate cancellation.
- [x] Register the read-only MCP tool in `src/server.ts` with validated cluster/target names, absolute POSIX install path, and a target limit. Update fake clients, discovery expectations, integration/subprocess tests, and error-path coverage.
- [x] Extend the skill, reference checklist, project assets and local validator for `ATTACHMENT.md`: exact targets/parameter names, existing spec preservation, inherited/shared-target warnings, manual publication and attachment steps, lifecycle handoff, and verification limits.
- [x] Update explicit packaging lists/tests and user/developer/design documentation. Keep the MCP read-only by default; no new mutation tools.
- [x] Run focused tests, then `npm run verify`; self-review diff. Report any lack of live endpoint/host validation without claiming it occurred.

## Follow-up: compact discovery

The application-context tool now defaults to a compact overview. Detailed environment, storage and attachment reads require one exact target and one section. Overview does not fetch full mount/spec records or parameter values; attachment metadata is filtered to the matching parameter. Collection pages have count and serialized-byte limits with `nextOffset`, preserving complete identifiers and configured ordering. The skill selects relevant targets/sections and pages only when needed. Orchestration lives in `src/application-context-reader.ts`; the normalization module retains the closed field allowlists. Regression tests cover large outputs, entries beyond the old truncation limit, unavailable shared-use evidence, and MCP schema discovery. Live host spill behavior remains unverified.

## Initial implementation verification outcome

`npm run verify` passed: formatting, ESLint, TypeScript, bundle generation, 331 passing Vitest tests (13 skipped), 24 Python reset tests, and zero audit vulnerabilities. `git diff --check` passed. Backend source and fixtures informed the contracts; no live CycleCloud queries, host skill evaluation, upload, configuration change, lifecycle action, or deployment was performed.
