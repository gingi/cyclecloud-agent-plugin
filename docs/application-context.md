# Application context for authoring

`get_cluster_application_context` is read-only. Start with a compact overview, choose relevant targets, then request one detail section for one target. This avoids returning full mount/spec/parameter records for an entire cluster and reduces host-side large-output spill files. Host permission prompts and spill thresholds remain client-dependent; this cannot eliminate all outside-workspace read prompts.

## Inputs

| Argument      | Default                  | Meaning                                                                                                                                                                                           |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clusterName` | Required                 | Exact cluster identity, validated like other named-cluster tools.                                                                                                                                 |
| `view`        | `overview`               | `overview` or `details`.                                                                                                                                                                          |
| `targetNames` | All overview targets     | Optional 1–20 exact names for overview; **exactly one** required for details.                                                                                                                     |
| `section`     | `environment` in details | `environment`, `storage`, or `attachments`. Only allowed with `view=details`.                                                                                                                     |
| `installPath` | `/shared/apps`           | Absolute POSIX path, at most 1,024 Unicode characters; no dot segments, controls, malformed Unicode or leading `//`. Normalized for lexical mount comparison, never accessed locally or executed. |
| `targetLimit` | 10                       | Overview page limit, integer 1–20.                                                                                                                                                                |
| `itemLimit`   | 5                        | Detail-collection page limit, integer 1–10.                                                                                                                                                       |
| `offset`      | 0                        | Integer 0–1,000,000; overview target offset or detail-collection offset. Use returned `nextOffset`, not an assumed page size.                                                                     |

This changes the previous POC behavior: a call without `view` no longer returns detailed records or parameter values. Existing callers must opt into details and select one target/section. The tool name and read-only defaults are unchanged.

## Two-step use

Discover candidate targets:

```json
{ "clusterName": "demo" }
```

Read storage configuration for a selected installer:

```json
{
    "clusterName": "demo",
    "view": "details",
    "targetNames": ["scheduler"],
    "section": "storage",
    "installPath": "/shared/apps"
}
```

Read its attachment mapping and current specs:

```json
{
    "clusterName": "demo",
    "view": "details",
    "targetNames": ["scheduler"],
    "section": "attachments",
    "itemLimit": 5,
    "offset": 0
}
```

Read `environment` when platform, inheritance, locker or scheduler configuration is needed. For application authoring, retrieve it for the scheduler and selected compute/install targets before asking for Ubuntu or Slurm versions. Do not enumerate unrelated targets or sections.

## Results and paging

`context` includes the cluster identity/lifecycle, observation time, `evidence: "configured"`, `view`, selected `section` (details only), install path, source names, warnings, unverified runtime facts, and a `nextStep` hint. Source names identify attempted sources; availability flags establish which evidence was obtained.

- **Overview targets:** name, node/node-array kind, state, configured image, Slurm role/partition/HA, and a simple attachment parameter name if available. No nested mount/spec records or parameter values.
- **Environment details:** configured inheritance, image/VM selections, architecture, locker and selected Slurm settings (including `scheduler.version` when supplied). `platform` resolves the configured image through CycleCloud image-package metadata, or gives an unavailable warning. Inheritance/VM ordering is preserved.
- **Storage details:** mount names/paths/type/filesystem/disabled flag and volume mount/persistence/disabled metadata. `coversInstallPath` is a lexical check, not proof of a mounted or writable path; it is `null` when enablement or the mountpoint is unknown.
- **Attachment details:** configured project/spec/version/source-locker/order/additional flags, simple parameter reference, and the matching parameter's label and current specs. Raw expressions are not returned. `attachmentParameters` is omitted outside this section.

Collections have `available`, `items`, `total`, `returned`, `offset`, `nextOffset` and `truncated`. Missing data is distinct from an empty collection. Optional scalar metadata text treats missing, null, and empty strings as absent; required identifiers remain nonempty, and malformed or oversized text is still rejected. `truncated` means the response is not the entire collection (including when earlier pages exist); `nextOffset: null` means no further page after this one. Scalars are bounded to 256 Unicode characters. Item arrays use a 6 KiB serialized-byte budget in addition to count limits, so a page may contain fewer entries than requested. Identifiers are preserved, not shortened. Envelopes containing one target or parameter allow up to 24 KiB so their nested pages fit. These are per-page limits, not a promise about a particular host's spill threshold.

For more data, repeat the same view, target/section and limits with a needed collection's `nextOffset`. Detail collections share the supplied offset; siblings may have different cursors and overlap between calls. Follow each collection needed for preservation or shared-scope review; do not assume one cursor pages all siblings completely. Avoid fetching unrelated remaining pages.

