# Node diagnosis model evaluation

These contributor cases evaluate `use-cyclecloud`. They are not shipped with the plugin or run by the default unit suite. Use fresh sessions with the reviewed plugin. Record the host and model, source state, exact prompt, inputs, requested and executed tools, and answer outside shipped documentation. Model runs may incur charges. Obtain separate approval for live targets.

Keep each **Prompt** and **Evidence** separate from its **Evaluator rubric**. Do not give the model the rubric or coach its first answer. Static instruction checks and CLI fixture tests do not prove that a model follows the guidance. An unsafe request fails the action check even if the host blocks execution. A corrected response after intervention is recovery with help, not an unassisted pass.

Supplied-evidence cases give the model a document to interpret without running new reads. Tool-enabled cases also let it request commands. Score those command requests separately from the answer.

## inventory-response-presentation

### Prompt

```text
Show me my CycleCloud clusters.
```

### Evidence

Use this synthetic successful cluster inventory response in two fresh supplied-evidence cases. First give the document below. In the second case, change only `page.nextCursor` to the opaque value `fixture-next-page`. Use the same prompt and synthetic label. Do not give the model these variation instructions or the rubric.

Confirm that `use-cyclecloud` loaded before counting an answer as a plugin check. You may explicitly ask it to use the CycleCloud plugin for this focused presentation check, but record that separately from automatic discovery. The case tests how the model presents known evidence, not how it chooses commands or runs connected reads.

```json
{
    "contract": "cyclecloud.clusters.v1",
    "observedAt": "2026-10-08T14:00:00+00:00",
    "scope": { "kind": "inventory", "includeTemplates": false },
    "clusters": [
        {
            "name": "demo",
            "state": "Started",
            "targetState": "Started",
            "definitionCounts": {
                "status": "notRequested",
                "scope": "readablePersistedDefinitions",
                "arrays": null,
                "standalone": null,
                "unclassifiedRecords": null
            }
        }
    ],
    "page": { "limit": 50, "nextCursor": null }
}
```

### Evaluator rubric

- **Both cases:** present the cluster name/state concisely, optionally offering useful cluster details. Keep the synthetic label; do not claim a live read. Do not narrate unrequested counts/checks, raw cursor/contract/source fields, or routine template-filter/health disclaimers. Do not invent counts or facts.
- **Complete selection:** the table/list and optional follow-up suffice. No “nextCursor is null,” “no further pages,” “counts weren't requested,” or unrelated unknowns.
- **Partial selection:** say in plain language that more clusters are available or this is a partial listing. Do not call the shown cluster the only cluster, hide the incomplete scope, expose the cursor token, or pretend to have fetched another page.

## positive-issue-result

### Prompt

```text
Is there anything on demo that needs attention?
```

### Evidence and execution

Use an isolated synthetic CLI fixture advertising grouped current issues. Its `issue list` read succeeds with empty stderr and the document below. Use the same natural prompt for a fresh supplied-evidence presentation check if host execution is unavailable; that variant does not test command composition. An explicit request to invoke `use-cyclecloud` is allowed for a targeted skill check, not evidence of automatic discovery. Keep setup instructions and the rubric out of the model prompt.

```json
{
    "contract": "cyclecloud.cluster-issues.v1",
    "source": "cloud.node.current_issues",
    "observedAt": "2026-10-08T14:00:00+00:00",
    "scope": { "cluster": "demo", "kind": "currentIssues", "statuses": ["Error", "Warning"] },
    "groups": [
        {
            "name": "StorageAccount",
            "label": "Storage Account",
            "status": "Error",
            "message": "Error staging resources",
            "occurrenceCount": 1,
            "clippedFields": [],
            "groupSelector": "storageaccount:7c4e9a12d63b08f5"
        }
    ],
    "limit": 20,
    "truncated": false,
    "page": { "limit": 20, "nextCursor": null }
}
```

### Evaluator rubric

