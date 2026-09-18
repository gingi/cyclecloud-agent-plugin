# CycleCloud MCP design

## Purpose and scope

CycleCloud MCP is a proof-of-concept Copilot agent plugin for inspecting Azure CycleCloud from GitHub Copilot. It contains a dependency-bundled, local stdio Model Context Protocol (MCP) server. Four read tools expose cluster inventory, configuration, lifecycle/capacity status, node issues, and application-authoring context. Two optional tools start and terminate clusters; they are absent unless explicitly enabled at startup.

The package is independent of VS Code APIs. It is an agent plugin, not a VS Code extension. It includes an authoring-only skill skeleton, starter assets, and a local checker; see [application authoring](application-authoring.md). It includes no custom agents or hooks. The skill does not add MCP tools or deployment capabilities. The repository includes a Copilot marketplace catalog and an installer. The [README](../README.md) provides setup and usage instructions; [configuration](configuration.md) and [troubleshooting](troubleshooting.md) cover operator procedures.

The design prioritizes:

- A small, task-oriented tool surface rather than arbitrary HTTP access.
- Direct CycleCloud authentication and authorization, including account roles and group scope.
- Validated, bounded, structured results rather than raw API records.
- Read-only discovery by default, explicit mutation uncertainty, and no automatic HTTP retries.
- A self-contained runtime artifact that needs Node but no dependency installation on the client.

The POC does not provide cluster creation, node-array scaling, individual node actions, scheduler diagnosis, historical log retrieval, autonomous remediation, cost estimation, multiple connection profiles, hosted MCP transport, or a CycleCloud web UI integration. It does not implement token authentication, encrypted credential storage, a durable audit log, or server-enforced human approval.

## Architecture

