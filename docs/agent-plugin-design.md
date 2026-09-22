# CycleCloud Agent Plugin design

## Purpose and scope

The Azure CycleCloud Agent Plugin helps an agent inspect configured clusters and prepare application projects. It is a source-distributed collection of skills, inspection helpers, and authoring assets for Copilot CLI and Copilot in VS Code. It does not require a custom agent host, a VS Code extension wrapper, or a long-running service.

The plugin has two workflows:

- **Inspection:** return curated, bounded cluster inventory, configuration, capacity, issues, and application-authoring context.
- **Application authoring:** use that evidence to prepare reviewable cluster-init project files, a Slurm example, and publication/attachment instructions in the user's workspace.

Inspection is read-only. Uploads, cluster configuration changes, lifecycle operations, software installation, and job submission are separate actions requiring authorization. The authoring assets are deliberately incomplete; no OpenFOAM/platform/MPI combination is certified.

This is a proof of concept. Compatibility with a CLI installation does not establish compatibility with every server, identity provider, host environment, or application runtime.

## Architecture

```text
Copilot CLI / VS Code Agent Plugins
  |
  +-- inspect-cyclecloud skill
  |     |
  |     +-- host terminal tool and permission checks
  |           |
  |           +-- scripts/cyclecloud-inspect
  |                 |
  |                 +-- selected CLI environment and capability discovery
  |                       |
  |                       +-- compatible native: cyclecloud inspect ...
  |                       |
  |                       +-- supported 8.10 without inspect:
  |                             supervised Python worker
  |                               -> inspection readers and normalizers
  |                               -> CLI configuration/authentication adapter
  |                               -> bounded HTTP -> CycleCloud
  |
  +-- author-cyclecloud-application skill
        |
        +-- inspection workflow for configured evidence
        +-- host file tools -> project files in the user's workspace
        +-- Node/Bash checker -> structural and syntax results
```

The **host** owns skill discovery, terminal/file tools, approval prompts, and plugin installation. The **skills** describe how to choose commands, interpret evidence, and prepare files. The **inspection helper** implements deterministic input validation, backend selection, bounded reads, and result shaping. The **CycleCloud CLI** supplies the configuration, authentication components, and Python environment; CycleCloud enforces account permissions.

Skill prose guides the agent but is not a security boundary. Helpers execute with the OS user's permissions, and native CLI commands outside inspection can perform consequential operations.

## Source package and host lifecycle

`plugin.json` declares the `cyclecloud` plugin. `.github/plugin/marketplace.json` exposes it through the `cyclecloud` marketplace. The repository/package target is `cyclecloud-agent-plugin`.

The host loads skills from `skills/<name>/SKILL.md`. Each skill resolves helpers and assets relative to its installed location, not the current working directory or an assumed checkout. The plugin has no MCP server declaration, custom agent, hook, or credential-collecting installer.

Users register reviewed source through the host's native mechanisms. A local marketplace can be a live source directory rather than an installed copy, so it must remain at a persistent path. VS Code source registration and enablement are separate from Copilot CLI registration. WSL, remote workspaces, and containers must have a CLI installation accessible in the environment executing agent commands.

Updates refresh the reviewed source through the host while preserving deliberate disabled state. Uninstallation removes the plugin registration, not CLI credentials. No plugin-owned reset command edits host databases or deletes credentials.

Node.js is development tooling and runs the authoring checker; inspection and source-plugin installation do not require a Node server or runtime npm dependencies. The Python helper targets Python 3.8+, while the complete development suite uses Python 3.9+.

See [installation and usage](../README.md), [configuration](configuration.md), and [host troubleshooting](troubleshooting.md).

## Inspection entry point and module ownership

The stable agent-facing entry point is:

```sh
sh "<installed-plugin-root>/scripts/cyclecloud-inspect" COMMAND [options]
```