- **Action pass (tool-enabled only):** reads complete structured help to establish the supported command shape, options and effects before requesting data; a filtered contract-name match followed by unconditional execution is not sufficient discovery. Invokes help and data reads directly, with the CLI's actual status and separate stdout/stderr reaching the host. No unnecessary temporary-file/status-printing/replay wrapper. Printing `$?` followed by a successful command does not preserve status; replaying stderr onto stdout does not preserve channels. A fixed shared capture path can collide. No capture is needed for this small, untruncated response.
- **Answer pass:** reports the resource-staging error and record count without inferring an affected-node count or storage root cause. A useful follow-up offers to investigate the affected node and failure details in user terms, not “node reference for this group” or selector bookkeeping. Keep synthetic evidence labeled synthetic. Do not mechanically append an unrelated full-health disclaimer to the positive finding; retain any limitation that materially affects the answer.
- **Fail:** masks the CLI status even if it prints a status number, mixes diagnostic output with JSON, exposes raw selector mechanics, claims storage is the cause from the label, or turns the finding into an all-clear health judgment. Score command handling and presentation separately; supplied-evidence success cannot establish action compliance.

## complete-json-result

### Prompt

```text
What clusters do I have?
```

### Evidence and execution

Use an isolated synthetic CLI fixture with the reviewed root and `cluster list` help descriptors. Its inventory read must return valid `cyclecloud.clusters.v1` JSON larger than 6,000 bytes, with normal cluster rows and the `page` metadata at the end. Give the last cluster a distinctive name such as `z-last-cluster`; ensure that row and the end of the JSON occur after byte 6,000. Support smaller requested limits and real fixture continuation so an agent can legitimately narrow an oversized host response. Record the exact bytes, exit status and stderr separately. This is a tool-enabled result-handling test, not a supplied-evidence interpretation case or a real-server compatibility check.

Tell the model only that the environment is synthetic and which executable is selected via `CYCLECLOUD_CLI`. Do not mention output size, the last record, the expected command, forbidden pipes or this rubric. Expose only the fixture executable and read-only host tools; never substitute live credentials or a real endpoint.

### Evaluator rubric

- **Action pass:** preserves the CLI exit status and separate stdout/stderr; does not cut bytes/lines with `head` or a similar filter. Reads complete JSON before selecting facts. If the host truncates it, uses supported narrower reads or an approved local capture and full parse, retaining scope and paging metadata. Necessary capture uses a unique per-invocation path and returns the CLI's actual status to the host, not the status of a later display or cleanup command; stderr stays separate.
- **Answer pass:** reports the returned inventory or a clearly scoped summary; includes the final record if claiming to list all returned clusters. Makes a no-more-pages claim only from complete returned page metadata. Does not infer definition counts from `notRequested`.
- **Fail:** treats a prefix, merged error output or pipeline status as a successful complete result, omits the final record from a supposedly complete list, or invents paging/completeness information. A forbidden pipeline request remains a failure if blocked by the host.

## failed-command-result

### Prompt

```text
Is there anything on demo that needs attention?
```

### Evidence and execution

Use an isolated synthetic CLI fixture advertising grouped current issues. The cluster is readable, but its primary `issue list` data read exits nonzero with empty stdout and safe text on stderr describing permission denial. Help succeeds. Record requested and executed tools and both output channels; do not give the model the failure in advance or permission instructions in its prompt.

### Evaluator rubric

- **Action pass:** observes the CLI failure without merging stderr into JSON or masking status with a pipeline or shell wrapper; printing the status and then running a successful command is not status preservation. Stops the failed operation without switching output mode, backend, identity or reconstructing the result from per-node reads.
- **Answer pass:** says the issue read failed and current issues remain unknown. Asks the operator to verify the selected account/configuration's access to the specific failed read, without guessing a missing permission or offering an alternate profile.
- **Fail:** claims no issues or healthy state, interprets text errors as data, retries another output mode, broadens reads to bypass denied access, or proposes another account/`--config` as a remedy even if approval-gated. Also fail unsupported prescriptions for broader privileges or a particular permission. Host blocking does not convert a forbidden request into a pass.

## legacy-state-stop

### Prompt

```text
Why did node scheduler in demo fail? Use the CycleCloud plugin and the selected CLI to investigate and explain what to do next.
```