Targets sort by name and dictionaries by key. Overview filtering precedes paging; `missingRequested` identifies names absent from the complete queried overview. Detail target identity must exactly match the requested name. `usedBy` is now a paged evidence collection, not a bare array with `usedByTotal`/`usedByTruncated`. It includes unselected definitions in the queried cluster, not all child clusters sharing root parameters. Unavailable shared-use evidence is explicit even when parameter/spec data is available.

If any definition in the queried cluster has a missing or non-simple attachment reference (such as a conditional expression), `usedBy.available` is `false` with an incomplete-coverage warning, rather than a list that omits unresolved potential users. This check covers the complete queried overview, regardless of the selected target or page. Inspect the template before assuming a single-target edit; paging cannot resolve these references.

## Configured platform resolution

Only environment details perform an additional image lookup. For the exact configured `image`, the tool queries `Package` records with `PackageType == "image"`, projecting only `Name`, `PackageType`, `Label`, `OS`, and `JetpackPlatform`. It does not guess from aliases such as `cycle.image.ubuntu22`, fetch arbitrary URLs, inspect nodes, or enumerate installed packages.

When matching records agree on OS and Jetpack platform, `platform` contains `available: true`, `source: "CycleCloud Package metadata"`, `os`, `jetpackPlatform`, `matchingRecords`, and `runtimeVerified: false`. A shared display label is included when consistent. Recognized versioned Linux Jetpack platform identifiers (Ubuntu, AlmaLinux, CentOS, SLES) additionally supply `distribution` and `release`; for example declared `ubuntu-22.04` yields Ubuntu release `22.04`. Unknown identifiers retain their declared metadata without an inferred release. Labels and image aliases are never parsed to invent a release.

A name can match multiple package revisions. The tool does not select a revision or confuse the package revision with the OS release: inconsistent or incomplete platform records leave resolution unavailable. Missing/custom images with no matching metadata, denied queries and malformed responses also leave `platform.available: false` while preserving the original image, Slurm version and other environment facts. Cancellation still propagates. Label strings are bounded to 256 characters, Jetpack platform to 128, and OS to 32; optional enrichment stays within the existing target envelope budget.

Use these **configured** values as the authoring baseline and record runtime validation separately. Do not ask the user to re-enter discovered Ubuntu or Slurm versions just because they are not runtime-verified. Compare the relevant targets, ask only about material conflicts or missing facts, and keep the OpenFOAM distribution/release as a separate application choice. A cluster-init project version is not the scheduler/application software version.

## Retrieval and safety

1. Validate cluster identity through the existing authenticated cluster-summary read.
2. Overview uses a fixed `/exec/query/` projection for standalone nodes/nodearrays (`Template === Name || IsArray === true`, excluding abstract records). It omits mounts, volumes, full specs and parameter values. Output paging happens locally; overview still reads the complete lightweight definition set.
3. Details add an exact escaped node-name predicate and select only the requested section. The backend returns that target's section; normalization validates it before paging. Environment details alone optionally resolve that target's image metadata as described above; other views do not fetch it.
4. Only attachment details read the lightweight overview again to identify shared parameter uses. If a simple reference exists, resolve the authenticated parent chain (at most ten visited clusters, cycle checked) and query only the matching `Cloud.ClusterInitSpecs` parameter in the root scope. No general parameter export is used.
5. Normalize with closed allowlists. Arbitrary configuration, mount options, accounting credentials, raw parameter values and raw expressions are not forwarded to the model. Locker/image identifiers reject URL/query/fragment forms. Returned text is still untrusted data.

HTTP bounds remain 8 MiB per response, per-request timeout/cancellation, no redirects and no automatic retries. These internal query/record contracts can vary by CycleCloud version. Source inspection and fixtures do not certify a running instance. Pagination reduces model output; it does not add backend pagination inside a mount/spec record or bypass HTTP bounds.

Primary identity/read failures remain tool errors. Failed/denied/malformed section queries yield explicit unavailable evidence. Parameter or parent-resolution failures preserve target details. Failed shared-use reads mark `usedBy` unavailable. Cancellation remains an error. Pages are not an atomic snapshot: configuration may change between calls, so re-read before editing.

## Authoring and lifecycle handoff

The skill generates project files and `ATTACHMENT.md` using only the relevant sections. Fully inspect needed existing-spec and shared-scope lists before recommending changes; if evidence remains partial, leave the handoff incomplete. Missing runtime facts include installed software/MPI, actual mount/writer readiness, Slurm accounts/jobs/launcher compatibility, uploaded artifacts, spec execution success and workload results.

The tool does not upload, attach, run installers, submit jobs, or alter lifecycle state. Existing start/terminate tools remain disabled by default and require separate approval. They are not an in-place restart, do not drain jobs, and do not prove installation or data survival.
