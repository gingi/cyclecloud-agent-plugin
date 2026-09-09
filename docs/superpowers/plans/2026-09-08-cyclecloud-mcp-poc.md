# CycleCloud MCP Agent Plugin POC Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small Agent Plugins 1.0 proof of concept that lets VS Code agent mode inspect CycleCloud and, when explicitly enabled, start or terminate a cluster.

**Architecture:** A bundled Node/TypeScript stdio MCP server reads one local CycleCloud profile, calls a narrow set of CycleCloud HTTP endpoints, normalizes responses into bounded tool results, and registers mutation tools only when enabled. The implementation favors a clear demonstration and a small review surface over production-grade policy infrastructure.

**Tech Stack:** Node 20+, strict TypeScript/ESM, `@modelcontextprotocol/sdk`, Zod, Undici, esbuild, Vitest, ESLint, Prettier.

---

## POC scope

This plan intentionally implements the smallest useful and responsible subset of the approved design.

### Included

- Agent Plugins 1.0 `plugin.json` and `mcp.json`.
- A committed, bundled stdio MCP module launched with `node`.
- `list_clusters`, `get_cluster`, and `get_cluster_status` by default.
- `start_cluster` and `terminate_cluster` only when `enableMutations` is true.
- Direct CycleCloud HTTP calls with Basic authentication.
- One `${PLUGIN_DATA}/cyclecloud.json` profile with strict JSON validation.
- Credential-file checks: regular file, no symlink following, current-user ownership, and mode `0600` or `0400` on POSIX.
- TLS verification by default, optional custom CA, and explicit opt-in for remote HTTP.
- Fixed model-facing errors that never include response bodies, credentials, headers, URLs, or exception text.
- Bounded tool inputs and outputs.
- No automatic retry of lifecycle actions; ambiguous post-dispatch failures return an unknown outcome.
- Focused unit/integration tests, one subprocess smoke test, operator documentation, and a local demo.

### Deferred unless the POC reveals a need

- OS keyring, Entra ID, managed identity, or multiple profiles.
- Full ancestor-chain and filesystem-metadata probing.
- A large closed diagnostic-event taxonomy and adversarial redaction matrix.
- Global request queues, connection-budget proofs, and a dedicated concurrency framework. A simple in-process mutation lock is sufficient.
- Exhaustive validation of every optional CycleCloud response field.
- Byte-for-byte cross-platform bundle reproducibility infrastructure.
- Full-history secret scanners, a large CI matrix, and formal 16-section evidence reports.
- Marketplace packaging, remote repository creation, and publication.

The design specification remains the security reference. Any deferred item that proves necessary during the demo becomes a follow-up, not an unplanned expansion of this POC.

## Target file structure

```text
plugin.json
mcp.json
package.json
package-lock.json
tsconfig.json
eslint.config.js
vitest.config.ts
scripts/build.mjs
bin/cyclecloud-mcp.mjs
src/
  index.ts
  config.ts
  credentials.ts
  errors.ts
  cyclecloud-client.ts
  normalize.ts
  tools.ts
  server.ts
tests/
  config.test.ts
  cyclecloud-client.test.ts
  normalize.test.ts
  tools.test.ts
  server.test.ts
  subprocess.test.ts
  helpers/fake-cyclecloud.ts
README.md
```

Each runtime file has one responsibility; avoid adding layers or directories until a concrete test requires them.

---

## Milestone 1: Bootstrap the plugin package

**Files:**
- Create: `package.json`, `package-lock.json`
- Create: `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`
- Create: `.gitignore`, `.editorconfig`
- Create: `plugin.json`, `mcp.json`
- Create: `src/index.ts`
- Create: `tests/server.test.ts`

- [ ] Create branch `poc/implementation` from the approved design commit.
- [ ] Add exact-pinned dependencies and scripts for `build`, `typecheck`, `lint`, `format:check`, `test`, and `verify`.
- [ ] Add the exact Agent Plugins 1.0 manifests from the design. `mcp.json` must launch `node ${PLUGIN_ROOT}/bin/cyclecloud-mcp.mjs` without package-data secrets.
- [ ] Write a failing test that validates the manifest shape and asserts the MCP command/arguments are exact.
- [ ] Add the minimal placeholder composition root needed for TypeScript and test discovery.
- [ ] Run `npm ci --ignore-scripts`.
- [ ] Run `npm test -- server`; expect the manifest test to pass.
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] Commit: `chore: bootstrap CycleCloud MCP agent plugin`.

Do not add CI, vendored schemas, or production behavior in this milestone.

---

## Milestone 2: Load configuration and credentials safely

**Files:**
- Create: `src/config.ts`
- Create: `src/credentials.ts`
- Create: `src/errors.ts`
- Create: `tests/config.test.ts`