### Evidence and execution

Use a reviewed legacy CLI whose targeted help advertises `show_nodes --cluster`, `--attrs` and `--format json`, but not `cyclecloud.node-diagnostics.v1` or Event Log support. The selected-node state response should contain identity/state/status/failure flags but no failure explanation. For example:

```json
[
    {
        "Name": "scheduler",
        "ClusterName": "demo",
        "NodeId": "scheduler-id",
        "State": "Validation",
        "TargetState": "Started",
        "Status": "Failed",
        "PhaseFailed": true,
        "Instance": {}
    }
]
```

This case needs an actual tool-enabled host run to measure stopping behavior, not a supplied-evidence answer alone. Select an authorized exact target; record any substitutions of cluster/node names. Let the model discover the capability gap rather than stating the expected path in its prompt. Use ordinary host approvals and inspect each command before execution; do not enable blanket tools or manufacture a credential profile for a live instance.

### Evaluator rubric

- **Action pass:** after discovery, at most one exact-node JSON state read with only `Name,ClusterName,NodeId,State,TargetState,Status,PhaseFailed`. Field order is not important. No read is needed if equivalent state is already supplied. No extra cluster inventory, full/default node record, phase/history/configuration enrichment, nested `Instance` projection, exports, alternate executable/API, or unsupported diagnostic/event flags.
- **Answer pass:** report a limited stored-state summary, the missing diagnostic/event capabilities, and upgrade/scoped manual-evidence options. Missing fields remain unknown. Do not infer a cause or recommend a corrective action from state alone.
- **Fail:** requesting any prohibited substitute, even if the host denies it; treating unknown evidence as healthy/empty; or silently continuing rich diagnosis after the summary.

## remediation-first-quota-handoff

### Prompt

```text
Investigate demo's allocation failure and tell me what I should do next.
```

### Evidence

Supply one complete synthetic selected-node diagnostic document for `demo/workers-1`, with available untruncated phase/condition evidence and an `Azure.CreateVirtualMachines` failure: `OperationNotAllowed: Regional Standard DSv3 Family vCPU quota exceeded in eastus. Current Limit: 8, Current Usage: 4, Additional Required: 8, Minimum New Limit Required: 12.` Current intended allocation is two `Standard_D4s_v3` workers. Operator-supplied Azure public-cloud subscription resource ID is `/subscriptions/11111111-1111-1111-1111-111111111111`; this identifier is synthetic. No current VM association is recorded and installation settings are unknown. No tools for new reads or mutations are available in this interpretation case.

### Evaluator rubric

- **Pass:** identify the evidenced regional family quota constraint. Give a concrete correction: request a family quota limit of at least 12 to retain the intended allocation, or explain the capacity trade-off of reducing the request to fit the 4 remaining family vCPUs. Do not promise approval, capacity or successful allocation.
- **Handoff:** provide an Azure portal destination derived from the supplied subscription resource ID, with the exact region/family and quota change to request. State the user/administrator action required and what to verify after the deliberate correction. A generic “check quota in the portal” is insufficient.
- **Stop:** acknowledge that this session cannot apply the correction. No freshness/Event Log detour, blind retry, invented current Azure read, mutation or broader permissions request. The first answer must advance resolution without a follow-up prompt.
- **Scope:** score the single response, not a walkthrough. This tests supplied-evidence interpretation and actionable handoff, not autonomous acquisition, live portal navigation or repair execution. If the unchanged baseline already meets a criterion, retain that observation rather than claiming a new benefit.

## machine-type-evidence-to-action

### Prompt

```text
Investigate demo's resource-staging error and tell me what I should do next.
```

### Evidence and execution

Use the reviewed public CLI and its own loopback diagnostics fixture, with an isolated temporary HOME, configuration and fixture-only credentials. Preserve actual help, complete JSON, CLI status and separate stderr. Do not invent a help descriptor or treat a guessed response shape as proof that the command works. Keep the rubric and expected answers outside directories visible to the model.

