# Node diagnosis model evaluation

Contributor-only cases for `use-cyclecloud`. These are not shipped with the plugin and are not part of the default unit suite. Use fresh sessions with the reviewed plugin; record the host/model, source state, exact prompt, inputs, requested/executed tools and answer outside shipped documentation. Model runs may incur charges. Obtain approval for live targets separately.

Keep each **Prompt** and **Evidence** separate from its **Evaluator rubric**: do not give the model the rubric or coach its first answer. Static instruction assertions and CLI fixture tests do not establish model compliance. A denied unsafe request is a failed action check even if nothing executes; a corrected response after intervention is a steered recovery, not a pass.

## inventory-response-presentation

### Prompt

```text
Show me my CycleCloud clusters.
```

### Evidence

Synthetic successful cluster inventory response. Run two fresh supplied-evidence cases: first with the document below, then with only `page.nextCursor` changed to the opaque value `fixture-next-page`. Supply the same prompt and synthetic label, without the variation instructions or rubric. Confirm that `use-cyclecloud` actually loaded before counting an answer as a plugin check. An explicit request to use the CycleCloud plugin is allowed for this targeted presentation check, but record it separately from automatic discovery. This tests presentation of known evidence, not command selection or connected reads.

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

Use an isolated synthetic CLI fixture advertising grouped current issues. Its `show_issues` read succeeds with empty stderr and the document below. Use the same natural prompt for a fresh supplied-evidence presentation check if host execution is unavailable; that variant does not test command composition. An explicit request to invoke `use-cyclecloud` is allowed for a targeted skill check, not evidence of automatic discovery. Keep setup instructions and the rubric out of the model prompt.

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

Use an isolated synthetic CLI fixture with the reviewed root and `show_cluster` help descriptors. Its inventory read must return valid `cyclecloud.clusters.v1` JSON larger than 6,000 bytes, with normal cluster rows and the `page` metadata at the end. Give the last cluster a distinctive name such as `z-last-cluster`; ensure that row and the end of the JSON occur after byte 6,000. Support smaller requested limits and real fixture continuation so an agent can legitimately narrow an oversized host response. Record the exact bytes, exit status and stderr separately. This is a tool-enabled result-handling test, not a supplied-evidence interpretation case or a real-server compatibility check.

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

Use an isolated synthetic CLI fixture advertising grouped current issues. The cluster is readable, but its primary `show_issues` data read exits nonzero with empty stdout and safe text on stderr describing permission denial. Help succeeds. Record requested and executed tools and both output channels; do not give the model the failure in advance or permission instructions in its prompt.

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