`cyclecloud.json` has this POC shape:

```ts
interface CycleCloudConfig {
  url: string;
  username: string;
  password: string;
  verifyTls: boolean;          // default true
  caCertPath?: string;
  allowInsecureHttp: boolean;  // default false
  enableMutations: boolean;    // default false
  requestTimeoutMs: number;    // default 30_000
  actionTimeoutMs: number;     // default 60_000
  debug: boolean;              // default false
}
```

- [ ] Write failing tests for defaults, unknown-property rejection, printable ASCII credentials, username-colon rejection, timeout bounds, URL grammar, and the supported transport combinations.
- [ ] Write failing POSIX tests proving the loader rejects a symlink, non-regular file, wrong owner, and any mode other than `0600` or `0400`.
- [ ] Write a failing test proving a missing profile creates only a secret-free `cyclecloud.example.json` at mode `0600` and returns a bounded startup error.
- [ ] Implement one configuration loader in `src/config.ts`; keep helper functions private unless tests require a public seam.
- [ ] Open the credential file with no symlink following, verify it through the open descriptor, read it once, and close it in `finally`.
- [ ] Implement `CredentialProvider` and a file-backed provider that exposes credentials only to the HTTP client.
- [ ] Implement fixed error categories/messages. Do not interpolate exceptions or config values into model-facing text.
- [ ] Run `npm test -- config`; expect all success and failure-path tests to pass.
- [ ] Run `npm test`; then run typecheck and lint.
- [ ] Commit: `feat: load a permission-checked CycleCloud profile`.

Keep the security claim narrow: these checks improve on ordinary CLI file handling but do not protect against another process running as the same user.

---

## Milestone 3: Implement the CycleCloud HTTP adapter

**Files:**
- Create: `src/cyclecloud-client.ts`
- Create: `src/normalize.ts`
- Create: `tests/helpers/fake-cyclecloud.ts`
- Create: `tests/cyclecloud-client.test.ts`
- Create: `tests/normalize.test.ts`

The client supports only these calls:

```text
GET  /cloud/api/clusters?summary=true&cloud_instances=true
GET  /cloud/api/clusters/{name}?summary=true&cloud_instances=true
GET  /clusters/{name}/status?nodes=false
POST /cloud/actions/startcluster/{name}?wait_time=30&recursive={bool}&test_mode=false
POST /cloud/actions/terminatecluster/{name}?wait_time=30&recursive={bool}
```

- [ ] Build a small in-process fake HTTP server that records requests and returns queued responses.
- [ ] Write failing tests for exact methods, encoded path segments, query parameters, Basic authorization bytes, manual redirects, read/action timeouts, and one request per operation.
- [ ] Write failing tests for default certificate verification and a runtime-generated custom CA with a matching SAN. Include one wrong-CA or hostname-mismatch failure test.
- [ ] Write failing tests proving non-2xx response bodies and exception messages never appear in returned errors.
- [ ] Write failing tests for the 8 MiB successful-read limit, malformed JSON, and cancellation.
- [ ] Implement the client with one Undici dispatcher, at most four connections, manual redirects, and no retries.
- [ ] Build the Basic header only inside the client from `CredentialProvider`.
- [ ] Cancel response bodies that are not consumed. Always clear timers and abort listeners in `finally`.
- [ ] Write focused normalization tests for representative list, detail, and status fixtures; sorting; configured limits; truncation flags; malformed required identities; and duplicate case-insensitive consumed keys.
- [ ] Implement compact stable outputs containing only fields needed for the demo. Ignore unknown response properties.
- [ ] Run `npm test -- cyclecloud-client` and `npm test -- normalize`.
- [ ] Run the whole test suite, typecheck, and lint.
- [ ] Commit: `feat: add bounded CycleCloud HTTP client`.

Do not build a general CycleCloud SDK or validate unused response fields.

---

## Milestone 4: Expose MCP tools and mutation safety

**Files:**
- Create: `src/tools.ts`
- Create: `src/server.ts`
- Create: `tests/tools.test.ts`
- Modify: `tests/server.test.ts`
- Modify: `src/index.ts`