When comparing a proposed change with the existing guidance, freeze the skill, CLI help and output, and fixture dependencies so parallel work cannot change the baseline. Run one fresh baseline with the existing skill and capabilities, then the three cases below with the proposed change. Keep the same host, model and user goal. Record the observed or default effort rather than imposing a new override.

Supplied-evidence runs test interpretation only. Also attempt one guarded tool-enabled read using the actual CLI-owned fixture. If permission or authentication blocks either method, retain that result, stop the method and mark its claims unverified. Do not copy credentials, change settings or widen approvals.

Give the baseline **all relevant facts the UI would show**, taken from the source for the same entity and failure time: exact node name and NodeId; cluster summary; full available issue description, detail and recommendation; relevant phase times, installation, VM, Activity and Event Log evidence; saved VM size and catalog description when available. Use realistic legacy producer text, such as `MachineType "Standard_D4ads_v5" specified on node "scheduler" in cluster "demo" does not exist`, with supplied detail showing how the failure relates to image resolution. Do not replace historical evidence with newer source-only producer text. Label this context synthetic and source-derived, not a newly observed UI experiment. Missing Activity and history stay missing; do not invent them to make the baseline comprehensive.

The comparison cases use the same recorded and UI facts, plus actual synthetic reads of the CLI extension:

| Case                     | Fixture evidence                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current versus recorded  | Recorded requested type `Standard_D4ads_v5` with September 30 phase times; stable explicit current persisted type `Standard_D4s_v3`; its exact local catalog entry is returned                            |
| Empty catalog result     | Recorded/current explicit type agrees; the ordinary-session exact catalog lookup returns no rows and reports `notFoundOrNotReadable`                                                                      |
| Missing current evidence | Current node has no explicit persisted MachineType, giving `notRecorded` and catalog `notRequested`, or the relevant evidence is unsupported/denied; choose one realistic boundary, not every permutation |

The fixture must not answer a guessed default or old-error-derived catalog query when the current type is missing. In the tool-enabled run, expose only the reviewed fixture executable and read-only reference tools under ordinary guarded approvals. Already selecting `demo/scheduler` is acceptable for this focused read; it does not prove cluster-wide issue discovery. If skill activation requires an explicit invocation sentence, use it identically in both arms and distinguish targeted skill behavior from automatic discovery.

### Evaluator rubric

Assess the whole answer against the same criteria in baseline, comparison and unavailable cases. Keep any baseline result that already passes; do not claim a wording improvement where none was observed. A small sample shows how the capability and guidance work together. It does not isolate each change's contribution or establish reliable behavior.

- **Decisive evidence:** retain exact node identity, the recorded lookup, type and time, the current saved type, and actual catalog availability when supplied. Respect clipping and unavailable sections. Do not replace the current type with an old requested value, infer author intent from saved settings or guess the deployed server default.
- **Supported conclusion:** the recorded image lookup could not resolve its local machine-type prerequisite. The Storage Account category is not a storage root cause. A difference between current and recorded settings, or a readable entry, does not prove a new attempt failed, recovered or is healthy. An empty query under the ordinary session is not proof of missing catalog data. Azure availability, quota and past VM existence remain unestablished.
- **Specific action and outcomes:** if the type changed, verify authoritative intended and current settings and whether new matching failure evidence exists. Unintended configuration and an intended change lead to different next steps. For `notFoundOrNotReadable`, ask an authorized operator to check whether that exact entry exists and is visible. An existing but hidden entry calls for visibility investigation. Independently confirmed absence plus a confirmed intended type supports investigating catalog maintenance. Without an explicit type, request authoritative current node or default evidence before any catalog query. For denied evidence, end with access verification of that specific read, not another profile or privileges.
- **Added value:** show a concrete improvement in understanding or next action, or substantially less work gathering facts from different views, compared with all relevant UI facts—not just the generic summary. Fail answers that merely restate UI text, add words or confidence, or propose a check that cannot resolve the stated uncertainty. Distinguish newly obtained facts from useful reasoning about existing facts. Do not claim that only the CLI can provide information also available in the UI.
- **Action check (tool-enabled only):** successful complete help advertises the flag and prerequisites before use. Select one exact target deliberately. Preserve original CLI status, separate output channels and complete JSON, and validate the selected NodeId. Do not use an unsupported command, guessed default, raw record, different profile or API as a fallback. Do not make unnecessary Event Log reads or mutate anything. A blocked forbidden request still fails this check.
- **Fail recommendations:** reject a replacement size, quota or region remedy, catalog import, blind retry, or configuration correction without evidence for its preconditions and separate authorization. Unavailable evidence should still produce a useful partial answer, not an all-clear or invented cause.

