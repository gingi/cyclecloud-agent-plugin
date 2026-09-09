# CycleCloud MCP POC demonstration notes

- **Initial demonstration:** 2026-09-08
- **GitHub source-install update:** 2026-09-09

## Environment

- VS Code Insiders: `1.137.0-insider`
- Runtime: WSL Ubuntu 22.04
- Node.js: `v24.13.1`
- CycleCloud: local backend on `http://127.0.0.1:8080`
- MCP launch: exact bundled `node /home/shpaster/src/cyclecloud-mcp/bin/cyclecloud-mcp.mjs`
- Mutations: disabled throughout

The existing local `claude` test account was read directly from the local secret store and written only to a temporary mode-`0600` profile. Its exact CycleCloud role and group scope were not established, so lifecycle testing was deliberately skipped.

## Automated verification

`npm run verify` completed formatting, lint, typecheck, bundle generation, 90 automated tests, and dependency audit with zero reported vulnerabilities before the live calls.

The subprocess suite independently proves:

- the bundle starts without source files or `node_modules`;
- missing configuration writes only a fixed stderr diagnostic and creates a secret-free example under plugin data;
- a real MCP handshake, discovery request, and read call complete over stdio;
- every captured stdout line is JSON-RPC traffic;
- raw stdout, stderr, tool metadata, text results, and structured results contain no credential canary;
- the copied plugin root is unchanged before and after startup and tool calls.

## Live read-only results

The bundled server discovered exactly:

1. `list_clusters`
2. `get_cluster`
3. `get_cluster_status`

`start_cluster` and `terminate_cluster` were absent because `enableMutations` remained `false`.

Observed calls:

- `list_clusters` returned 9 of 9 clusters with bounded summaries and no truncation.
- `get_cluster` returned bounded detail for `altair1`, including one fixed-node definition and no cluster-detail node arrays.
- `get_cluster_status` returned `altair1` lifecycle and capacity status with two node arrays and two total buckets, with no truncation.
- An intentionally invalid password returned the fixed `authentication_failed` error without server text or credential exposure. The valid local test credential was then restored outside the MCP conversation.
- A deliberately nonexistent cluster returned the fixed `cluster_not_found` error.
- Server stderr was empty during valid read calls.

These results demonstrate that the direct HTTP adapter matches the local CycleCloud endpoints and that the bounded normalization is useful for agent consumption.

## VS Code Agent Plugin observation

The repository path was temporarily added to `chat.pluginLocations` with `chat.plugins.enabled: true`. The already-running VS Code Insiders agent host did not reload its plugin cache automatically, and the remote CLI cannot issue the `agent` command or reload the active window. UI discovery through **MCP: List Servers** and **Configure Tools** therefore remains unobserved and requires a manual **Developer: Reload Window** in a future interactive check.

The temporary registration was removed during cleanup rather than leaving a plugin that would start without its deleted profile.

## GitHub source-install follow-up

The repository is now hosted privately at `https://github.com/gingi/cyclecloud-mcp`. The README documents the supported VS Code source-install path:

1. open a Linux/macOS/WSL VS Code window and verify Node on the agent host;
2. verify authenticated Git access to the private repository;
3. enable `chat.plugins.enabled`;
4. run **Chat: Install Plugin From Source** with the Git URL;
5. use **MCP: List Servers → cyclecloud → Show Output** to obtain the client-selected configuration path;
6. create a mode-`0600` profile outside the agent conversation with mutations disabled;
7. restart the server and verify the three read tools through **Configure Tools**.

The implementation now includes the bounded expected `cyclecloud.json` path in the first-start `configuration_missing` event. A subprocess regression test verifies that field while preserving the no-write plugin-root invariant. Git-source installation itself was not executed in this non-interactive follow-up; it remains the next manual VS Code UX check.

## Mutation decision

No live lifecycle action was attempted because both required safety prerequisites were unverified:

- the local test account's exact least-privileged role and group scope;
- a per-call VS Code confirmation showing the exact tool and arguments with auto-approval disabled.

This is a valid POC outcome. Automated tests cover accepted, definitive-rejection, ambiguous, cancellation, overlap, and follow-up behavior without changing a live cluster.

## Assessment

The POC demonstrates the core technical path successfully:

- portable Agent Plugins 1.0 packaging;
- a dependency-complete stdio MCP server;
- direct authenticated CycleCloud access;
- useful bounded structured outputs;
- read-only discovery by default;
- fixed safe errors and explicit mutation uncertainty.

The remaining evaluation item is user experience inside a reloaded VS Code window: tool discoverability, prompt quality, confirmation presentation, and whether the agent chooses appropriate read tools. Production investment should be considered only after that interactive assessment.

## Cleanup

- Restored `enableMutations: false` throughout; it was never enabled.
- Removed the temporary VS Code plugin registration.
- Permanently deleted the temporary plaintext `cyclecloud.json` and its plugin-data directory.
- Restored the local CycleCloud backend and mock IMDS to their prior stopped state.
- Did not rotate the pre-existing local `claude` test credential because no new credential was created and only read operations were performed.