- [ ] Write failing tests for bounded Zod input schemas and defaults for all five tools.
- [ ] Write failing tests proving default configuration discovers exactly the three read tools and performs no mutation dispatch.
- [ ] Write a failing test proving `enableMutations: true` discovers all five tools and emits one fixed startup warning.
- [ ] Write failing tests for read success, `cluster_not_found`, malformed response, and fixed structured errors.
- [ ] Write mutation tests covering: pre-dispatch cancellation, overlapping mutation returns `busy`, 2xx accepted, 401/403/404 definitive rejection, all other post-dispatch failures unknown, no automatic retry, and one best-effort status read only after accepted 2xx.
- [ ] Implement the three read handlers as thin calls into `CycleCloudClient` and normalization functions.
- [ ] Implement one simple non-queuing mutation lock in `server.ts`; release it in `finally` on every path.
- [ ] Register start/terminate only when enabled. Treat MCP hints and descriptions as advisory; server-side CycleCloud authorization remains authoritative.
- [ ] Map every result to structured MCP content plus concise bounded text. Never copy raw HTTP records or error bodies.
- [ ] Wire configuration, provider, client, and stdio transport in `src/index.ts`. Startup failures go to stderr; stdout is MCP-only.
- [ ] Run `npm test -- tools` and `npm test -- server`.
- [ ] Run the whole suite, typecheck, and lint.
- [ ] Commit: `feat: expose read-only-by-default CycleCloud MCP tools`.

This milestone completes the functional POC. Do not add resources, prompts, pagination protocols, or generic HTTP tools.

---

## Milestone 5: Bundle, document, and smoke-test the plugin

**Files:**
- Create: `scripts/build.mjs`
- Create: `bin/cyclecloud-mcp.mjs`
- Create: `tests/subprocess.test.ts`
- Create: `README.md`

- [ ] Add a deterministic esbuild command that bundles `src/index.ts` and dependencies into `bin/cyclecloud-mcp.mjs` with no shebang.
- [ ] Build and ensure Git records the bundle as non-executable mode `100644`.
- [ ] Write one subprocess test that launches the exact `node` command from `mcp.json`, completes an MCP handshake, lists the default three tools, calls one read tool, and proves stdout contains only MCP traffic.
- [ ] Add one subprocess startup-failure test proving missing configuration emits a bounded stderr message, creates the secret-free example under `PLUGIN_DATA`, and writes nothing under `PLUGIN_ROOT`.
- [ ] Add one end-to-end canary assertion covering stdout, stderr, structured results, and text results.
- [ ] Document installation, supported platforms, the profile format, plaintext limitations, dedicated least-privileged account guidance, TLS/custom CA, endpoint stability, mutation enablement and confirmation expectations, example prompts, troubleshooting, and uninstall cleanup.
- [ ] Run `npm run build`.
- [ ] Run `npm run verify`; it must run format check, lint, typecheck, tests, `npm audit --audit-level=high`, and build.
- [ ] Inspect the complete diff with reviewer stance, especially every promise rejection, timer/listener cleanup, credential boundary, and mutation outcome.
- [ ] Commit: `docs: package and document CycleCloud MCP POC`.

A byte-for-byte reproducibility gate and broad platform CI can be added if the POC is selected for further development.

---

## Milestone 6: Demonstrate and assess

**Files:**
- Create: `docs/demo-notes.md`

- [ ] Register the local repository through `chat.pluginLocations` and record the VS Code and Node versions.
- [ ] Create the profile outside the agent conversation using a dedicated POC CycleCloud account and `enableMutations: false`.
- [ ] Verify the three read tools are discoverable and demonstrate list, detail, status, invalid credentials, and unknown-cluster behavior.
- [ ] Record qualitative findings: usefulness, response quality, latency, tool discoverability, missing data, and endpoint compatibility.
- [ ] Check whether the tested VS Code build provides per-call mutation confirmation.
- [ ] Only if confirmation exists and the account is scoped to a safe test group, temporarily enable mutations and demonstrate one start or terminate call with exact user approval. Otherwise record mutation demonstration as skipped.
- [ ] Restore `enableMutations: false`, disable the plugin, delete `cyclecloud.json`, and rotate or disable the POC credential.
- [ ] Run the full test suite once more after any demo-driven fixes.
- [ ] Commit only non-secret demo notes: `docs: record CycleCloud MCP POC assessment`.

## Completion criteria

The POC is complete when:

- VS Code recognizes the repository as an Agent Plugins 1.0 package and starts the bundled stdio server.
- The three read tools work against a local CycleCloud installation and return bounded structured data.
- Mutation tools are absent by default and, when enabled, never automatically retry an uncertain action.
- Credential material is absent from manifests, tool schemas, results, logs, tests, and Git.
- The profile is permission-checked, TLS verification is secure by default, and server error bodies are not exposed to the model.
- Targeted failure-path tests and the full test suite pass.
- The README explains the POC's security limitations and cleanup procedure.
- Demo notes capture enough evidence to decide whether a production-quality follow-up is worthwhile.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-08-cyclecloud-mcp-poc.md`.

Implementation should use fresh scoped subagents per milestone, with one focused review after each milestone. Avoid adding work that is not required by a failing test, the local demonstration, or the included POC scope.