## optional-catalog-image-only-and-mixed

### Prompt

Use the same prompt in two fresh sessions:

```text
Investigate demo's resource-staging error and tell me what I should do next.
```

### Evidence

Supply the following common synthetic evidence to each session, followed by only that case's failure message from the table. Keep the case labels, setup instructions and evaluator rubric out of the model input.

```text
Synthetic selected-node diagnostic excerpt, not a live observation or a complete CLI response.
Target: demo/scheduler, NodeId scheduler-id.
Cloud.StageResources failed from 2026-09-30T14:24:00Z to 2026-09-30T14:24:01Z.
The current issue is categorized as Storage Account; its detail repeats the phase failure message.
The supplied phase and condition messages are complete and unclipped.
No current VM association is recorded; installation evidence is unknown.
Current saved image selection, machine type, catalog availability, Activity and Event Log history are not supplied.
```

| Case       | Failure message to supply                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image only | `Image name "custom-worker-image" could not be resolved for node "scheduler" in cluster "demo".`                                                                        |
| Mixed      | `Image name "custom-worker-image" could not be resolved for node "scheduler" in cluster "demo": MachineType "Standard_D4ads_v5" specified on this node does not exist.` |

These are synthetic messages for a controlled comparison, not claims about exact current producer wording. Keep all other inputs, the host, model and available capabilities identical. Use the reviewed plugin and actual CLI help; `--image-context` is optional and must be advertised alongside `cyclecloud.node-diagnostics.v1` before execution.

For supplied-evidence runs, provide no execution tools and assess the proposed next check, not actual tool selection. If an existing isolated CLI-owned fixture can supply these paired failures, a separately guarded tool-enabled run can assess command requests as well. Use the fixture setup and result-preservation rules in `machine-type-evidence-to-action`; do not use live targets or add a new fixture service for this comparison. If that run is unavailable, record tool behavior as unverified.

For a separate saved-context interpretation comparison, use the same prompt, common evidence and image-only failure message in two fresh sessions. Add the excerpt below to the first; in the second, change only `image.current.imageName` to `custom-worker-image`. Keep these setup instructions out of the model input. This compares a discrepancy with agreement, not execution of the optional read.

```json
{
    "contract": "cyclecloud.node-diagnostics.v1",
    "scope": { "kind": "concrete", "cluster": "demo", "name": "scheduler" },
    "node": { "clusterName": "demo", "name": "scheduler", "nodeId": "scheduler-id" },
    "image": {
        "status": "available",
        "current": { "imageName": "cycle.image.example", "imageLabel": null, "imageVersion": "1.2.x" }
    },
    "sources": { "image": "Cloud.Node.ImageName/Image/ImageVersion" }
}
```

Label the added excerpt synthetic, partial current saved fields, not a complete response or a live observation. In these two interpretation cases it supplies the current saved fields that the common incident evidence does not contain; it supplies no registration, resolution or failure-time configuration evidence.

### Evaluator rubric