| Component                        | Responsibility                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/cyclecloud-inspect`     | POSIX entry point, help, executable selection, symlink resolution, and bootstrap into the selected CLI's sibling Python.                     |
| `scripts/inspect-bootstrap.py`   | Load the plugin's Python package under an isolated interpreter and enter the launcher or worker.                                             |
| `launcher.py`                    | Verify CLI installation identity, probe version/capabilities, select the backend, and publish bounded results and compatibility diagnostics. |
| `process.py`                     | Cumulative deadlines, bounded subprocess pipes, noninteractive input, cancellation, and owned process-group cleanup.                         |
| `worker.py`                      | Run the compatibility adapter with dependency output suppressed; publish only the encoded inspection result.                                 |
| `command.py`                     | CLI grammar, command dispatch, JSON envelopes, fixed error guidance, output limits, and exit codes.                                          |
| `contract.py`                    | Input validation, scalar/integer rules, deterministic ordering, JSON serialization, and byte budgets.                                        |
| `context_reader.py`              | Read orchestration, optional enrichment, target/section selection, and parent/shared-parameter discovery.                                    |
| `normalize.py`                   | Closed-field cluster, capacity, and issue normalization.                                                                                     |
| `application_context.py`         | Application evidence, bounded collection pages, configured mounts, specs, and attachment mappings.                                           |
| `image_platform.py`              | Exact image metadata interpretation without guessing OS releases from aliases.                                                               |
| `adapter.py`                     | Isolated 8.10-specific CLI configuration/authentication integration and read endpoint/query selection.                                       |
| `transport.py`, `body_reader.py` | URL/transport policy, bounded HTTP reads and decompression, and transport error classification.                                              |
| `errors.py`                      | Transport-independent failure categories and cancellation propagation.                                                                       |

Python module paths in the table are relative to `python/cyclecloud_agent_inspect/`. The core readers depend on a narrow client interface rather than installed CLI modules. Installed imports are isolated in the adapter and are not needed for local capability discovery.

## CLI discovery and backend selection

1. Select the absolute executable specified by `CYCLECLOUD_CLI`, otherwise `cyclecloud` on the agent process's PATH. An invalid override fails; discovery does not scan the filesystem, source shell profiles, or substitute another CLI.
2. Resolve the executable and use its sibling Python. Validate the console-script layout, interpreter/virtual-environment identity, `cyclecloud-cli` distribution metadata, package origins and recorded package hashes. Reject overlapping API SDK installations and unsupported layouts.
3. Run an offline, bounded `--version` probe and check it against the installed distribution's numeric version. Version compatibility errors identify the resolved executable and safely parsed reported version when available.
4. Probe `cyclecloud inspect capabilities`. Prefer native inspection only if it advertises the required schema and all required commands.
5. Use the compatibility worker only when a supported 8.10 installation returns the recognized missing-`inspect` diagnostic. A native authentication, permission, network, schema, or malformed-output failure does not select another backend.

`compatibility.json` declares the supported bridge family, recognized development/build labels, and native schema/command requirements. CLI product versions, plugin release versions, and inspection schema versions are independent. A newer CLI is not accepted merely because its version number is higher.

Capabilities do not load user configuration or credentials and do not contact CycleCloud. They establish local compatibility, not authentication or connectivity. Help is also available without a configured CLI.

## Result contract and evidence semantics

Data commands select `--schema-version 1` and emit one complete UTF-8 JSON document. A successful response has `schemaVersion`, `command`, and `result`; a failure has `error` instead of `result`. Exit codes distinguish success, operational failure, invalid arguments/schema, and cancellation. Help intentionally uses human-readable output.

| Command                    | Evidence                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `clusters`                 | Bounded, deterministically sorted cluster summaries and collection totals.            |
| `cluster NAME`             | Exact cluster identity, lifecycle state, configured fixed nodes, and node arrays.     |
| `status NAME`              | Capacity/buckets and optional grouped node errors/warnings.                           |
| `application-context NAME` | Configured targets followed by selected environment, storage, or attachment evidence. |

The bridge validates consumed fields and rejects ambiguous duplicate field variants. It distinguishes absent data from empty collections, validates rows before applying return limits, preserves configured precedence where order has meaning, and reports truncation explicitly. Issue counts describe conditions, not necessarily distinct affected nodes.

Primary read failures are errors. Optional enrichment failures produce unavailable evidence, not successful empty collections. Cancellation propagates rather than being disguised as missing optional evidence. The bridge's field allowlists exclude credentials and arbitrary configuration dumps; fixed error handling suppresses raw server errors and subprocess tracebacks.

Native results are checked for the accepted envelope, schema, command, error shape, JSON validity, and output bounds. **The launcher does not currently validate every native command's result fields.** Native schema claims therefore need conformance testing, not just capability negotiation. The portable fixture corpus records required normalization behavior; it is not certification of a future native implementation.

See [the CLI contract](cli-contract.md) for exact flags, limits, error categories, and versioning rules.

## Application context and authoring

Application context uses a progressive workflow:

1. Request a compact overview and select relevant targets.
2. Request details for exactly one target and one section: `environment`, `storage`, or `attachments`.
3. Follow a collection's `nextOffset` only when its remaining entries are needed. Preserve the target, section, limits, and any custom installation prefix across requests.

Environment details expose configured platform and scheduler facts. Storage details compare the proposed installation prefix with configured mountpoints; they do not inspect live mounts. Attachment details describe specs, parameter references, inheritance, and known shared uses. Parameter scope can involve parent clusters; reported shared uses do not prove that no other descendants are affected.

The **local project directory** and **cluster installation prefix** are distinct. `/shared/apps` is the default prefix on cluster nodes, not a directory to access or create on the agent host. The skills omit `--install-path` for that default and pass an explicit, quoted value for a custom prefix. Some hosts conservatively treat path-shaped shell arguments as local access; omitting a redundant default reduces unnecessary prompts without disabling permission checks.

The authoring skill reuses configured OS and Slurm versions as an explicit baseline, asks about missing/conflicting evidence and application choices, and writes reviewable files in the workspace. It does not treat configuration as proof of runtime readiness. Its handoff includes project publication, attachment mappings, rollout considerations, and separate verification steps.

The bundled Node checker examines the fixed skeleton layout, unresolved TODO markers, and Bash syntax. It never runs installation scripts or jobs. A passing check is not metadata, security, MPI, or application certification; the unfinished skeleton intentionally fails until completed.

See [application-context semantics](application-context.md) and [the authoring guide](application-authoring.md).

### Application context retrieval

The portable reader inputs use `clusterName`, `view`, `targetNames`, `section`, `installPath`, `targetLimit`, `itemLimit`, and `offset`. `command.py` maps the positional cluster name and CLI flags to these fields; `contract.py` validates them. The public [input reference](application-context.md#inputs) uses CLI argument names.

1. Validate cluster identity through the authenticated cluster-summary read.
2. Overview uses a fixed `/exec/query/` projection for standalone nodes/nodearrays (`Template === Name || IsArray === true`, excluding abstract records). It omits mounts, volumes, full specs, and parameter values. Output paging happens locally; overview still reads the complete lightweight definition set.
3. Details add an exact escaped node-name predicate and select only the requested section. The backend returns that target's section; normalization validates it before paging.
4. Environment details alone optionally query `Package` records for the exact configured image with `PackageType == "image"`, projecting only `Name`, `PackageType`, `Label`, `OS`, and `JetpackPlatform`. Other views do not fetch image metadata.
5. Attachment details read the lightweight overview again to identify shared parameter uses. If a simple reference exists, resolve the authenticated parent chain (at most ten visited clusters, cycle checked) and query only the matching `Cloud.ClusterInitSpecs` parameter in the root scope. No general parameter export is used.
6. Normalize with closed allowlists. Arbitrary configuration, mount options, accounting credentials, raw parameter values, and raw expressions are not forwarded to the model. Locker/image identifiers reject URL/query/fragment forms. Returned text is still untrusted data.

Selective retrieval and bounded pages reduce model output and host-side large-output spill files, but do not guarantee a particular host's spill threshold or eliminate permission prompts. Pagination does not add backend pagination inside a mount/spec record or bypass HTTP bounds. Internal query/record contracts can vary by CycleCloud version; source inspection and fixtures do not qualify a running instance.

## Authentication, transport, and execution boundaries

- **One configuration authority:** use the selected CLI's normal configuration, optionally an existing `--config` file. The plugin does not initialize profiles, request passwords in chat, or maintain a second credential store.
- **Noninteractive authentication:** the 8.10 adapter integrates Basic authentication and the CLI's public-client silent, confidential-client, and managed-identity components. Silent refresh may persist normal CLI cache/configuration state. Interactive login is a separate operator step.
- **Explicit transport policy:** preserve the CLI's configured certificate/proxy/CA behavior without silently weakening it. An insecure existing CLI configuration remains insecure. Identity sessions are separate and do not inherit CycleCloud credentials or insecure certificate overrides.
- **Bounded reads:** each HTTP response is capped at 8 MiB of wire data and 8 MiB after decompression. Unsupported/chained encodings, redirects, and automatic inspection retries are rejected or disabled. Identity traffic shares bounded transport/process budgets.
- **Bounded results:** complete stdout is limited to 1 MiB. Application collection pages and selected-target/parameter envelopes have smaller limits; capacity output has an overall returned-bucket bound. Overflow is an error, not partial JSON.
- **Bounded execution:** the invocation has a 120-second cumulative deadline, shorter discovery probes, and 10/30-second connect/read-idle limits. Subprocess pipes are bounded; input is noninteractive. Cancellation and cleanup reap owned process groups.
- **Isolated imports and output:** Python runs with isolated import settings and bytecode writes disabled. The compatibility worker suppresses dependency stdout/stderr at the descriptor level and publishes only the curated response.
- **Untrusted evidence:** returned diagnostic strings, names, and configuration values are data, not agent instructions. Host approvals and least-privilege CycleCloud accounts remain necessary.

The inspection wrapper does not restrict everything an agent can do through terminal tools. Do not broadly approve `cyclecloud *` or infer permission for lifecycle operations from permission to inspect.

## Packaging, releases, and verification

The source packager copies an explicit allowlist: manifests, compatibility policy, Python modules, launchers, skills/assets, public documentation, and license. It rejects symlinked/non-regular package paths and excludes credentials, bytecode, dependencies, tests, and developer-only files. Package verification checks exact contents, identity, executable modes, provenance metadata, and isolated launcher smoke behavior after relocation.

Releases contain two assets: a versioned source archive and `SHA256SUMS`. `SOURCE_COMMIT.json` records the source identity inside the archive. Release automation validates tag/version/commit constraints, stages assets through the hosting provider, and verifies anonymous downloads without forwarding authentication tokens. Verification checks checksum inventory and hashes, rejects unsafe archive entries before extraction, checks source identity and contents, and runs bounded launcher smoke checks. The latest-release check reads latest checksums while keeping the archive URL pinned to the expected tag.

Checksums detect corruption and inconsistency; they are not publisher signatures. Package tests and launcher smoke do not establish successful installation or agent behavior in a real host. Exact previews/releases require a reviewed extracted source directory; repository registration follows the repository's source rather than automatically selecting a preview asset.

Verification layers are intentionally separate:

- Portable golden fixtures preserve normalization and evidence semantics, with synthetic inputs and recorded provenance.
- Python boundary, adapter, transport, process, and launcher tests cover failure paths and resource limits.
- JavaScript tests cover source packaging, publication guards, release downloads, authoring checks, and skill guidance.
- Opt-in packaged-CLI tests use synthetic configuration and a local fake backend, not real credentials or a live CycleCloud instance.
- Host registration, live identity services, supported server combinations, platform execution, and model-backed skill behavior require separate authorized checks.

See [development and release procedures](development.md) for commands and recorded qualification limits.

## Native CLI evolution

The intended next ownership step is to move the inspection core and its fixtures into the CycleCloud CLI. Skills continue to use the plugin launcher, which can select compatible native inspection without changing the agent-facing contract. The bridge remains while 8.10 is supported; its removal requires an explicit minimum-CLI decision.

Required-field, type, or meaning changes require a new inspection schema major. Compatible optional additions can remain within the existing schema. Before native support is qualified, run the shared semantic fixtures and command-level conformance checks against it, including argument defaults, pagination, errors, and exit behavior. Avoid independently maintained normalizers with divergent semantics.

Current qualification evidence and outstanding environment checks are recorded under [verification status](development.md#verification-status). Capability discovery and a successful local snapshot test do not substitute for native conformance testing.

## Application authoring evolution

The bundled project is an incomplete authoring skeleton. To qualify a runnable application example:

1. Select and document one OpenFOAM release, OS/architecture, and MPI stack.
2. Implement installation and runtime preparation with pinned sources, checksums, versioned staging, a single-writer readiness protocol, and recovery behavior.
3. Replace the Slurm stub with a small real case and explicit success criteria.
4. Add metadata/permission and application-specific checks without treating syntax validation as runtime compatibility.
5. Evaluate the skill in both hosts, including offline and existing-file cases, using the [authoring evaluation procedure](development.md#application-authoring-evaluation).
6. With separate authorization and an appropriate test cluster, verify installation and serial/parallel execution. Record actual observations and limitations.

Automated locker publication, spec attachment, existing-node rollout, and job submission are separate potential workflows. Keep product operation semantics in the CycleCloud CLI; skill prose alone is not an implementation or an authorization boundary.
