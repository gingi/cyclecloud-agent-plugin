# CycleCloud VS Code Agent Plugin Proof-of-Concept Design

**Date:** 2026-09-08
**Status:** Security-hardened Agent Plugins 1.0 revision

## Summary

Build an Agent Plugins 1.0 package that lets GitHub Copilot agent mode in VS Code inspect an Azure CycleCloud installation and, when explicitly enabled, perform bounded cluster lifecycle actions. The plugin bundles a local Model Context Protocol (MCP) server as its only component. The proof of concept (POC) lives in its own Git repository and plugin root at `~/src/cyclecloud-mcp` and may later be hosted in a private GitHub repository.

The repository is an agent plugin, not a VS Code extension and not merely a standalone MCP-server source tree. It follows the portable Agent Plugins 1.0 layout with root `plugin.json` and `mcp.json` files. VS Code is the primary demonstration client, while the task-oriented MCP server remains independent of VS Code APIs.

## Goals

1. Conform to the official Agent Plugins 1.0 package and MCP configuration schemas.
2. Install the repository as a local VS Code agent plugin and automatically start its bundled stdio MCP server when enabled.
3. Let the agent list clusters, inspect a cluster, and inspect supported cluster status data.
4. Let an operator explicitly enable tools that start and terminate a named cluster; otherwise register only read tools.
5. Preserve CycleCloud server-side authentication, authorization, and group scoping as the security boundary.
6. Return bounded, structured, model-friendly data and stable error categories.
7. Ensure the plugin itself never places credentials in package data, MCP inputs or results, stdout, diagnostics, or source control, while documenting that an agent or process with independent same-user filesystem access remains outside this guarantee.
8. Validate package conformance, MCP behavior, and a local live CycleCloud demonstration with automated tests.

## Non-goals

The first POC will not:

- provide an assistant inside the CycleCloud web UI;
- implement a VS Code `.vsix`, chat participant, tree view, or `languageModelTools` extension;
- bundle skills, custom agents, slash commands, rules, or hooks;
- support Entra authentication, managed identity, service principals, or browser login;
- provide encrypted credential storage or claim that `${PLUGIN_DATA}` is a secret manager;
- expose arbitrary HTTP requests or generate one tool per OpenAPI operation;
- shell out to the CycleCloud CLI;
- scale node arrays or start, stop, deallocate, remove, reimage, or restart individual nodes;
- diagnose scheduler behavior, estimate cost, or run autonomous remediation;
- provide a hosted HTTP MCP transport;
- publish to a plugin marketplace or npm, or create a remote repository;
- support native Windows in the first POC;
- claim that installation trust or MCP approval UI replaces CycleCloud RBAC or provides a durable audit trail.

## Context and key decisions

The initial design treated the repository as a standalone MCP server configured from a workspace. The official VS Code agent-plugin documentation defines an agent plugin as a package of customizations, with MCP as one possible component. The design therefore uses the portable Agent Plugins 1.0 format instead: a root manifest plus a root MCP declaration that starts the bundled server. A `.vsix` is neither required nor desired.

Agent Plugins 1.0 does not provide secret prompting or encrypted secret storage. It also forbids plugins from depending on unspecified ambient environment variables and defines configured MCP `env` values as visible package data. The POC therefore uses a replaceable credential-provider interface whose initial implementation reads a permission-checked credential file from the client-provided `${PLUGIN_DATA}` directory. This is persistent plaintext-at-rest storage with explicit limitations, not a secret manager; OS-backed providers remain a follow-up.

CycleCloud's shipped public OpenAPI specification covers node operations and cluster status but not cluster listing or cluster lifecycle actions. The official CycleCloud CLI uses additional, undocumented `/cloud/api/*` and `/cloud/actions/*` endpoints for those operations.

The POC will use a narrow typed adapter over the same CLI-backed endpoints. Those routes are treated as experimental implementation details. They must not leak into MCP tool contracts, so supported product APIs can replace them later without changing clients.

A direct TypeScript HTTP client was selected over two alternatives:

- Wrapping the CLI would require parsing human-oriented output because cluster commands do not provide structured JSON output.
- A Python server could reuse portions of existing authentication and generated clients, but cluster lifecycle calls would still need custom code and distribution would be less self-contained for the VS Code POC.

The package-conformance baseline, accessed on 2026-09-08, is:

- [VS Code Agent Plugins documentation](https://code.visualstudio.com/docs/agent-customization/agent-plugins)
- [Agent Plugins 1.0 manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Agent Plugins 1.0 MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)
- [Agent Plugins specification](https://agent-plugins.org/specification)

If later versions differ, this POC remains pinned to the declared 1.0 schema until an explicit design and version update.

## Architecture

```text
VS Code Agent Plugin Host
      |
      | discovers root plugin.json + mcp.json
      | starts/stops node ${PLUGIN_ROOT}/bin/cyclecloud-mcp.mjs
      v
Bundled stdio MCP server
      |
      v
MCP adapter -> task-oriented capabilities -> CycleCloudClient -> CycleCloud HTTP APIs
                                                                |-- supported /clusters/.../status
                                                                `-- experimental /cloud/api/* and /cloud/actions/*

FileCredentialProvider --implements--> CredentialProvider
CycleCloudClient --------depends on--> CredentialProvider
```

### Agent Plugins 1.0 package contract

The repository root is the plugin root. Its manifest is exactly:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "cyclecloud-mcp",
  "version": "0.1.0",
  "description": "Inspect Azure CycleCloud with optional bounded lifecycle actions.",
  "keywords": ["azure-cyclecloud", "hpc", "mcp"]
}
```

The name satisfies the Agent Plugins 1.0 lowercase naming grammar. Author, homepage, repository, and license are omitted until the user chooses their final private repository metadata and licensing. No unknown top-level manifest properties are allowed.

The root MCP declaration is exactly:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "cyclecloud": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/bin/cyclecloud-mcp.mjs"]
    }
  }
}
```

The bare `node` command is one executable token, not a shell command. Agent Plugins 1.0 permits bare commands to use the platform's default executable search; the plugin does not configure or depend on a configured `PATH`. `${PLUGIN_ROOT}` is used only in `args`, where one-pass placeholder expansion is supported. `env` and `cwd` are deliberately omitted, and omitted `cwd` means the plugin root. The plugin never places credentials in `mcp.json` and does not depend on ambient CycleCloud environment variables.

VS Code supplies absolute resolved `PLUGIN_ROOT` and `PLUGIN_DATA` environment variables and creates the writable plugin-data directory before launch. The implementation never intentionally writes under `PLUGIN_ROOT`; it uses `PLUGIN_DATA` only for persistent local configuration and never overrides either variable. Agent Plugins 1.0 does not guarantee that the plugin-root filesystem is mounted read-only.

Plugin-root integrity is delegated to installation trust, source review, and local filesystem administration. Because Node loads the declared module before that module can perform a self-check, an in-process ownership or hash check cannot protect startup from a module modified by the same user. Git and package tests verify the committed artifact, but the POC does not claim runtime self-integrity.

The MCP server starts automatically when the plugin is enabled and stops when disabled. Under the portable failure-isolation rule, a startup, connection, authentication, or handshake failure leaves this server unavailable for that failed attempt but must not prevent other valid servers or component types from loading. Agent Plugins 1.0 does not define portable retry, restart, or persistent-disabled-state behavior for such a runtime failure. This POC has no independent components, and it makes no portable claim about how VS Code presents the failure.

### Process and compatibility

The repository is both one Agent Plugins 1.0 package and one Node 20+ development package. TypeScript is bundled with all runtime dependencies into the single committed module `bin/cyclecloud-mcp.mjs`, committed with non-executable Git mode `100644`. It has no shebang and is loaded by the `node` command declared in `mcp.json`. Direct plugin installation does not run `npm install` or build source; the committed artifact is reproducibly generated from source.

Agent Plugins package conformance is independent of runtime-platform compatibility. Tested runtime support is Linux, macOS, and WSL where Node 20 or newer is discoverable through the platform's default executable search. The plugin depends on that declared runtime prerequisite but on no ambient CycleCloud configuration variables. Native Windows is intentionally unsupported by the POC until tested, and the package format does not itself guarantee runtime availability. The README and manifest-adjacent documentation must state this compatibility boundary.

The implementation uses:

- strict TypeScript and ECMAScript modules;
- the official TypeScript MCP SDK;
- Zod for tool input and runtime wire validation;
- Undici for HTTP and per-client TLS configuration;
- esbuild for the committed single-file server module;
- Vitest for automated tests;
- ESLint and Prettier for static checks and formatting.

Stdout is reserved exclusively for MCP protocol messages. Optional diagnostics use stderr.

### Module and package boundaries

```text
plugin.json                 Agent Plugins 1.0 manifest
mcp.json                    Portable stdio MCP declaration
bin/
  cyclecloud-mcp.mjs        Dependency bundle, non-executable Git mode 100644
src/
  index.ts                  Composition root and stdio startup
  config.ts                 PLUGIN_DATA runtime configuration validation
  credentials/
    provider.ts              CredentialProvider interface
    file-provider.ts         Permission-checked POC credential provider
  cyclecloud/
    client.ts               CycleCloudClient interface and HTTP implementation
    errors.ts               Stable client and capability errors
    normalize.ts            Wire-to-domain normalization
    types.ts                Narrow wire schemas and stable domain types
  capabilities/
    list-clusters.ts
    get-cluster.ts
    get-cluster-status.ts
    start-cluster.ts
    terminate-cluster.ts
  mcp/
    register-tools.ts        Tool declarations and dependency injection
    result.ts                Domain result to MCP result mapping
    schemas.ts               Tool input and output schemas
tests/
  fixtures/                 Vendored canonical schemas and CycleCloud responses
  unit/
  integration/
```

No `skills/` or `com.github.copilot/` directory is created because the POC declares no skills or Copilot-specific components. Each capability depends on the `CycleCloudClient` interface rather than the HTTP implementation. Unit tests use a fake implementation; HTTP integration tests use an in-process fake CycleCloud server.

## Configuration and authentication

### Plugin-data configuration file

At startup, the MCP process reads exactly `${PLUGIN_DATA}/cyclecloud.json`. It does not read `~/.cycle/config.ini`, package-root files, workspace settings, `mcp.json` secrets, or ambient `CYCLECLOUD_*` variables.

The file is a closed JSON object with this contract:

| Property | Required | Default | Valid range or meaning |
|---|---:|---|---|
| `url` | yes | none | Absolute CycleCloud root URL |
| `username` | yes | none | 1–256 printable US-ASCII characters, excluding `:` |
| `password` | yes | none | 1–4096 printable US-ASCII characters |
| `verifyTls` | no | `true` | Boolean; explicit `false` is accepted only for a loopback HTTPS URL |
| `caCertPath` | no | Node bundled roots | Absolute path to additional PEM CA certificates used with TLS verification enabled |
| `allowInsecureHttp` | no | `false` | Boolean; permits plain HTTP to a non-loopback host |
| `enableMutations` | no | `false` | Boolean; registers `start_cluster` and `terminate_cluster` only when true |
| `requestTimeoutMs` | no | `30000` | Per-read timeout from 1000 through 60000 milliseconds |
| `actionTimeoutMs` | no | `60000` | Lifecycle POST timeout from 35000 through 300000 milliseconds |
| `debug` | no | `false` | Boolean; emits redacted diagnostics to stderr |

Unknown properties are rejected. The server requires `PLUGIN_ROOT` and `PLUGIN_DATA` to be absolute existing directories and resolves both to their real paths. It rejects equal roots, `PLUGIN_DATA` nested under `PLUGIN_ROOT`, and `PLUGIN_ROOT` nested under `PLUGIN_DATA`. It then derives the fixed credential path with a containment-checked join under the resolved data root. This makes the repository-separation invariant an implementation check rather than an assumption about the portable standard.

After root resolution and overlap rejection, but before enforcing reported ownership or writable bits or opening live configuration, the server probes filesystem semantics. It exclusively creates a randomly named empty file under the data root, applies mode `0600` with `fchmod`, verifies through the descriptor that the effective owner and exact permission bits are reported, and removes the probe in `finally`. Creation, chmod, owner, mode, or cleanup failure emits `plugin_data_unsupported_filesystem` with the corresponding fixed reason and exits before reading credentials. Running the probe before permission enforcement lets metadata-less filesystems produce this specific diagnostic rather than merely appearing world-writable; it detects cases such as WSL DrvFs mounted without metadata. Under WSL, `${PLUGIN_DATA}` must resolve to the Linux filesystem. Native Windows is outside the POC because these checks are part of its credential threat model.

After a successful probe, the resolved `PLUGIN_DATA` directory must be owned by the process's effective user and must not be group- or world-writable. Each ancestor through the filesystem root must be owned by either the effective user or root and must not be group- or world-writable, except that a root-owned sticky directory such as `/tmp` may be writable. The server opens the credential file without following symlinks and verifies through the open descriptor that it is a regular file owned by the effective user with mode exactly `0600` or `0400`. Generated files use `0600`; `0400` supports an owner-readable immutable-at-runtime configuration. Ownership mismatches, unsafe path components, symlinks, and every other permission mode—including any execute, group, or other bit—are rejected.

If `caCertPath` is present, it must be a non-empty absolute string; a missing value is valid, while a present value of any other type or an empty string emits `configuration_invalid` with `invalid_ca_path`, and a non-absolute string emits `ca_file_invalid` with `path_not_absolute`. The server resolves its parent directory, applies the same effective-user-or-root ownership, non-writable ancestor, and root-owned-sticky exception rules used for `PLUGIN_DATA`, then opens the final filename without following symlinks. The sticky exception applies only to a root-owned ancestor such as `/tmp`; its sticky bit prevents unrelated users from renaming the checked descendant, and every descendant directory and the final file must still satisfy the ownership and write-permission rules. Through the descriptor it verifies that the CA is a regular file owned by either the effective user or root and not group- or world-writable, limits it to 1 MiB, and parses one or more PEM certificates. Because Node's `ca` option replaces rather than extends its defaults, this CycleCloud client's TLS dispatcher receives an explicit `ca` array containing `node:tls` `rootCertificates` followed by the configured PEM certificates, with `rejectUnauthorized: true`. This extends Node's bundled roots only for this client. A CA file is not secret but is security-critical for integrity; an unsafe ancestor, invalid path, unreadable or symlinked file, improper owner or permissions, oversized content, or malformed PEM fails startup. Ambient `NODE_EXTRA_CA_CERTS` is intentionally not copied into this explicit client trust array; operators must use `caCertPath` so trust is visible in the permission-checked configuration.

If the credential file is absent, the server creates `${PLUGIN_DATA}/cyclecloud.example.json` with an exclusive create and mode `0600` if the example does not already exist. Existing examples are never overwritten. Its exact content is:

```json
{
  "url": "https://cyclecloud.example.com",
  "username": "cyclecloud-poc",
  "password": "",
  "verifyTls": true,
  "allowInsecureHttp": false,
  "enableMutations": false,
  "requestTimeoutMs": 30000,
  "actionTimeoutMs": 60000,
  "debug": false
}
```

The empty password makes the example invalid as live configuration and is not a credential. `caCertPath` is deliberately omitted because it has no valid default; the README documents it for self-signed remote installations. When live configuration is absent, startup attempts the exclusive example creation, then emits one bounded `configuration_missing` diagnostic containing the expected path and an `exampleStatus` of `created`, `already_exists`, or `creation_failed`, and exits nonzero. Example-creation errors are caught and never become unhandled rejections. The operator copies or renames the example, supplies values outside the agent conversation, preserves safe ownership and permissions, and restarts the server by disabling and re-enabling the plugin.

`${PLUGIN_DATA}` provides a stable writable location, not encrypted storage. `cyclecloud.json` contains a reusable plaintext password. The README must explain this limitation; require a dedicated POC account that is not reused from the CLI and is restricted to the smallest available role and group scope needed for the demonstration; explain rotation and permanent deletion during uninstall; and warn that disabling or unregistering the plugin stops its process but does not delete persistent plugin data. The file is not part of the repository or package, and `.gitignore` excludes the fixed filename as defense in depth against an accidental copy.

The startup loader reads the permission-checked document once, separates nonsecret runtime settings from credential material, and constructs the POC `FileCredentialProvider`. `CycleCloudClient` receives only the `CredentialProvider` interface and obtains credentials when constructing the Basic authorization value; capability and MCP layers never receive them. This seam allows a later OS-backed provider and nonsecret profile file without changing tool or client contracts.

### Security baseline and residual risk

The file controls are deliberately stronger than the current CycleCloud CLI baseline reviewed on 2026-09-08: the CLI's stored `key` is reversibly obfuscated with a key shipped in its source and its config writer does not enforce permission, ownership, or no-symlink checks. This comparison justifies the POC storage choice but is not a claim that an agent plugin is categorically safer than every CLI workflow or future CLI version.

The POC threat model explicitly accepts and documents these residual risks:

- Any process running as the same OS user—including another VS Code extension—or an agent with independent filesystem or terminal tools can read or modify the file despite mode `0600`, including changing `enableMutations` and user-writable client settings. Conditional registration constrains the model within the current MCP server session; it is not a boundary against same-user code. The plugin guarantees only that it does not itself place credentials in model inputs or outputs and cannot confine other agent tools.
- A compromised bundled dependency or modified plugin module executes in the credential-holding process. Plugin-root integrity is delegated to installation trust because the module cannot validate itself before execution. Source review, a pinned dependency graph, reproducible bundling, and local/CI checks reduce but do not eliminate this supply-chain risk.
- The password and Basic authorization value reside in Node memory and cannot be reliably zeroed as JavaScript strings. Core dumps, debuggers, or a compromised process can recover them.
- The resolved `${PLUGIN_DATA}` location may fall within a backup, profile-export, or synchronization scope. Setup and the live report must identify the concrete path; before credentials are supplied, the operator records an attestation that the path is excluded from every backup, synchronization, and profile-export scope known to them.
- The filesystem probe validates reported POSIX metadata, not where bytes are physically stored. A network or userspace filesystem can pass the probe while exposing data elsewhere, so credential setup requires the operator to attest that `${PLUGIN_DATA}` is on a local filesystem; network, shared, and userspace-mounted locations are unsupported.
- Basic authentication is a reusable long-lived secret. File hardening does not provide the security properties of short-lived tokens or managed identity.
- CycleCloud-controlled names and status fields are untrusted model context and may contain instruction-like text. The model must treat them only as data; more importantly, mutation tools are absent unless the operator explicitly enables them.

OS-backed credential storage and Entra or managed-identity authentication remain future work. The file provider is an explicit POC compromise, not the target production credential architecture.

### Credential and transport validation

`url` must use HTTP or HTTPS. It must not contain URL user-info, a query, a fragment, or a non-root path; an empty path and `/` are equivalent. This POC does not support reverse-proxy path prefixes. For transport overrides, loopback means an IP-literal host in `127.0.0.0/8` or exactly `::1`; `localhost` is not trusted as loopback because name resolution can be changed. The complete transport-option matrix is:

| URL | `verifyTls` | `caCertPath` | `allowInsecureHttp` | Result |
|---|---|---|---|---|
| HTTP loopback | omitted or `true` | absent | `false` | Valid; emit insecure-transport warning |
| HTTP non-loopback | omitted or `true` | absent | `true` | Valid explicit override; emit insecure-transport warning |
| HTTPS loopback or remote | omitted or `true` | absent or valid path | `false` | Valid; verify certificate chain and hostname |
| HTTPS loopback | explicit `false` | absent | `false` | Valid explicit override; emit TLS-verification warning |
| Any other combination | any | any | any | Invalid startup configuration |

Thus `caCertPath` is valid only for HTTPS with verification enabled; disabled verification is valid only for loopback HTTPS; and meaningless or conflicting insecure flags fail closed.

Basic authentication is reversible encoding, not encryption. The adapter encodes the validated `username:password` string as US-ASCII bytes and Base64-encodes those bytes, matching CycleCloud's server-side US-ASCII decoder. A colon is forbidden in the username because the first colon separates username from password; colons remain valid in the password. Non-ASCII and control characters are rejected rather than encoded inconsistently.

Any HTTP connection, including loopback HTTP, transmits reusable credentials without TLS protection. The README must explain that trade-off. HTTPS with certificate verification remains the secure default for remote installations.

TLS verification is enabled by default. For a self-signed remote installation, `caCertPath` explicitly combines Node's bundled `rootCertificates` with the additional PEM certificates while retaining chain and hostname verification. The server certificate must contain a subject alternative name matching the configured host; trusting a SAN-less or mismatched certificate as a CA does not bypass identity validation. TLS chain or identity failures map to the fixed `tls_error` tool error. The loopback-only verification override is scoped to this CycleCloud HTTP client; the server must not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or otherwise alter global Node behavior.

The client constructs the Basic `Authorization` header internally. Credentials are never accepted as MCP tool arguments and never included in domain objects.

Invalid plugin environment, file permissions, JSON, or configuration writes one redacted valid-JSON line of at most 2048 characters to stderr, exits nonzero, emits nothing to stdout, and never registers tools. Startup configuration failures are not tool errors. The POC's complete diagnostic event vocabulary is:

| Event | Purpose | Allowed variable fields | Gated by `debug` |
|---|---|---|---:|
| `plugin_environment_invalid` | Missing, non-absolute, unavailable, non-directory, overlapping, or unsafe plugin/data root | fixed `reason`, sanitized `path` when useful | no |
| `plugin_data_unsupported_filesystem` | POSIX ownership/mode probe failed | fixed `reason`, sanitized `path` | no |
| `configuration_missing` | Live configuration absent | sanitized `path`, fixed `exampleStatus` | no |
| `configuration_invalid` | JSON shape, value, or credential grammar invalid | fixed `reason` | no |
| `credential_file_insecure` | Credential file ownership, type, link, or mode invalid | fixed `reason`, sanitized `path` | no |
| `ca_file_invalid` | CA path, ancestor, ownership, type, mode, size, or PEM invalid | fixed `reason`, sanitized `path` | no |
| `transport_configuration_invalid` | A transport-option matrix rule failed | fixed `reason` | no |
| `insecure_transport_enabled` | Valid HTTP override warning | none | no |
| `tls_verification_disabled` | Valid loopback TLS override warning | none | no |
| `mutations_enabled` | Mutation tools registered for this server start | none | no |
| `request_completed` | Debug request outcome | fixed `capability`, numeric `durationMs`, fixed `outcome` | yes |
| `request_failed` | Debug failure outcome | fixed `capability`, fixed `category` | yes |
| `diagnostic_truncated` | Serialized event exceeded the diagnostic bound | fixed `sourceEvent`, `truncated: true` | same as source event |

All diagnostic enum fields are closed. An unset or empty injected variable maps to its `missing_*` reason; an absolute path that does not exist maps to its `*_not_found` reason; an existing resolved non-directory maps to its `*_not_directory` reason; and any other real-path failure maps to `root_resolution_failed` with the sanitized input path. Equal resolved roots map to `roots_equal`; nesting reasons are directional.

| Event and field | Allowed values |
|---|---|
| `plugin_environment_invalid.reason` | `missing_plugin_root`, `missing_plugin_data`, `non_absolute_plugin_root`, `non_absolute_plugin_data`, `plugin_root_not_found`, `plugin_data_not_found`, `plugin_root_not_directory`, `plugin_data_not_directory`, `root_resolution_failed`, `roots_equal`, `data_inside_plugin_root`, `plugin_inside_data_root`, `unsafe_data_ancestor`, `data_root_not_owned`, `data_root_writable` |
| `plugin_data_unsupported_filesystem.reason` | `probe_create_failed`, `probe_chmod_failed`, `owner_mismatch`, `permission_mismatch`, `probe_cleanup_failed` |
| `configuration_missing.exampleStatus` | `created`, `already_exists`, `creation_failed` |
| `configuration_invalid.reason` | `invalid_json`, `unknown_property`, `invalid_url`, `invalid_username`, `invalid_password`, `invalid_boolean`, `invalid_timeout`, `invalid_ca_path` |
| `credential_file_insecure.reason` | `open_failed`, `symlink`, `not_regular`, `wrong_owner`, `unsafe_permissions` |
| `ca_file_invalid.reason` | `path_not_absolute`, `unsafe_ancestor`, `open_failed`, `symlink`, `not_regular`, `wrong_owner`, `unsafe_permissions`, `too_large`, `invalid_pem` |
| `transport_configuration_invalid.reason` | `invalid_option_combination` |
| Request `capability` | `list_clusters`, `get_cluster`, `get_cluster_status`, `start_cluster`, `terminate_cluster` |
| `request_completed.outcome` | `success`, `accepted`, `unknown` |
| `request_failed.category` | Any `ToolError` category declared below |
| `diagnostic_truncated.sourceEvent` | Any event above except `diagnostic_truncated` |

Diagnostics are constructed from per-event allowlists. They never include caught exception messages or stacks, HTTP bodies or headers, configuration objects, credentials, cluster names, server-controlled strings, or request URLs. Variable paths still pass through the credential-redaction pipeline before serialization.

## HTTP boundary

The model cannot supply a host, route, HTTP method, query key, header, or raw request body. Tool input selects only documented capability arguments. The input schema trims cluster names, then requires 1–256 Unicode scalar values, well-formed UTF-16 with no unpaired surrogate, no C0/C1 control character (`U+0000`–`U+001F` or `U+007F`–`U+009F`), and a value other than `.` or `..`. Invalid names fail MCP input validation before capability execution or HTTP dispatch.

URLs are constructed only from fixed endpoint templates, and the validated cluster name is passed through `encodeURIComponent` as one path segment. The well-formed-Unicode precondition prevents synchronous encoder failure; rejecting dot-segment names prevents WHATWG URL normalization from changing the fixed route.

The initial HTTP calls are:

| Capability | Method and endpoint | Client timeout | Stability |
|---|---|---:|---|
| List clusters | `GET /cloud/api/clusters?summary=true&cloud_instances=true` | read timeout | CLI-backed, undocumented |
| Get cluster | `GET /cloud/api/clusters/{clusterName}?summary=true&cloud_instances=true` | read timeout | CLI-backed, undocumented |
| Get cluster status | `GET /clusters/{clusterName}/status?nodes=false` | read timeout | Public OpenAPI |
| Start cluster | `POST /cloud/actions/startcluster/{clusterName}?wait_time=30&recursive={bool}&test_mode=false` | action timeout | CLI-backed, undocumented |
| Terminate cluster | `POST /cloud/actions/terminatecluster/{clusterName}?wait_time=30&recursive={bool}` | action timeout | CLI-backed, undocumented |

List results exclude templates by omitting the `templates=true` query parameter. `/cloud/api/clusters` is the sole list endpoint for this POC; there is no per-call or automatic fallback to `/cloud/clusters`.

List and named-cluster retrieval responses are JSON arrays. A named request that returns zero records maps to `cluster_not_found`; more than one record maps to `invalid_response`. The sole named record's normalized `ClusterName` must equal the validated, trimmed request name using exact JavaScript string equality; a mismatch maps to `invalid_response`. Lifecycle action success is any HTTP 2xx response. Action response bodies are not parsed and are cancelled without buffering.

Every HTTP request uses `redirect: "manual"`; credentials are never forwarded to a redirect target. A 3xx read response maps to `unexpected_redirect`. A 3xx mutation response is treated as an uncertain post-dispatch outcome.

The read timeout applies independently to each list, detail, status, or post-action status request. The action timeout applies only to the lifecycle POST and leaves at least five seconds of headroom over `wait_time=30`. A mutation capability can therefore run for at most the action timeout plus one read timeout. Every timer and abort listener is removed in `finally`.

The client ignores unknown object properties and validates only the narrow fields used by normalized results. It does not recursively validate ignored data.

No HTTP call is automatically retried in the POC. MCP cancellation propagates to the active request, subject to the mutation uncertainty state machine below.

## Tool contracts

Tool results use structured JSON with concise accompanying text. Output contracts contain no raw CycleCloud records. The three read tools are always registered after successful startup. The two mutation tools are registered only when startup configuration has `enableMutations: true`; with the default false value they are absent from MCP discovery and cannot be called through this server. A true value also emits the unconditional `mutations_enabled` warning. A changed setting takes effect on the next server start; the documented operator workflow deliberately disables and re-enables the plugin rather than relying on unspecified crash-restart or reload behavior.

### `list_clusters`

Lists non-template clusters.

Input:

```ts
{
  limit?: number; // integer, default 50, minimum 1, maximum 200
}
```

Output:

```ts
{
  clusters: Array<{
    name: string;
    state?: string;
    targetState?: string;
    fixedNodeDefinitions: number;
    nodeArrayCount: number;
    arrayNodeCount: number;
    configuredNodeCount: number;
  }>;
  total: number;
  returned: number;
  truncated: boolean;
}
```

Wire mappings are case-insensitive: `ClusterName` to `name`, `State` to `state`, and `TargetState` to `targetState`. `fixedNodeDefinitions` is the length of `Nodes`; `nodeArrayCount` is the length of `NodeArrays`; `arrayNodeCount` is the checked sum of `NodeArrays[].Count`; and `configuredNodeCount` is the checked sum of the fixed definition count and array count. Every count must be a finite non-negative safe integer. Missing `Nodes` or `NodeArrays` fields are treated as empty arrays. An invalid value or aggregate overflow maps the response to `invalid_response` rather than being rounded or guessed.

Results are sorted case-insensitively by cluster name before applying the limit. `ClusterName` is required and bounded to 256 characters. Optional lifecycle strings are omitted when absent and bounded to 128 characters when present.

MCP hints identify this as read-only and non-destructive.

### `get_cluster`

Gets a bounded normalized cluster summary from the CLI-backed endpoint. `Nodes` represents fixed node definitions, while `NodeArrays[].Count` represents aggregate array nodes; the contract keeps those concepts separate.

Input:

```ts
{
  clusterName: string;          // non-empty after trimming, maximum 256 characters
  fixedNodeLimit?: number;      // integer, default 50, minimum 0, maximum 200
  nodeArrayLimit?: number;      // integer, default 50, minimum 0, maximum 100
}
```

Output:

```ts
{
  cluster: {
    name: string;
    state?: string;
    targetState?: string;
    nodeArrays: Array<{
      template: string;
      state?: string;
      targetState?: string;
      count: number;
      coreCount?: number;
    }>;
    nodeArrayTotal: number;
    nodeArrayReturned: number;
    nodeArraysTruncated: boolean;
    fixedNodes: Array<{
      id?: string;
      name: string;
      template?: string;
      state?: string;
      targetState?: string;
    }>;
    fixedNodeDefinitionsTotal: number;
    fixedNodeDefinitionsReturned: number;
    fixedNodeDefinitionsTruncated: boolean;
    arrayNodeCount: number;
    configuredNodeCount: number;
  };
}
```

Wire mappings are case-insensitive. Cluster fields map from `ClusterName`, `State`, and `TargetState`. Fixed node fields map from `NodeId`, `Name`, `Template`, `State`, and `TargetState`. Node-array fields map from `Template`, `State`, `TargetState`, `Count`, and `CoreCount`. Cluster name, fixed node name, and node-array template are required in their respective records. Every count and core count must be a finite non-negative safe integer; `CoreCount` is omitted when absent. Identity strings are bounded to 256 characters and lifecycle strings to 128 characters.

Fixed nodes and node arrays are sorted case-insensitively by name/template before their independent limits are applied. `arrayNodeCount` is the checked sum of all node-array `Count` values before truncation. `configuredNodeCount` is the checked sum of `fixedNodeDefinitionsTotal` and `arrayNodeCount`. Any aggregate outside JavaScript's safe-integer range maps to `invalid_response`.

Representative CycleCloud fixtures must prove these mappings, but fixture collection cannot change this public contract without a design revision.

MCP hints identify this as read-only and non-destructive.

### `get_cluster_status`

Uses the supported API to return lifecycle and capacity status. It intentionally sends `nodes=false` to avoid an unbounded node list and does not expose the raw `nodearray` record.

Input:

```ts
{
  clusterName: string;      // non-empty after trimming, maximum 256 characters
  nodeArrayLimit?: number;  // integer, default 20, minimum 0, maximum 50
  bucketLimit?: number;     // per returned node array; default 20, minimum 0, maximum 50
}
```

Output:

```ts
{
  status: {
    clusterName: string;
    state?: string;
    targetState?: string;
    maxCount: number;
    maxCoreCount: number;
    nodeArrays: Array<{
      name: string;
      maxCount: number;
      maxCoreCount: number;
      buckets: Array<{
        bucketId: string;
        machineType?: string;
        valid: boolean;
        invalidReason?: string;
        maxCount: number;
        maxCoreCount: number;
        quotaCount: number;
        quotaCoreCount: number;
        consumedCoreCount: number;
        activeCount: number;
        activeCoreCount: number;
        availableCount: number;
        availableCoreCount: number;
        lastCapacityFailure?: number;
        spotPlacementScore?: string;
      }>;
      bucketTotal: number;
      bucketReturned: number;
      bucketsTruncated: boolean;
    }>;
    nodeArrayTotal: number;
    nodeArrayReturned: number;
    nodeArraysTruncated: boolean;
    bucketTotal: number;
    bucketReturned: number;
    bucketsTruncated: boolean;
  };
}
```

`status.clusterName` is the validated, trimmed input because the public status response has no cluster-name field. All required numeric values must be finite safe integers except `lastCapacityFailure`, which may be any finite number. `machineType` maps only from `definition.machineType`; no other definition or raw node-array fields are exposed. Identity and reason strings are bounded to 256 characters, lifecycle strings to 128 characters.

Node arrays are sorted case-insensitively by `name`, then limited. Within each returned node array, buckets are sorted by `bucketId`. The server visits returned node arrays in that sorted order and gives each one up to `bucketLimit` entries from the remaining global budget of 500; later arrays can therefore receive fewer or zero buckets after the budget is exhausted. Per-array `bucketReturned` is computed after both limits. Top-level bucket totals cover all node arrays before truncation. Per-node-array totals describe each returned array before bucket truncation. Every limit reports returned counts and truncation explicitly.

MCP annotations for this and every read tool are exactly:

```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}
```

`openWorldHint` is true because the tool reads an external CycleCloud installation.

### `start_cluster`

Starts one named cluster.

Input:

```ts
{
  clusterName: string;      // non-empty after trimming, maximum 256 characters
  recursive?: boolean;      // default false
}
```

The request uses `wait_time=30`, `test_mode=false`, and the independent action timeout. Test mode is deliberately not exposed.

### `terminate_cluster`

Terminates one named cluster.

Input:

```ts
{
  clusterName: string;      // non-empty after trimming, maximum 256 characters
  recursive?: boolean;      // default false
}
```

The request uses `wait_time=30` and the independent action timeout.

### Mutation result and state machine

Both mutation tools return:

```ts
{
  action: "start" | "terminate";
  clusterName: string;
  recursive: boolean;
  outcome: "accepted" | "unknown";
  observedStatus?: {
    state?: string;
    targetState?: string;
  };
  warning?: string; // maximum 512 characters
}
```

The mutation result's `clusterName` is always the validated, trimmed tool input; action response bodies cannot override it.

MCP annotations for both mutation tools are exactly:

```ts
{
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
}
```

`openWorldHint` is true because the tools change an external CycleCloud installation.

The default `enableMutations: false` setting is a coarse-grained boundary enforced by this server against calls through the current MCP session: the server does not register either mutation tool. It is not a boundary against code running as the same OS user. Enabling mutations is an explicit operator decision made in the permission-checked local file outside the agent conversation; it does not authorize any particular call.

When registered, tool descriptions tell the agent to call a read tool and present the exact target and recursive behavior before invoking a mutation. That instruction and MCP hints are advisory only: the server cannot enforce a prior read or prove human approval.

Agent Plugins 1.0 and the VS Code agent-plugin documentation do not guarantee per-tool approval UI. The live report records the exact VS Code build and profile. If that tested host provides per-invocation confirmation, mutation auto-approval is disabled and VS Code must visibly show the exact tool name, `clusterName`, and `recursive` value for user approval immediately before dispatch. Only then may the operator set `enableMutations: true`, restart the plugin, and perform each live mutation. If the host does not prompt, `enableMutations` remains false and live mutation is unsupported for that host; automated MCP/HTTP tests use explicit mutation-enabled configuration to validate behavior. Host-specific confirmation is a POC safety policy, not an Agent Plugins conformance requirement, and it does not replace CycleCloud RBAC or provide durable auditing.

The mutation dispatch point is the call that hands the request to Undici, after an immediate pre-dispatch cancellation check. The state machine is:

- Cancellation observed before dispatch returns the `cancelled` tool error and performs no HTTP call.
- Mutation-mutex rejection or global-queue overflow returns the `busy` tool error before dispatch and performs no HTTP call.
- HTTP 2xx means `outcome: "accepted"`; the action body is ignored and cancelled without buffering.
- HTTP 401, 403, or 404 is treated as a definitive pre-action rejection and returns the corresponding categorized tool error.
- Every other HTTP 3xx, 4xx, or 5xx after dispatch—including 408, 409, 425, and 429—returns `outcome: "unknown"` with an inspect-before-retrying warning because a recursive action could have partially progressed.
- A recognized DNS/TCP connection-establishment or TLS certificate-validation failure proves that no HTTP action request was transmitted and returns the corresponding categorized `network_error`, `timeout`, or `tls_error`.
- Any unrecognized timeout, network failure, or cancellation at or after dispatch returns `outcome: "unknown"` with the inspect-before-retrying warning.
- An unknown outcome is never followed by another automatic request.

After a 2xx action response, the capability performs exactly one best-effort status read using the independent read timeout. Success includes the observed state. Failure, timeout, or cancellation during this follow-up preserves `outcome: "accepted"` and adds a warning. The server never retries the lifecycle POST or follow-up read.

## Error model

Tool-input schema violations are standard MCP invalid-params failures produced before a capability or HTTP call runs. Operational tool failures use this exact structured payload:

```ts
type ToolError = {
  error: {
    category:
      | "authentication_failed"
      | "permission_denied"
      | "cluster_not_found"
      | "cyclecloud_rejected_request"
      | "cyclecloud_unavailable"
      | "unexpected_redirect"
      | "tls_error"
      | "busy"
      | "timeout"
      | "network_error"
      | "cancelled"
      | "invalid_response";
    message: string;   // exact fixed category message, maximum 512 characters
    retryable: boolean;
  };
};
```

The MCP result sets `isError: true`, puts this object in `structuredContent`, and includes one text content item containing the same safe message. Each tool output schema is the union of its success payload and `ToolError`. The mapping is:

- 401: `authentication_failed`, not retryable without changed credentials;
- 403: `permission_denied`, not retryable without changed authorization;
- 404 or an empty named-cluster response: `cluster_not_found`, not retryable without a changed target;
- read 408, 425, or 429: `cyclecloud_rejected_request`, `retryable: true` for an explicit user retry;
- other definitive read 4xx responses: `cyclecloud_rejected_request`, `retryable: false`;
- read 5xx: `cyclecloud_unavailable`, retryable by the user;
- read 3xx: `unexpected_redirect`, not retryable without configuration changes;
- TLS chain or hostname validation failure: `tls_error`, not retryable without server or trust configuration changes;
- a full local call queue or another active mutation: `busy`, retryable by an explicit later call and never retried automatically;
- read timeout or other network failure: `timeout` or `network_error`, retryable by the user;
- read cancellation or mutation cancellation before dispatch: `cancelled`, not retryable automatically;
- malformed, oversized, or contract-invalid success data: `invalid_response`, not automatically retryable.

The adapter follows at most four object-valued `cause` links, stops on a repeated object, and recognizes only these closed error-code sets:

| Class | Recognized `code` values |
|---|---|
| TLS certificate validation | `CERT_HAS_EXPIRED`, `CERT_NOT_YET_VALID`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_GET_ISSUER_CERT`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ERR_TLS_CERT_ALTNAME_INVALID` |
| DNS/TCP establishment | `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` |
| Connection establishment timeout | `UND_ERR_CONNECT_TIMEOUT` |

For reads, a recognized TLS code maps to `tls_error`, the DNS/TCP codes map to `network_error`, and the connection-timeout code maps to `timeout`. The same recognized codes are definitive pre-transmission failures for mutations. Any other caught code or error shape falls back to the ordinary read `network_error` or the mutation uncertainty rule; exception messages are never exposed or used for classification.

Each category has one exact, non-interpolated message:

| Category | Message |
|---|---|
| `authentication_failed` | `CycleCloud authentication failed. Update the configured credentials and try again.` |
| `permission_denied` | `CycleCloud denied this operation.` |
| `cluster_not_found` | `CycleCloud did not return the requested cluster.` |
| `cyclecloud_rejected_request` | `CycleCloud rejected the request.` |
| `cyclecloud_unavailable` | `CycleCloud is unavailable.` |
| `unexpected_redirect` | `CycleCloud returned an unexpected redirect. Check the configured URL.` |
| `tls_error` | `CycleCloud TLS certificate validation failed. Check the configured host and trust settings.` |
| `busy` | `The CycleCloud plugin is busy. Try the request again later.` |
| `timeout` | `The CycleCloud request timed out.` |
| `network_error` | `The CycleCloud request failed because of a network error.` |
| `cancelled` | `The CycleCloud request was cancelled.` |
| `invalid_response` | `CycleCloud returned a response the plugin could not safely use.` |

Tool arguments already retain the target context, so messages never interpolate cluster names, URLs, server text, exception text, or other variable values. Tests assert these exact strings.

Ambiguous mutation failures use the successful mutation payload with `outcome: "unknown"`; they never use a retryable tool error.

Raw HTML, response-body excerpts, stack traces, authorization headers, credentials, and URL user-info are never returned to the model. Non-2xx HTTP response bodies are neither parsed nor logged; they are cancelled without buffering. HTTP status and local request state select a fixed, locally generated safe message, so CycleCloud-controlled error text cannot become model instructions.

Any variable local value that can reach a diagnostic goes through this ordered sanitization pipeline:

1. Remove every C0/C1 control character, then trim the result. Removal deliberately reassembles any credential split by controls before matching.
2. Replace every occurrence of the complete `Basic …` header, its Base64 token, `username:password`, raw password, or raw username with the fixed marker `[REDACTED]`. Match known forms longest-first and repeat until none remain.
3. If the result exceeds 512 Unicode scalar values, cut it so an appended `…` remains within the limit.
4. Run the same credential-form replacement again after truncation before exposure.

Control removal happens before redaction, so split-token input reassembles and is replaced rather than remaining visible in an obfuscated form. Debug logging uses the same field-sanitization pipeline and never logs response bodies.

## Data and resource bounds

For successful read responses, the HTTP reader streams and counts decompressed bytes before JSON parsing and enforces an 8 MiB limit. Crossing the limit cancels the body and maps to `invalid_response`. Successful lifecycle-action bodies and every non-2xx response body are cancelled without parsing or buffering. The implementation must not call unbounded `response.json()` or `response.text()`.

Every consumed wire string must be well-formed Unicode without C0/C1 control characters. Required identities (`ClusterName`, fixed-node `Name`, node-array `Template`, status node-array `name`, and `bucketId`) must be present and contain at most 256 Unicode scalar values. Optional consumed identity, machine-type, bucket-reason, and spot-score strings also have a 256-character maximum; lifecycle strings have a 128-character maximum. Any present consumed wire string that violates its grammar or limit maps the whole response to `invalid_response`. Required identities are never truncated, and optional machine-readable fields are never silently omitted or truncated.

Internally generated errors and warnings are fixed templates proven to fit within 512 characters. Generated text summaries are cut with the same ellipsis rule to at most 1024 characters, followed by a final credential redaction pass.

Each diagnostic event name is a fixed identifier of at most 64 characters. Every variable diagnostic field goes through the same remove-controls, replace-credentials-with-`[REDACTED]`, truncate-to-512, replace-credentials-again pipeline before serialization. The server then serializes the object once. If it would exceed 2048 characters, the server instead emits a minimal object of the form `{ "event": "diagnostic_truncated", "sourceEvent": "<fixed-event-name>", "truncated": true }`. It never slices serialized JSON. Every stderr diagnostic line, including startup errors, is a complete valid JSON object within 2048 characters.

Array limits are fixed by the tool contracts: at most 200 clusters, 100 cluster-detail node arrays, 200 fixed node definitions, 50 status node arrays, 50 buckets per returned status node array, and 500 status buckets globally. Results always disclose truncation and distinguish total from returned counts.

A cancellation-aware global semaphore permits at most four active tool calls, with a FIFO queue bounded to eight waiters; a ninth waiter immediately receives the local `busy` error without an HTTP request. Queue time does not consume an HTTP timeout. Cancellation while queued removes the waiter and performs no request. The HTTP dispatcher permits at most four connections, bounding simultaneous successful response buffers to 32 MiB plus parse overhead.

A mutation first attempts to acquire a separate one-permit mutex without queuing. If another mutation holds it, the call immediately receives `busy`; therefore mutations never queue on the mutation mutex, at most one mutation can occupy or wait for global capacity at a time, and additional mutation calls cannot starve reads. After acquiring the mutation mutex, the call acquires one global permit and holds both through dispatch and the optional status follow-up. That follow-up reuses the existing global permit rather than reacquiring it. Every path releases acquired permits in `finally`, and this server never dispatches two lifecycle actions concurrently.

Experimental ClassAd-derived JSON is treated case-insensitively, matching existing CLI behavior. For each experimental object, normalization ASCII-lowercases its own property names only for the consumed fields declared in the mapping. If two present keys map to the same consumed lowercase name (for example, `State` and `state`), the response is `invalid_response` regardless of whether the values are equal; property order never selects a winner. Collisions among wholly ignored properties are ignored. Normalization is isolated and fixture-tested. The capability layer receives only stable domain objects, never wire records. Unknown deeply nested properties are ignored without recursive validation, but the complete decompressed body remains subject to the byte limit.

## Installation, lifecycle, and trust

### Local development installation

After a developer runs the documented verification/build command, the repository is registered directly in VS Code user settings:

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "/home/shpaster/src/cyclecloud-mcp": true
  }
}
```

The local absolute path is illustrative and is never committed as package configuration. A `true` value registers and enables the plugin; `false` registers it in a disabled state. VS Code is expected to detect the Agent Plugins 1.0 format from the root manifest schema; the live demonstration verifies the observed behavior and controls. Disabling or removing the location disables the plugin and stops its MCP server.

On first start, the missing-configuration diagnostic and generated example identify the client-managed `${PLUGIN_DATA}` path. Before creating live configuration, the operator verifies the ownership/path checks, attests that the path is on a local rather than network, shared, or userspace-mounted filesystem, confirms that WSL uses its Linux filesystem when applicable, and records the backup/synchronization attestation. The README explains custom CA setup and its SAN requirement. After the operator creates `cyclecloud.json` with mutations disabled, they disable and re-enable the plugin. The live demonstration verifies that the three read tools appear in **Configure Tools** and **MCP: List Servers**.

### Later private-source installation

After the user creates and pushes the private GitHub repository, **Chat: Install Plugin From Source** is expected to install it from its Git URL. This path is not exercised by the POC because creating or pushing the remote is out of scope. The repository includes the dependency-bundled server module, so source installation should not require an npm lifecycle script or package-manager step. Marketplace publication is outside this POC. Any later published update must increment `plugin.json`'s semantic version and update external marketplace metadata if one is introduced.

### Trust boundary

An agent plugin can execute local code and make network requests. The user must review the private repository and publisher/source before installation. VS Code documents installed plugin MCP servers as implicitly trusted with no separate workspace-MCP startup prompt, but Agent Plugins 1.0 defines no portable trust model and the documentation does not separately guarantee this behavior for `chat.pluginLocations`. The live report records the exact VS Code build and whether the locally registered plugin received such a prompt; that observation is not a conformance criterion.

Any installation or registration trust only permits the local process to start. It does not replace CycleCloud authentication or RBAC, does not guarantee per-tool mutation confirmation, and does not create a durable audit log. A live mutation remains conditional on the tested host providing the required confirmation UI.

## Repository and developer experience

The repository includes:

- canonical root `plugin.json` and `mcp.json` files;
- the reproducibly generated `bin/cyclecloud-mcp.mjs` dependency-bundled server module;
- `README.md` covering every topic enumerated by the README acceptance criterion below; that criterion is the authoritative content checklist;
- `.gitignore`, `.editorconfig`, Prettier, ESLint, esbuild, TypeScript, and Vitest configuration;
- a committed `package-lock.json` pinning the complete dependency graph and npm scripts for `build`, `check:bundle`, `typecheck`, `lint`, `format:check`, `test`, `test:coverage`, `audit`, and `scan:secrets`;
- a GitHub Actions workflow whose third-party actions are pinned by full commit SHA and that uses `npm ci --ignore-scripts` and runs the same local format, lint, typecheck, test, audit, secret-scan, bundle, reproducibility, and bundled-module smoke checks on supported POSIX Node versions;
- vendored test copies of the exact Agent Plugins 1.0 manifest and MCP schemas, with their source URLs and retrieval date recorded;
- no `.vscode/mcp.json`, `.vsix`, `node_modules`, transient `dist`, coverage output, credentials, local configuration, private keys, local certificate files, or `${PLUGIN_DATA}` state in Git; `.gitignore` excludes the fixed credential filename and common local secret/key artifacts as defense in depth.

As an application invariant, runtime never writes under `PLUGIN_ROOT`. The committed `bin/cyclecloud-mcp.mjs` artifact is the sole intentional generated runtime file. `check:bundle` rebuilds it from a clean tree and fails if its bytes differ from the committed artifact. A separate Git-index check requires mode `100644` rather than executable `100755` or symlink `120000`; exact checkout permission bits are deliberately not asserted because Git does not preserve them.

The design specification is committed before implementation planning. Implementation follows test-driven development where practical.

## Test strategy

### Agent-plugin package conformance tests

Tests validate `plugin.json` and `mcp.json` against vendored exact copies of the canonical Agent Plugins 1.0 schemas. They also assert:

- the manifest and MCP declarations equal the contracts in this design, including both `$schema` values;
- the plugin name satisfies the schema grammar; separately, project policy requires the optional version string to follow Semantic Versioning;
- root conventional locations and the absence of unsupported inline/component declarations;
- `mcpServers.cyclecloud.command` is exactly `node`, and `args` is exactly `["${PLUGIN_ROOT}/bin/cyclecloud-mcp.mjs"]`;
- after one-pass placeholder expansion, the module argument resolves inside the source plugin root; `lstat` reports a regular file rather than a symlink, the Git index reports mode `100644`, and the bytes have no shebang;
- `mcp.json` contains no `env`, secret, shell string, unknown field, or unsupported transport;
- an archive-preserving copy retains link structure, and the committed dependency-bundled module launches through the declared `node` command from that direct-install directory without `node_modules`, source files, npm installation, or writes beneath `PLUGIN_ROOT`;
- a clean rebuild is byte-for-byte identical to the committed module;
- the direct-install smoke case with absent live configuration exits only the MCP process with the exact `configuration_missing` diagnostic and fixed `exampleStatus`; the executable subprocess and unit suites below own the complete externally reproducible and injected startup-failure matrices, respectively; portable cross-component failure isolation is documented but cannot be exercised because this POC declares no other components.

### Unit tests

Unit tests cover:

- required `PLUGIN_ROOT` and `PLUGIN_DATA`; exact missing, non-absolute, not-found, non-directory, other resolution-failure, equal-root, and directional-overlap mappings; effective-user ownership; safe ancestor-chain rules; and no ambient `CYCLECLOUD_*` dependency or runtime `PLUGIN_ROOT` writes;
- filesystem-probe success plus each fixed create, chmod, owner, permission, and cleanup failure; execution after root resolution and overlap checks but before reported permission enforcement or credential reads; metadata-less writable reporting reaching `permission_mismatch`; and no leftover probe except when the asserted cleanup-failure path deliberately simulates failed removal;
- fixed credential filename; missing-file example creation, atomicity, exact secret-free content, deliberate `caCertPath` omission, existing-example preservation, ownership, mode `0600`, and caught creation failures with each fixed `exampleStatus`;
- credential-file no-symlink open, regular-file and effective-user ownership checks, acceptance of exactly modes `0600` and `0400`, rejection of every other mode, closed JSON shape including `caCertPath` type and emptiness, defaults, and numeric boundaries;
- `CredentialProvider` isolation and construction of the file-backed implementation without exposing credentials to capability or MCP layers;
- `enableMutations` default and conditional registration, including absence of both mutation tools and dispatch paths when false and one unconditional `mutations_enabled` warning on a true-configured server start;
- rejection of URL user-info, query, fragment, and non-root paths;
- every valid and invalid row of the finite transport-option matrix, IP-literal loopback classification, and both fixed insecure-transport warnings;
- custom-CA path and ancestor-chain integrity, no-symlink open, regular-file, owner, write-permission, size, multi-PEM, and malformed-PEM validation, plus an exact CA array consisting of Node's bundled roots followed by configured certificates;
- scoped TLS settings and Node manual-redirect behavior;
- cluster-name trimming and scalar-value limits; rejection of exact `.`, `..`, C0/C1 controls, lone high/low surrogates, NUL, newline, and DEL; fixed-template URL construction; and path-segment encoding, all before HTTP dispatch;
- printable US-ASCII credential validation, username-colon rejection, and exact Basic-auth bytes;
- case-insensitive wire normalization, every declared field mapping, and rejection of both conflicting and identical case-variant consumed keys;
- exact named-cluster response matching and input-derived status/mutation cluster identity;
- optional, oversized, malformed, control-containing, non-finite, and unsafe-integer fields, including the exact invalid-response policy for every consumed wire-string class;
- sorting, independent limits, global limits, totals, and every truncation flag;
- each capability with a fake `CycleCloudClient`;
- every mutation state-machine transition, including pre-dispatch cancellation, definitive 401/403/404 rejection, recognized DNS/TCP/TLS pre-transmission failures, ambiguous 409 and each other status class, unrecognized post-dispatch failure, follow-up failure, and accepted status;
- four-link error-cause traversal, cycle termination, every recognized TLS/connection code, and unknown-code fallback;
- exact operational error payloads, retryability, non-interpolated safe messages, every closed diagnostic enum, per-event field allowlists, unconditional startup/warning events, debug-gated request events, and inherited truncation gating;
- direct diagnostic-pipeline tests for every declared raw and encoded credential canary form using NUL, TAB, LF, CR, ESC, DEL, and U+0085 at leading, interior, and trailing positions, proving control removal precedes matching and each emitted case contains `[REDACTED]` without a complete or control-obfuscated credential;
- four-call/eight-waiter global limits, FIFO release, `busy` overflow, queued cancellation, listener cleanup, and no dispatch by a cancelled waiter;
- non-queuing mutation-mutex acquisition before global capacity, immediate `busy` for overlap, no read starvation, follow-up reuse of the held global permit, and release on every path;
- MCP input schemas, annotations, success/error output unions, and result mapping.

### HTTP integration tests

An in-process fake CycleCloud HTTP server verifies:

- Basic authorization is sent and never exposed in results;
- exact methods, encoded paths, query parameters, per-request timeout selection, and `redirect: "manual"`;
- generated-at-test-time CA, leaf certificate, and private key material in a temporary directory, never committed: the configured CA with a matching SAN succeeds, a wrong CA and hostname/SAN mismatch each produce `tls_error`, and the test-generated files satisfy the stated ownership/mode checks;
- list, detail, status, start, and terminate response handling;
- Node/Undici manual redirects surfaced as 3xx without following, representative 4xx (including mutation 409 and read 408, 425, and 429), 5xx, malformed JSON, invalid shape, network failure, timeout, and cancellation behavior;
- TLS settings remain client-scoped: `NODE_TLS_REJECT_UNAUTHORIZED` is unchanged and a separate default fetch still rejects the test certificate;
- 2xx action bodies and every non-2xx response body are cancelled without parsing, buffering, logging, or appearing in model-facing errors, including oversized and adversarial instruction-like bodies;
- every read and mutation failure class that reaches dispatch makes exactly one request and is never retried; `busy` and pre-dispatch `cancelled` make none;
- a successful mutation performs exactly one best-effort status read and an uncertain mutation performs none;
- oversized decompressed success JSON, oversized compressed JSON after decompression, deeply nested ignored data within the byte limit, oversized strings, and bounded malformed messages;
- every diagnostic line parses as valid JSON, including the bounded minimal fallback event;
- late server completion or rejection after timeout/cancellation causes no unhandled rejection, duplicate request, leaked timer, retained abort listener, or unexpected follow-up call.

### MCP integration tests

An MCP client connected through an in-memory transport verifies:

- default configuration discovers exactly the three read tools, rejects calls to absent mutation tools at the MCP boundary, and performs no mutation dispatch;
- explicit `enableMutations: true` configuration discovers all five tools;
- tool names, descriptions, input schemas, success/error output unions, and hints match the design;
- valid calls produce structured content and bounded text;
- invalid input is rejected before HTTP is called;
- capability failures produce `isError: true`, exact structured errors, fixed matching safe text, and no server-body excerpt;
- ambiguous mutation results are successful results with `outcome: "unknown"`.

### Executable stdio and secret-canary tests

Subprocess tests launch the committed module through the exact bare `node` command and expanded module argument declared by `mcp.json`, using temporary absolute `PLUGIN_ROOT` and `PLUGIN_DATA` directories and a mode-`0600` credential file. They verify that valid startup allows a protocol handshake and tool call, every stdout byte is consumed as MCP protocol rather than ad hoc logging, diagnostics appear only on stderr, ambient `CYCLECLOUD_*` variables do not alter behavior, and no file under `PLUGIN_ROOT` changes. Every externally constructible invalid plugin environment or startup configuration—including missing, non-absolute, not-found, non-directory, overlapping, unsafe-ancestor, insecure-credential, missing-configuration, and invalid-configuration cases—must produce empty stdout, the exact bounded redacted valid-JSON stderr event and enum value, and a nonzero exit. Failures that require injected filesystem operations remain unit-test responsibilities. Every emitted diagnostic line is parsed as JSON and the oversized-event path must produce the minimal fallback object.

Tests use unique canary username and password values. They scan captured stdout, stderr, MCP text, structured results, startup failures, HTTP errors, timeout/network errors, and diagnostics for the raw username, raw password, `username:password`, its Base64 encoding, and the complete `Basic …` header value, asserting that no end-to-end output exposes a complete or control-obfuscated credential. The unit suite separately drives otherwise unreachable positive `[REDACTED]` cases directly through the diagnostic pipeline. Subprocesses register an `unhandledRejection` sentinel so delayed post-abort completions fail the test.

### Full verification

Before completion, run formatting checks, lint, typecheck, the complete test suite with coverage, dependency audit, secret scan, and a production build. The reviewer-stance diff review records a checklist artifact in the demo report that explicitly traces every promise rejection, timer/listener and semaphore cleanup path, HTTP-attempt count, and mutation uncertainty transition.

## Live POC demonstration

The local live demonstration uses a locally running CycleCloud installation, a dedicated safe test cluster in a dedicated test group, and a dedicated POC account not reused by the CLI. The account receives only the smallest available CycleCloud role and group scope needed for the portions of the demonstration that are actually run.

The demo report records the exact VS Code build, operating environment, relevant profile settings, and observed host behavior. It must show:

1. Canonical-schema and bundle-conformance tests pass before registration.
2. The repository is registered through `chat.pluginLocations` with `chat.plugins.enabled` set to true; no `.vscode/mcp.json` or VSIX is used.
3. VS Code identifies the package as an Agent Plugins 1.0 plugin, starts the `cyclecloud` MCP server automatically when enabled, lists it in **MCP: List Servers**, and stops it when disabled.
4. The report records whether this locally registered plugin receives a workspace-MCP startup trust prompt; no result is asserted as a portable Agent Plugins requirement.
5. First startup creates only the secret-free, effective-user-owned, mode-`0600` example under `${PLUGIN_DATA}`, reports the expected credential path, and writes nothing under `PLUGIN_ROOT`.
6. The report records the resolved `PLUGIN_DATA` path and the operator's written attestation that it is on a local filesystem and excluded from every synchronization, profile-export, and backup scope known to them before supplying credentials; under WSL the report confirms that the path uses the Linux filesystem.
7. The report records the dedicated POC account's exact CycleCloud role and group assignment. The operator creates `${PLUGIN_DATA}/cyclecloud.json` outside the agent conversation with that account and `enableMutations: false`, disables and re-enables the plugin, and Agent mode discovers exactly the three read tools; both mutation tools are absent.
8. `list_clusters`, `get_cluster`, and `get_cluster_status` return bounded structured results.
9. Invalid credentials produce `authentication_failed` without leaking raw or encoded credentials, after which the valid file is restored outside the conversation.
10. An unknown cluster produces `cluster_not_found`.
11. The report records whether the tested host provides per-tool mutation confirmation.
12. If confirmation is available and the recorded account scope contains only the dedicated test group with the minimum role needed for lifecycle actions, mutation auto-approval is disabled, the operator changes `enableMutations` to true outside the agent conversation and restarts the plugin, captured startup diagnostics contain `mutations_enabled`, Agent mode discovers all five tools, the agent reads and states the selected test cluster's status, and the user separately approves the exact action, `clusterName`, and `recursive` value immediately before each start or terminate dispatch.
13. If confirmation or the required account scoping is unavailable, `enableMutations` remains false, both mutation tools remain absent, and live mutations are reported as unsupported; this does not fail Agent Plugins package conformance.
14. Any executed start or terminate returns accepted or explicitly uncertain results and reports observed status when available. After the live mutation demonstration, the operator restores `enableMutations: false`, restarts the plugin, and verifies that only the read tools remain.
15. Source control, package data, stdout, MCP results, and captured diagnostics contain no secret; the permission-checked plugin-data credential file is the only persistent secret location created by the plugin.
16. At the end of the demonstration, the operator disables the plugin, permanently deletes `cyclecloud.json`, rotates or disables the dedicated POC account credential, and records both cleanup actions.

Live mutation authorization is not implied by approval of this design or by setting `enableMutations: true`. If the tested host supports the confirmation policy, start and terminate each require separate confirmation immediately before execution.

## Acceptance criteria

The POC is complete when:

- `plugin.json` and `mcp.json` validate against Agent Plugins 1.0, have the exact approved content, and are recognized by VS Code as an agent plugin with one stdio MCP component;
- a fresh development checkout on Node 20+ can run `npm ci --ignore-scripts`, format-check, lint, typecheck, test, scan dependencies and secrets, and reproducibly build using documented commands and the committed lockfile;
- the committed module is a regular non-symlink Git-mode-`100644` file with no shebang and is byte-for-byte reproducible;
- on a supported host with Node 20+ discoverable through the platform's default executable search, a copied direct-install plugin root launches the committed module through the exact `node` command and `${PLUGIN_ROOT}/bin/cyclecloud-mcp.mjs` argument declared in `mcp.json`, without npm installation, `node_modules`, source files, shell command strings, secrets in package data, or runtime writes under `PLUGIN_ROOT`;
- runtime configuration depends only on the standard injected `PLUGIN_ROOT` and `PLUGIN_DATA` environment variables, the process intentionally requires the declared Node runtime, ambient CycleCloud variables are ignored, equal or nested roots in either direction are rejected after real-path resolution, and all writable state remains under the accepted data root;
- the data root, safe ancestor chain, supported filesystem, and credential file pass the effective-user ownership and permission checks; the file is opened without following symlinks as a regular file with mode exactly `0600` or `0400`; and the plaintext, same-user modification, and plugin-root-integrity boundaries are documented accurately;
- `CycleCloudClient` depends on `CredentialProvider`, and credential material never reaches capability or MCP layers;
- default configuration registers exactly the three read tools; explicit `enableMutations: true` registers all five and emits `mutations_enabled` on each configured server start; and both modes satisfy their contracts and failure-path tests;
- lifecycle routes are isolated behind `CycleCloudClient` and labeled experimental;
- tool output is structured, numerically bounded, and explicit about truncation and uncertainty;
- successful decompressed JSON bodies, safe messages, and diagnostics satisfy their byte/character limits before parsing or exposure, non-2xx response bodies are cancelled without model exposure, and every diagnostic line remains valid JSON;
- secure defaults reject non-loopback plain HTTP, restrict disabled TLS verification to loopback HTTPS, enforce custom-CA ancestor/file integrity, append validated custom CAs to Node's bundled roots while retaining chain and SAN/hostname verification, keep TLS configuration client-scoped, and refuse redirects;
- raw and Basic-encoded credentials are absent from package data, tool schemas, results, logs, fixtures, committed configuration, and Git history, without claiming to confine independent same-user tools or processes;
- every HTTP operation makes at most one attempt, and all late async work is settled without leaks or unhandled rejection;
- active calls and queued waiters are bounded, overlapping mutations receive `busy`, and at most one lifecycle action is in progress through this server;
- VS Code auto-starts/stops the server with plugin enablement and exposes its tools and listing controls; local-registration trust behavior is recorded but not treated as portable conformance;
- Agent Plugins schema/package conformance is reported separately from tested Linux/macOS/WSL runtime compatibility;
- VS Code agent mode completes the default read-only demonstration; the report records the resolved credential-data path, the operator's attestation that it is on a local rather than network, shared, or userspace-mounted filesystem, the WSL filesystem when applicable, the attestation against their known backup/synchronization/profile-export scopes, and the dedicated non-CLI POC account's exact CycleCloud role and group assignment;
- when the recorded VS Code build supports per-tool confirmation and the account is minimally scoped to the dedicated test group, separate mutation demonstrations require an explicit temporary `enableMutations: true`, disabled auto-approval, and action-time approval of exact arguments, followed by restoration to false; otherwise mutation tools remain absent and live mutations are safely skipped without failing package conformance;
- the demo ends with recorded deletion of the plaintext credential file and rotation or disabling of the dedicated POC credential;
- the README accurately describes platform support and compatibility, installation, plugin-data ownership and exact accepted credential modes, local-filesystem attestation and unsupported network/shared/userspace-mounted locations, WSL requirements, plaintext and backup/synchronization exposure, the complete transport matrix including IP-literal loopback classification and the invalid loopback-HTTP plus `allowInsecureHttp: true` combination, HTTP credential exposure, custom CA/SAN setup and ignored `NODE_EXTRA_CA_CERTS`, dedicated non-CLI least-privileged account requirements, installation trust, endpoint stability, Basic-auth and same-user boundaries, mutation-gate, warning, restart, and approval semantics, rotation, uninstall deletion, residual risks, lack of durable auditing, example prompts, local demo instructions, and troubleshooting;
- the full automated verification passes and the demo report contains the completed reviewer-stance checklist.

## Future directions

Possible follow-up work, explicitly outside this POC, includes:

- Entra and managed-identity authentication;
- supported cluster lifecycle product APIs;
- richer node querying and bounded pagination;
- preview tokens or server-enforced two-phase mutation flows;
- certificate or SPKI fingerprint pinning for legacy SAN-less installations;
- node-array scaling and individual node actions;
- operation polling and progress resources;
- scheduler-aware diagnosis;
- hosted transports and CycleCloud UI integration;
- OS-backed encrypted credential helpers;
- native Windows and self-contained runtime artifacts;
- plugin marketplace, npm, or MCP registry distribution.