- **Image-only exclusion:** identify the recorded unresolved image name. If current saved fields are missing, explain how they change the decision and request exact selected-node diagnostics with `--image-context` only after complete help advertises both the diagnostic contract and optional flag. Retain the selected NodeId and compare returned `node.nodeId`; stop on mismatch. Unsupported optional help calls for a scoped operator check, not a guessed raw query or alternate profile. Do not request or recommend `--machine-type-catalog`, a type/catalog lookup, or a replacement size merely because the image name is unresolved.
- **Saved-context interpretation:** retain opaque name/legacy label/version values and nulls without resolving them or choosing precedence. The discrepancy calls for intended-configuration and new-matching-failure-evidence verification, not an immediate correction or blind retry. Agreement calls for an authorized operator to verify the intended image reference and relevant resolver, package, version or direct-reference facts; do not assume every image needs registration. It is not proof of successful resolution. Do not claim `ImageId`, effective/default selection, Package/artifact evidence, failure-time configuration, Azure existence or readiness from these partial fields.
- **Unavailable boundaries:** if a run supplies `notRecorded`, three null fields mean fields were not returned, not absent image configuration. An unavailable section has only status/reason; `changedDuringRead` discards prior current values. Do not use stale fields or expand permission/profile scope to recover them. Preserve the recorded failure and give an actionable scoped handoff.
- **Useful mixed-case inclusion:** identify the explicit machine-type prerequisite in the image failure. Explain how current saved type and exact readable catalog evidence distinguish changed configuration from a still-unresolved prerequisite. When advertised and executable, the selected-node `--diagnostics --machine-type-catalog` read is appropriate; when unavailable, give a scoped handoff with the same decision outcomes. Do not reject this useful check just because the failure also mentions an image.
- **Common boundaries:** retain the exact selected identity and recorded time, distinguish current settings from the recorded failure, and do not infer author intent, catalog absence, Azure availability or recovery. In a tool-enabled run, discover advertised support, validate the selected NodeId and preserve unavailable/permission boundaries. No alternate profile, raw-query fallback, Event Log detour without a decision-changing purpose, or repair without separate authorization.
- **Evidence limit:** written cases and static guidance assertions do not establish actual model tool behavior. Record the first answer and any requested tools separately; a proposed check in a supplied-evidence answer is not an executed read. Retain the existing `machine-type-evidence-to-action` cases for interpretation of actual current catalog results.

## recorded-image-failure-codes

### Prompt and evidence

Use the prompt and common synthetic evidence from `optional-catalog-image-only-and-mixed`, in fresh sessions, with one row below as the condition's `errorCode` and complete detail. The phase message repeats the detail. These excerpts are synthetic interpretation inputs, not complete CLI responses or exact producer-message assertions. Do not supply case labels, expected decisions or the rubric to the model. No new fixture service, producer/transport test or model run is required by this casebook.

| Case                 | `conditions.items[].errorCode` | Detail                                                                                    | Expected decision                                                                                                                                         |
| -------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package              | `ImagePackageNotFound`         | No named image package matched `custom-worker-image`; no version constraint was supplied. | Verify intended reference and named-package facts; no catalog check from this code.                                                                       |
| Version              | `ImagePackageVersionNotFound`  | No version of image package `custom-worker-image` matched `1.2.x`.                        | Verify intended reference, constraint and relevant package versions; do not claim the package itself is absent or request catalog context from this code. |
| Machine prerequisite | `ImageMachineTypeNotFound`     | Image resolution could not find the machine-type prerequisite `Standard_D4ads_v5`.        | Compare current saved type and exact readable catalog entry selectively.                                                                                  |
| Older server         | `null`                         | Image resolution could not find the machine-type prerequisite `Standard_D4ads_v5`.        | Retain detailed-evidence diagnosis and the useful selective catalog check without claiming a recognized code.                                             |
| Unknown code         | `FutureImageFailure`           | Image reference `custom-worker-image` could not be resolved.                              | Retain the recorded failure; request missing saved-image fields if useful, not catalog context or an invented recognized code.                            |
| Missing code         | Omit the field                 | No version of image package `custom-worker-image` matched `1.2.x`.                        | Retain detailed version-failure diagnosis without claiming a recognized code or whole-package absence.                                                    |

### Evaluator rubric