```text
Copilot plugin runtime / explicitly configured MCP host
    |
    | node <plugin-root>/bin/cyclecloud-mcp.mjs
    | host resolves the executable path; server locates private configuration
    v
index.ts: environment, configuration, client, stdio startup
    |
    v
server.ts: MCP declarations, input validation, result mapping
    |
    v
tools.ts: task orchestration and mutation guard
    |                         |
    v                         v
CycleCloudClient          normalize.ts
    |                     wire data -> bounded domain results
    v
cyclecloud-client.ts: authenticated HTTP and scoped TLS
    |
    +-- /cloud/api/*       cluster inventory and details
    +-- /clusters/*       lifecycle/capacity status
    +-- /exec/query/      node issue groups
    `-- /cloud/actions/*  optional lifecycle mutations

config.ts -> CredentialProvider -> HTTP client
```

### Module boundaries

| File                       | Responsibility                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Resolve plugin environment, load configuration, compose the client/server, connect stdio, report startup failures.                                                            |
| `src/config.ts`            | Read and validate the fixed configuration file, enforce credential-file checks, validate transport options, create a missing-file example.                                    |
| `src/credentials.ts`       | Credential-provider interface and an in-memory snapshot of credentials loaded from the file. Each access returns a fresh object.                                              |
| `src/cyclecloud-client.ts` | Narrow client interface and Undici implementation, Basic authentication, endpoint construction, TLS, timeouts, cancellation, response byte limits, HTTP error classification. |
| `src/normalize.ts`         | Domain result types, wire-field selection, numeric/string validation, sorting, counts, and truncation.                                                                        |
| `src/tools.ts`             | Read orchestration, best-effort issue enrichment, single-mutation guard, accepted/unknown outcomes, and follow-up status.                                                     |
| `src/server.ts`            | Zod tool inputs, conditional registration, MCP annotations, structured output and fixed error text.                                                                           |
| `src/errors.ts`            | Fixed startup and operational error categories/messages; local diagnostic-path sanitization.                                                                                  |

The MCP and task layers depend on `CycleCloudClient`, not the concrete HTTP implementation. The client returns unknown wire data, which the task layer passes to the normalizers. Raw records do not pass through to MCP results. Credentials are supplied only to the HTTP client, not to task or MCP handlers.

TypeScript uses strict checking and ECMAScript modules. Runtime dependencies are the official TypeScript MCP SDK, Zod, and Undici. Esbuild produces the bundle; Vitest, ESLint, Prettier, and TypeScript support verification.

### Package and runtime contract

The built package mirrors the source repository's plugin-root layout:

- `plugin.json` declares the name `cyclecloud-mcp`, version, description, and keywords using the Copilot plugin format supported by both hosts.
- `plugin.json` includes an inline `mcpServers` declaration for `cyclecloud`, with `type: "stdio"`, `command: "node"`, and `args: ["${PLUGIN_ROOT}/bin/cyclecloud-mcp.mjs"]`. No root `.mcp.json` is shipped, preventing the checkout from also becoming an unintended workspace MCP registration.
- The MCP declaration contains no `env`, `cwd`, shell command string, or credentials.
- `.github/plugin/marketplace.json` describes the root package (`source: "./"`) in the `cyclecloud-mcp` catalog, with repository `https://github.com/gingi/cyclecloud-mcp` and matching plugin metadata. This catalog is installed from a complete release/development package, not directly from the source-only GitHub repository.
- `cyclecloud.example.json` is a packaged, secret-free configuration template. Its empty password is deliberately invalid for live use.
- `bin/cyclecloud-mcp.mjs` is a generated, Git-ignored, dependency-complete module with no shebang and build mode `0644`. Release and development packages include it. Node loads it directly; installing a package does not require npm or a build.
- The repository is MIT-licensed. `package.json` is private, so npm publication is not the distribution mechanism.

The supported runtime range is Node.js `^20.19.0 || ^22.12.0 || >=24.0.0`, on Linux, macOS, or WSL with a POSIX Node executable available on the executable search path. Native Windows is unsupported. Package compatibility does not imply that every client host expands plugin placeholders or launches MCP servers identically.

Stdout belongs exclusively to the MCP protocol. Startup diagnostics and the mutation-enablement warning go to stderr. The MCP process does not intentionally write beneath `PLUGIN_ROOT`; installation and developer deployment are separate operations that do write package files.

## Configuration and authentication

### Startup sequence

1. Derive the plugin root from the module location. Resolve the credential directory from an explicit `PLUGIN_DATA` override or default to `~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp`. Resolve both with `realpath`, require existing directories, and reject equality or containment in either direction. Injected `PLUGIN_ROOT` is not used by the server.
2. Read exactly `cyclecloud.json` in that credential directory. The server does not read CycleCloud CLI configuration, workspace settings, or ambient `CYCLECLOUD_*` variables.
3. Check the credential file with `lstat`, open it with `O_NOFOLLOW`, and check the open descriptor. It must be a regular file owned by the effective OS user with mode exactly `0600` or `0400`, including rejection of special permission bits.
4. Parse a strict JSON object, validate settings and transport combinations, and separate nonsecret settings from the credential provider.
5. Create the HTTP client and its TLS dispatcher, register tools according to `enableMutations`, and connect the stdio transport.

Configuration and the Basic authorization header are loaded once per server process. File edits require a server restart or a fresh Copilot session.

If the live file is missing, startup attempts exclusive creation of `cyclecloud.example.json` under the data directory with mode `0600`. It preserves any existing example, emits `configuration_missing` with the expected configuration path and a fixed reason (`created_example`, `example_exists`, or `example_creation_failed`), and exits nonzero. The packaged template lets the installer prepare configuration without first launching the server.

### Settings

| Property            | Required | Default | Meaning                                                                                                                                  |
| ------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `url`               | Yes      | —       | Absolute HTTP(S) CycleCloud root URL, without user-info, query, fragment, or non-root path. Reverse-proxy path prefixes are unsupported. |
| `username`          | Yes      | —       | 1–256 printable US-ASCII characters; `:` is forbidden.                                                                                   |
| `password`          | Yes      | —       | 1–4096 printable US-ASCII characters; `:` is allowed.                                                                                    |
| `verifyTls`         | No       | `true`  | Disable only for loopback HTTPS.                                                                                                         |
| `caCertPath`        | No       | —       | Non-empty absolute path to additional PEM CA certificates, for verified HTTPS only.                                                      |
| `allowInsecureHttp` | No       | `false` | Explicit opt-in for non-loopback HTTP.                                                                                                   |
| `enableMutations`   | No       | `false` | Register `start_cluster` and `terminate_cluster`.                                                                                        |
| `requestTimeoutMs`  | No       | `30000` | Integer read timeout, 1000–60000 ms per HTTP request.                                                                                    |
| `actionTimeoutMs`   | No       | `60000` | Integer lifecycle POST timeout, 35000–300000 ms.                                                                                         |
| `debug`             | No       | `false` | Accepted configuration field; no debug request logging is implemented.                                                                   |

Unknown properties and invalid values fail startup. The stored URL is normalized to its origin. The client builds `Authorization: Basic <base64>` from US-ASCII `username:password` bytes; credentials are never tool arguments.

### Transport policy

For transport overrides, loopback means an IP literal in `127.0.0.0/8` or exactly `::1`, not the DNS name `localhost`.

| URL                   | `verifyTls` | `caCertPath`    | `allowInsecureHttp` | Result                                   |
| --------------------- | ----------- | --------------- | ------------------- | ---------------------------------------- |
| HTTP loopback         | `true`      | Absent          | `false`             | Allowed for local POC use.               |
| HTTP non-loopback     | `true`      | Absent          | `true`              | Explicitly allowed, insecure.            |
| HTTPS, any host       | `true`      | Absent or valid | `false`             | Certificate chain and hostname verified. |
| HTTPS loopback        | `false`     | Absent          | `false`             | Explicit local verification override.    |
| Any other combination | Any         | Any             | Any                 | Startup rejected.                        |

Every HTTP connection, including loopback, transmits reusable credentials without TLS protection. Verified HTTPS is the remote default. The runtime does not emit separate warnings for HTTP or disabled TLS verification.

A custom CA file must be regular, not a final-component symlink, owned by the effective user or root, not group/world writable, and at most 1 MiB according to its file metadata. The loader checks it before and after `O_NOFOLLOW` open and parses one or more PEM certificates, rejecting non-whitespace material outside certificate blocks. Its contents are appended to Node's bundled `rootCertificates` for this client only. Ambient `NODE_EXTRA_CA_CERTS` is not incorporated into this explicit trust array. Certificate SAN/hostname checks still apply; the client does not alter global Node TLS settings.

### Security boundaries and limitations

CycleCloud authentication, RBAC, and group scope are the authorization boundary. Use a dedicated, least-privileged POC account, with read-only access for normal operation. Plugin installation runs code with the OS user's permissions and requires trust in the repository and bundled dependencies.

`cyclecloud.json` is plaintext storage, not a secret manager. File checks do not protect it from other same-user processes, extensions, terminal tools, or agents. Such code can also change mutation settings or the bundle. Credentials and the Basic header reside in JavaScript memory and cannot be reliably zeroed.

Operators should keep the data directory private and on a local filesystem outside backup, synchronization, profile-export, and shared-mount scopes; WSL should use its Linux filesystem. These are deployment requirements, not properties proved by the runtime. The runtime checks root separation and final credential/CA files, but does not probe POSIX metadata semantics or enforce directory ownership and permission checks along ancestor chains. It also has no credential-file byte limit or general credential-redaction pass over returned data or diagnostic paths.

The implementation keeps configured credentials out of tool contracts and uses fixed local error messages rather than exposing HTTP bodies or exceptions. CycleCloud names and diagnostic strings are nevertheless untrusted external data; they can contain instruction-like text and must not be treated as instructions. File permissions, MCP hints, and conditional tool registration do not confine independent agent tools or create an audit trail.

## HTTP boundary

The model selects only named capabilities and their documented arguments. It cannot choose a host, route, method, header, arbitrary query, or raw body. Cluster names are trimmed and validated by the MCP input schema: 1–256 characters counted by Unicode code point, a well-formed-Unicode check, no C0/C1 control characters, and neither `.` nor `..`. Endpoint paths encode the name as one segment with `encodeURIComponent`.

| Operation         | Method and endpoint                                                                     | Timeout | API stability            |
| ----------------- | --------------------------------------------------------------------------------------- | ------- | ------------------------ |
| List clusters     | `GET /cloud/api/clusters?summary=true&cloud_instances=true`                             | Read    | CLI-backed internal API. |
| Get cluster       | `GET /cloud/api/clusters/{name}?summary=true&cloud_instances=true`                      | Read    | CLI-backed internal API. |
| Get status        | `GET /clusters/{name}/status?nodes=false`                                               | Read    | Public status API.       |
| Get node issues   | `GET /exec/query/?q={encodedQuery}&format=json`                                         | Read    | Internal query API.      |
| Start cluster     | `POST /cloud/actions/startcluster/{name}?wait_time=30&recursive={bool}&test_mode=false` | Action  | CLI-backed internal API. |
| Terminate cluster | `POST /cloud/actions/terminatecluster/{name}?wait_time=30&recursive={bool}`             | Action  | CLI-backed internal API. |

Listing omits `templates=true` to request non-template clusters; there is no alternate list-route fallback. List and detail responses are JSON arrays. A named detail response must contain exactly one record whose normalized name exactly matches the trimmed input; an empty array means `cluster_not_found`, and multiple or mismatched records mean `invalid_response`.

Issue retrieval uses the fixed query:

```text
select Name, Status, Message, NodeCount, Detail, Recommendation
using cloud.node.node_status where ClusterName == <JSON string literal>
```

The client inserts the cluster name using `JSON.stringify`, then URL-encodes the complete query. It sends `Accept: */*` for this endpoint, with `format=json` selecting JSON; other requests use `Accept: application/json`. Query access uses the same configured account and does not depend on mutation enablement. The internal routes are isolated behind `CycleCloudClient` and may vary between CycleCloud versions.

All requests use manual redirect handling; no redirect target receives the authorization header. Successful read bodies are streamed and limited to 8 MiB of decompressed bytes before JSON parsing. Exceeding that limit or invalid JSON yields `invalid_response`. Non-2xx bodies and all action bodies are cancelled without parsing or logging.

Each HTTP request has its own timeout and caller-cancellation listener, removed in `finally`. There are no automatic retries. Status plus issue enrichment can use two consecutive read timeouts; an accepted mutation can use one action timeout plus one read timeout. Undici is configured with four connections. There is no application-level global semaphore, bounded waiter queue, or aggregate-memory guarantee.

## MCP tool contracts

All input objects are strict: undeclared properties are rejected. Limits are integers. Tool-input failures are handled by the MCP SDK before task execution. Success returns `isError: false`, a concise text summary, and the result object in `structuredContent`.

The registered output schema is an open object (`z.object({}).passthrough()`), not a separate strict success/error union for each tool. Concrete result shapes and bounds are enforced by TypeScript types and normalizers.

Read annotations are `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: true`. Both mutation tools set the first three to `false`, `true`, and `false`, respectively, and retain `openWorldHint: true`. These are client hints, not authorization controls.

### Shared normalization rules

- CLI-backed cluster records and issue records use ASCII-case-insensitive consumed field names. Duplicate case variants of a consumed field invalidate the response, even if values match. Public status fields use their declared case-sensitive names.
- Unknown fields are ignored rather than recursively validated or exposed.
- Counts and count sums must be non-negative safe integers. Overflow is rejected. `lastCapacityFailure` may be any finite number.
- Required identity strings are non-empty, well-formed Unicode without C0/C1 controls, limited to 256 code points. Optional consumed identity, machine-type, reason, and spot-score strings have the same character bound; lifecycle strings are limited to 128. Invalid consumed values invalidate the response rather than being silently truncated.
- Issue message/detail/recommendation text has a separate sanitization and truncation policy below.
- Sorting folds ASCII case first and uses original text as a tie-breaker. Limits apply after normalization and sorting; totals describe data before truncation. Zero limits suppress entries, not the underlying HTTP reads or validation.

### `list_clusters`

Input: `limit` defaults to 50, range 1–200.

```ts
interface ClusterSummary {
    name: string;
    state?: string;
    targetState?: string;
    fixedNodeDefinitions: number;
    nodeArrayCount: number;
    arrayNodeCount: number;
    configuredNodeCount: number;
}
interface ClusterListResult {
    clusters: ClusterSummary[];
    total: number;
    returned: number;
    truncated: boolean;
}
```

`ClusterName`, `State`, and `TargetState` map to the corresponding identity/lifecycle fields. `fixedNodeDefinitions` counts `Nodes` entries; it is not a running-instance count. `nodeArrayCount` counts `NodeArrays`, `arrayNodeCount` sums their `Count` values, and `configuredNodeCount` adds fixed definitions to array nodes. Missing `Nodes` or `NodeArrays` is treated as an empty array. Results are sorted by cluster name before limiting.

### `get_cluster`

Input: required `clusterName`; `fixedNodeLimit` defaults to 50, range 0–200; `nodeArrayLimit` defaults to 50, range 0–100.

```ts
interface ClusterDetailResult {
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

Fixed-node mappings are `NodeId` → `id`, `Name` → `name`, and `Template`, `State`, `TargetState` → their lower-camel-case fields. Node-array mappings consume `Template`, `State`, `TargetState`, `Count`, and optional `CoreCount`. Fixed nodes sort by name and arrays by template, with independent limits. Aggregate node counts include all array entries and fixed definitions, not only returned entries.

### `get_cluster_status`

Input: required `clusterName`; `nodeArrayLimit` defaults to 20, range 0–50; `bucketLimit` defaults to 20 per returned array, range 0–50; `issueLimit` defaults to 20, range 0–100.

```ts
interface BucketStatus {
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
}
interface ClusterIssue {
    name: string;
    severity: "Error" | "Warning";
    nodeCount: number;
    message?: string;
    detail?: string;
    recommendation?: string;
    textTruncated: boolean;
}
type ClusterIssues =
    | {
          available: true;
          items: ClusterIssue[];
          total: number;
          returned: number;
          truncated: boolean;
      }
    | { available: false; warning: string };
interface ClusterStatusResult {
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
            buckets: BucketStatus[];
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
        issues: ClusterIssues;
    };
}
```

The public status request uses `nodes=false` to exclude individual nodes. `clusterName` is derived from the validated input. `machineType` comes only from `definition.machineType`; raw definitions and node-array records are not exposed.

Arrays sort by name, and buckets by ID. The server visits selected arrays in sorted order and applies both the per-array bucket limit and a global budget of 500 returned buckets. Later arrays can receive fewer or no buckets. Top-level bucket totals cover all arrays; per-array totals cover each returned array before its bucket limit.

After successful status normalization, the task makes one issue query. It retains `Error` and `Warning` rows, skips `OK` and `Pending`, and rejects unknown statuses. Results sort by severity (errors first), then condition name and message. `total`, `returned`, and `truncated` count issue groups, not nodes. A node can contribute to multiple conditions, so `nodeCount` values must not be summed into a distinct affected-node total. Detail and recommendation are representative group diagnostics, not exhaustive per-node records.

Optional diagnostic text may be absent or null. Present text must be a well-formed string; C0/C1 controls become spaces. Each message, detail, or recommendation is limited to 2,048 code points, including an ellipsis if shortened. `textTruncated` is true when any of those fields is shortened. A zero issue limit still queries and validates issues, returning counts without items.

If the query is unavailable, denied, malformed, or oversized, the tool preserves lifecycle/capacity status and returns `issues.available: false` with a fixed warning. This does not mean there are no issues. A successful empty result has `available: true`, `total: 0`, and empty items. Cancellation during issue retrieval propagates as a `cancelled` tool error rather than being disguised as unavailable diagnostics. No issue query runs if the primary status read or normalization fails.

### `get_cluster_application_context`

See [Application context](application-context.md) for the input contract, fixed query projections, normalized evidence, bounds, failure handling, and attachment workflow. `src/application-context.ts` owns allowlisted normalization and byte-limited paging; `src/application-context-reader.ts` orchestrates compact overview and single-target section reads. Overview omits full specs/mounts and skips parameter values; attachment details query only the matching parameter. The tool uses existing authenticated reads and does not add mutations. Parameter metadata is scoped to the verified root cluster; shared-use lists cover the queried cluster only. Configuration is not runtime verification.

### `start_cluster` and `terminate_cluster`

Both accept required `clusterName` and optional `recursive`, default `false`. They are registered only when startup configuration has `enableMutations: true`, which also emits a `mutations_enabled` stderr event.

```ts
interface MutationResult {
    action: "start" | "terminate";
    clusterName: string;
    recursive: boolean;
    outcome: "accepted" | "unknown";
    observedStatus?: {
        state?: string;
        targetState?: string;
    };
    warning?: string;
}
```

A per-`CycleCloudTools` boolean guard permits one mutation at a time, including its follow-up status read. Overlapping mutations immediately return `busy`, without a second lifecycle dispatch. The guard is released in `finally`; reads are not blocked by it. This guard applies to one server instance, not across MCP processes or other CycleCloud clients.

Mutation dispatch and outcome handling:

| Condition                                                                         | Result                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Cancellation observed before the request starts                                   | `cancelled`, no HTTP dispatch.                                                  |
| Another mutation holds the guard                                                  | `busy`, no HTTP dispatch.                                                       |
| HTTP 2xx                                                                          | `outcome: "accepted"`; ignore the action body.                                  |
| HTTP 401 / 403 / 404                                                              | Definitive `authentication_failed` / `permission_denied` / `cluster_not_found`. |
| Any other non-2xx, including redirects, conflicts, rate limits, and server errors | `outcome: "unknown"`, with an inspect-before-retrying warning.                  |
| Recognized DNS/TCP establishment or certificate-validation failure                | Categorized network, timeout, or TLS error.                                     |
| Other post-dispatch failure, timeout, or cancellation                             | `outcome: "unknown"`, with an inspect-before-retrying warning.                  |

An unknown outcome receives no follow-up request. An accepted action receives exactly one best-effort public status read, not an issue query or polling loop. Observed state fields are included when present. A failed or cancelled follow-up preserves `accepted` and adds a fixed warning. Acceptance does not mean that all nodes have reached their target state.

Tool descriptions instruct the agent to read status and present the exact target and recursive behavior for approval before a mutation. The server cannot prove that the read or human approval happened. Operator policy is to enable mutations only in a client/session that provides per-call confirmation of exact arguments, with mutation auto-approval disabled. Enabling the tools is not approval for an individual action.

## Error and diagnostic model

Operational tool errors return `isError: true`, one fixed text message, and:

```ts
interface ToolError {
    error: {
        category: string;
        message: string;
        retryable: boolean;
    };
}
```

The category vocabulary is closed:

| Category                      | Typical cause                                                                 | Retryable             |
| ----------------------------- | ----------------------------------------------------------------------------- | --------------------- |
| `authentication_failed`       | HTTP 401.                                                                     | No                    |
| `permission_denied`           | HTTP 403.                                                                     | No                    |
| `cluster_not_found`           | HTTP 404 or empty named-cluster response.                                     | No                    |
| `cyclecloud_rejected_request` | Read 4xx.                                                                     | Only 408, 425, or 429 |
| `cyclecloud_unavailable`      | Read server failure.                                                          | Yes                   |
| `unexpected_redirect`         | Read 3xx.                                                                     | No                    |
| `tls_error`                   | Recognized certificate chain or hostname failure.                             | No                    |
| `busy`                        | Overlapping mutation.                                                         | Yes                   |
| `timeout`                     | Read timeout or recognized connection-establishment timeout.                  | Yes                   |
| `network_error`               | Read network failure or recognized mutation connection-establishment failure. | Yes                   |
| `cancelled`                   | Cancelled read or mutation before dispatch.                                   | No                    |
| `invalid_response`            | Malformed, oversized, or invalid consumed data; unexpected task exception.    | No                    |

Retryability is advice for an explicit later call, not an automatic retry policy. Mutation uncertainty uses a successful result with `outcome: "unknown"`, not a retryable error. `src/errors.ts` owns the exact, non-interpolated messages; no HTTP body, exception message/stack, URL, header, or cluster name is inserted into them.

Cause classification inspects up to four distinct objects starting with the caught error and following `cause`, stopping on a cycle. Recognized certificate codes are `CERT_HAS_EXPIRED`, `CERT_NOT_YET_VALID`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_GET_ISSUER_CERT`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, and `ERR_TLS_CERT_ALTNAME_INVALID`. `ENOTFOUND`, `EAI_AGAIN`, and `ECONNREFUSED` identify connection establishment failures; `UND_ERR_CONNECT_TIMEOUT` identifies connection establishment timeout. Classification does not inspect exception text.

Startup failures occur before usable tool registration and produce a JSON line on stderr, a nonzero exit code, and no ad hoc stdout output:

- `plugin_environment_invalid`, with `invalid_plugin_data`, covers invalid or overlapping roots.
- `configuration_missing` includes a fixed example-creation reason and the expected file path.
- `configuration_invalid` uses fixed reasons for JSON, schema, URL, credentials, timeout, CA, or transport failures.
- `credential_file_insecure` uses fixed reasons for open, symlink, type, owner, or mode failures.
- Unexpected startup exceptions become the fixed `startup_failed` event without caught exception details.

A diagnostic path has C0/C1 controls removed and is limited to 512 code points. There is no general serialized-event truncation framework or request telemetry. The only explicit enablement warning is `mutations_enabled`, independent of `debug`.

## Distribution and client integration

### Installer

The published release asset `install.sh` is generated from `scripts/install-release.sh`. It embeds one exact version's download URL, fetches the archive/checksum with bounded retries, validates the checksum and version, and invokes the archive's installer from private temporary storage. Its temporary files are cleaned up on completion/failure. This restores curl-based installation without treating the source repository as a built marketplace. The archive's optional `SOURCE_COMMIT.json` is retained in both installed copies.

The source/packaged `install.sh` is POSIX shell with embedded Node for JSON handling and private file creation. It installs the complete adjacent release/development package by default; `--local [package-directory]` selects a package explicitly (required when the script is passed through stdin). A source-only checkout or standalone installer download is not sufficient. It requires a supported OS/Node runtime and an already installed and authenticated GitHub Copilot CLI 1.0.81 or later; it does not install prerequisites, use sudo, or verify CycleCloud connectivity.

The installer:

1. Validates the complete package before changing configuration or registrations.
2. Inspects destination paths and Copilot plugin/marketplace inventory, rejecting unrelated same-name registrations.
3. Prompts for private CycleCloud configuration when a terminal is available, preserving existing values as defaults; `--skip-config` leaves existing configuration unread or creates a private template when absent.
4. Copies the package into the managed local marketplace and registers `cyclecloud-mcp@cyclecloud-mcp`, replacing an old known GitHub development registration if needed.
5. Synchronizes the VS Code-visible runtime copy and preserves credentials and disabled state on reruns.
6. Prints configuration and fresh-session verification instructions.

The default paths are:

```text
~/.copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/
~/.copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json
```

Installer directory checks require its selected data-path components to be user-owned, non-symlink directories without group/world write access. New directories use mode `0700`, and new configuration uses `0600`. These installer checks are distinct from runtime checks and are not full ancestor-chain validation.

Release archives pin both installer and runtime to the selected build. Rerunning from a new package updates the installed version; reinstalling an older package rolls it back. Copilot marketplace update commands do not fetch GitHub Release assets.

The installer validates and copies a minimal complete package into `~/.local/share/cyclecloud-mcp/marketplace`, then registers that persistent local marketplace. Depending on the CLI version, the package is loaded live from that directory or copied to the installed-plugin directory. VS Code scans only the installed-plugin directory, not the CLI's live marketplace registration, so the installer also synchronizes the full package to the default installed-plugin path for live registrations. This does not create a second CLI registration. Both runtime copies share the credential directory, and local reruns repair both. The input checkout/package is not needed afterward. Local reruns update changed files and repair missing ones while preserving credentials and enablement. The managed `installation.json` receipt retains a disabled choice across partial source-switch failures. Only this project's known old GitHub development source can be switched automatically; unrelated sources are refused. Partial CLI operations are kept and can be retried.

`npm run package:local` builds a self-contained directory under `dist/cyclecloud-mcp`; `npm run install:local` also installs it. The artifact contains manifests, bundled server, configuration template, license, installer, marketplace metadata, and the explicitly listed application-authoring skill assets.

### Host behavior

Copilot's native plugin runtime supplies plugin paths and launches `cyclecloud` for its sessions. The portable package does not depend on a separately configured VS Code workspace MCP server.

After installation, reload VS Code before checking **Agent Plugins - Installed**. Enable **Chat: Plugins Enabled** and the individual `cyclecloud-mcp` plugin, then start a fresh connected agent session. No separate workspace/user MCP registration is needed.

Configuration and tool availability are process-scoped. Restart the relevant MCP server or create a fresh Copilot session after configuration, update, or deployment. Actual tool calls, not merely an inventory entry or model response, verify that the chosen client launch path works. Cloud sessions and native Windows are not validated targets. Detailed client procedures belong in [troubleshooting](troubleshooting.md).

### Updates and removal

Release and development updates rerun the packaged installer with the new package. Removing the plugin does not delete its credentials. Operators must remove the credential file and revoke or rotate the dedicated credential separately. After local uninstallation, the installed copy, managed marketplace, and receipt may be removed.

## Development and verification

Development uses `npm ci --ignore-scripts` and the committed lockfile. `npm run build` bundles `src/index.ts` with runtime dependencies into `bin/cyclecloud-mcp.mjs`, targeting Node 20.19, without a source map or minification, and applies mode `0644`.

`npm run verify` runs, in order, formatting checks, ESLint, TypeScript checking, bundle generation, the Vitest suite, Python developer-reset tests, and `npm audit --audit-level=high`, stopping on failure. Python 3.9+ is required for the developer reset utility and its tests, not for normal plugin installation or runtime. `npm run test:coverage` is a separate optional command. Verification builds the ignored bundle; it has no dedicated full-history secret scanner or vendored canonical-schema validation suite. Manifest tests assert the package's specific expected declarations.

The development workflow verifies branches and PRs, packages the plugin, records source/checkout identity, and uploads a 14-day Actions artifact. `npm run release:prepare -- <version>` updates local manifest versions and drafts a version-specific changelog entry from non-merge commit subjects since the nearest reachable SemVer release tag. Mechanical release commits are filtered out. Maintainers review and edit the draft during release preparation; existing entries are preserved on reruns. Preparation does not commit any changes. The MCP handshake version is bundled from `package.json`.

Releases use version/changelog PRs and version tags. GitHub branch protection provides required checks and review policy; tag rules restrict release initiation and prevent tag changes. The single **Release** workflow runs on `v*` tag pushes. It validates SemVer, committed manifest versions and notes, and the exact tag-event commit. Stable commits must be reachable from the fetched default branch; prerelease tags may point to feature-branch commits. Annotated and lightweight tags are supported.

The read-only build job verifies the source and packaged installation, then transfers checksummed assets to a publishing job with `contents: write` and no dependency installation. Publication checks that the remote tag still identifies the verified commit and refuses existing releases/drafts. It uploads all assets and the selected committed changelog entry into a draft before publishing, compatible with GitHub immutable releases. Publication preserves existing tags. Prereleases never update latest stable.

A read-only post-release job exercises anonymous curl installation from the actual public assets (and the latest link when applicable), verifies installed version/commit metadata and both runtime copies, then initializes the bundled MCP server and lists its read-only tools. It uses a fake Copilot CLI and temporary credentials, not a personal login or a real CycleCloud connection. A failed post-release check does not roll back publication. `npm run package:release -- v<version>` builds assets locally; `npm run verify:release -- <tag> <commit>` rechecks a published release. See the [release guide](development.md#publish-a-release) for maintainer steps, repository settings, and recovery.

The test suite covers:

- Configuration defaults and invalid settings, credential-file ownership/type/modes, transport combinations, and missing-file example behavior.
- Plugin root separation, fixed startup errors, path sanitization, manifest contents, Node version declarations, and marketplace metadata.
- Wire normalization, case-collision rejection, safe counts, sorting, independent limits, and status bucket budgets.
- Issue severity filtering, bounded text, zero limits, unavailable-data degradation, and cancellation.
- Exact HTTP routes/query escaping/Basic authentication, redirects, status classification, malformed and oversized/decompressed JSON, timeout and cancellation behavior.
- Client-scoped custom-CA trust and certificate hostname validation using test-generated TLS material.
- Mutation cancellation, accepted and unknown outcomes, one follow-up read, and overlap rejection.
- MCP discovery in read-only and mutation-enabled modes, input defaults/validation, annotations, structured results, and fixed errors.
- A copied bundle launched over stdio without source or installed dependencies, protocol-only stdout, missing-configuration diagnostics, no plugin-root writes, and credential-canary checks on captured output.
- Installer and manual onboarding behavior with temporary homes and a fake Copilot CLI, including reruns, conflicts, unsafe destinations, and template validation.
- Developer deployment and restoration without changing credentials or registrations.

These automated checks do not imply exhaustive filesystem hardening, cross-platform certification, live-host approval verification, or live lifecycle testing.

### Testing a local bundle in an installed plugin

`npm run deploy` builds the checkout and replaces only the bundle at the default installed Copilot path. It saves the installed original as `cyclecloud-mcp.mjs.before-local-test` using exclusive copy, preserving that original across repeated deployments. Replacement stages a file beside the target and renames it into place. Required files must be regular files, not final-component symlinks.

`npm run restore` restores the backup and removes it without requiring a local build. Neither command changes manifests, registration, enablement, or credential files, and neither commits, pushes, or publishes. Restart the session/server after either operation. Restore before installing a new package so a subsequent restore cannot roll the update back.