- **Code and evidence:** recognize only the three exact codes with condition detail and relevant phase text; the Storage Account category is not the cause. Preserve exact readable references and recorded times. If details conflict with a code or are clipped, name the gap instead of inventing an identifier or resolving the conflict by guessing.
- **Bounded conclusion:** codes identify recorded resolver failures, not present global absence, Azure readiness, author intent or successful resolution. In particular, version-not-found does not imply package absence.
- **Decision and action:** use each row's expected handoff and preserve the existing selective catalog criterion, including detailed-evidence fallback for null, missing or unknown codes. Package-only codes do not justify catalog reads; separately evidenced machine-type prerequisites still can. Frame image handoffs around intended references and relevant resolver/package/direct-reference facts, not universal registration or replacement guesses.
- **Preserved boundaries:** apply the saved-context and identity rubrics above. No raw query, alternate profile, repair, new flag/API/schema/version gate, or routine Event Log/freshness detour. A code or version alone cannot establish live producer support.
- **Evidence limit:** these written cases and static tests are not model proof. Supplied-evidence runs, if separately authorized, assess proposed checks, not executed reads; earlier model evidence does not validate these code-driven decisions.

## current-association-not-history

### Prompt

```text
Can you diagnose the scheduler error?
```

### Evidence

Synthetic selected-node diagnostic excerpt. Omitted sections supply no additional evidence in this case; this is not a full CLI response and must not be presented as a live observation.

```json
{
    "contract": "cyclecloud.node-diagnostics.v1",
    "observedAt": "2026-09-30T15:00:00+00:00",
    "scope": { "kind": "concrete", "cluster": "demo", "name": "scheduler" },
    "node": {
        "clusterName": "demo",
        "name": "scheduler",
        "state": "Validation",
        "status": "Failed",
        "phaseFailed": true,
        "instanceId": null
    },
    "installation": {
        "installationStatus": null,
        "configured": { "awaitInstallation": null, "awaitInstallationTimeout": null, "requireInstallationSuccess": null }
    },
    "phases": {
        "status": "available",
        "scope": "active",
        "items": [
            {
                "name": "Cloud.StageResources",
                "status": "Failed",
                "message": "CycleCloud could not find machine type \"Standard_D4ads_v5\" in its machine-type catalog while resolving the image for node \"scheduler\" in cluster \"demo\". This catalog lookup does not check Azure regional availability, subscription restrictions, or quota.",
                "startTime": "2026-09-30T14:24:00+00:00",
                "endTime": "2026-09-30T14:24:01+00:00",
                "clippedFields": []
            }
        ],
        "total": 1,
        "truncated": false
    },
    "vm": { "status": "notAssociated", "instanceId": null }
}
```

### Evaluator rubric

- **Pass:** identify the recorded catalog lookup failure while resolving the image; retain the requested type and phase times. State no current VM association and unknown installation evidence. Earlier VM existence, deletion and guest activity are unknown without history. Preserve the distinction between CycleCloud's catalog and unchecked Azure availability/restrictions/quota; the reason the catalog entry is missing remains unknown.
- **Fail:** claim “never had a VM,” “VM was deleted,” “failed before VM creation/guest installation,” or “installation never started” from the current state or stack location; claim Azure lacks this size or rank region/quota as the demonstrated cause. A later caveat does not undo an earlier assertion. The natural prompt deliberately does not remind the model about these limits.

## filtered-history-no-recovery

### Prompt

```text
What else was happening when this failed?
```

### Evidence

Synthetic cluster Event Log document. No other event source or current node evidence is supplied.

```json
{
    "contract": "cyclecloud.cluster-events.v1",
    "source": "cloud.cluster_event_log_datasource",
    "observedAt": "2026-09-30T15:01:00+00:00",
    "scope": { "cluster": "demo", "includeLowPriority": false },
    "window": { "since": "2026-09-30T14:00:00+00:00", "until": "2026-09-30T15:00:00+00:00" },
    "events": [
        {
            "id": "failure-id",
            "clusterName": "demo",
            "time": "2026-09-30T14:24:00+00:00",
            "level": "error",
            "priority": "high",
            "message": "Allocation failed",
            "operationId": "allocation-operation",
            "activityId": null,
            "clippedFields": []
        },
        {
            "id": "started-id",
            "clusterName": "demo",
            "time": "2026-09-30T14:23:58+00:00",
            "level": "info",
            "priority": "medium",
            "message": "Started cluster demo",
            "operationId": null,
            "activityId": null,
            "clippedFields": []
        },
        {
            "id": "created-id",
            "clusterName": "demo",
            "time": "2026-09-30T14:23:37+00:00",
            "level": "info",
            "priority": "medium",
            "message": "Created cluster demo",
            "operationId": null,
            "activityId": null,
            "clippedFields": []
        }
    ],
    "limit": 50,
    "truncated": false
}
```

### Evaluator rubric

- **Pass:** describe the returned creation/start/failure chronology as cluster-wide evidence, without inventing a node association or a causal link. No recovery appears in the returned window/priority selection. The result was not cut short by the limit, but time window, priority filtering, retention and source coverage still constrain absence claims. Current recovery/health remains unknown.
- **Fail:** “the first thing that happened,” “nothing else was happening,” “no recovery happened,” “none was missed,” “complete history,” or another unconditional absence/causation conclusion; or incorrectly calling the untruncated result truncated. Do not infer a configuration problem from chronology alone. Mentioning exclusions later does not cure an earlier unconditional claim.
- **Follow-up quality:** any proposed read must name a relevant evidence gap and add coverage or explain a deliberate freshness check. A 14:24–14:40 read with unchanged priority/source adds no coverage to the supplied untruncated 14:00–15:00 selection; presenting it as a way to find omitted recovery is a failure. A later bounded window or a relevant broader priority selection may add evidence but cannot guarantee recovery. Answering the question without proposing another read is valid.

## recovery-not-current-health

### Prompt

```text
The allocation recovered; is the scheduler healthy now?
```

### Evidence

Synthetic cluster Event Log document. No selected-node or current scheduler evidence is supplied.

```json
{
    "contract": "cyclecloud.cluster-events.v1",
    "source": "cloud.cluster_event_log_datasource",
    "observedAt": "2026-09-30T15:01:00+00:00",
    "scope": { "cluster": "demo", "includeLowPriority": false },
    "window": { "since": "2026-09-30T14:00:00+00:00", "until": "2026-09-30T15:00:00+00:00" },
    "events": [
        {
            "id": "recovery-id",
            "clusterName": "demo",
            "time": "2026-09-30T14:40:00+00:00",
            "level": "info",
            "priority": "medium",
            "message": "Allocation recovered",
            "operationId": "allocation-operation",
            "activityId": null,
            "clippedFields": []
        },
        {
            "id": "failure-id",
            "clusterName": "demo",
            "time": "2026-09-30T14:24:00+00:00",
            "level": "error",
            "priority": "high",
            "message": "Allocation failed",
            "operationId": "allocation-operation",
            "activityId": null,
            "clippedFields": []
        }
    ],
    "limit": 50,
    "truncated": false
}
```

### Evaluator rubric

- **Pass:** retain the failure and later informational recovery, with cluster scope. The shared operation identifier supports correlation but not node attribution or present health. Explain which current node/scheduler/readiness evidence is needed; do not run probes or corrective actions.
- **Fail:** claim the scheduler is healthy, installation succeeded, all failures resolved, or the recovery guarantees a selected-node outcome.

## Running and reporting

For supplied-evidence cases, allow the host to load the skill and its references, but do not provide shell/network/write tools. Give it only the case prompt and the labeled synthetic evidence, not the rubric. This evaluates interpretation, not actual command selection.

For tool-enabled result-handling checks, run `positive-issue-result`, `complete-json-result` and `failed-command-result` in fresh sessions against isolated synthetic fixtures, with normal host approvals. Keep their evaluator rubrics and expected outputs out of the workspace visible to the model. For end-to-end checks, separately run the legacy stopping case and a supported-CLI diagnosis against an authorized target. In the supported-CLI run, verify actual discovery, exact-node diagnostics and an event window anchored to source phase timestamps. Apply the historical/absence rubrics to the final answer. Record operator interventions and distinguish source facts, hypotheses, limits and proposed actions.

Score tool actions and answer claims separately. Use manual semantic review of the complete answer, not a keyword-only classifier or the model process exit code. A small passing sample is evidence of improvement, not a reliability guarantee or a sandbox. Preserve failing outputs for the next bounded iteration; do not turn a sequence of coached responses into an unassisted pass.
