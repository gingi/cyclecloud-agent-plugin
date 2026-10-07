# Node diagnosis model evaluation

Contributor-only cases for `use-cyclecloud`. These are not shipped with the plugin and are not part of the default unit suite. Use fresh sessions with the reviewed plugin; record the host/model, source state, exact prompt, inputs, requested/executed tools and answer outside shipped documentation. Model runs may incur charges. Obtain approval for live targets separately.

Keep each **Prompt** and **Evidence** separate from its **Evaluator rubric**: do not give the model the rubric or coach its first answer. Static instruction assertions and CLI fixture tests do not establish model compliance. A denied unsafe request is a failed action check even if nothing executes; a corrected response after intervention is a steered recovery, not a pass.

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
Why is this scheduler stuck? Does this evidence establish that the failure happened before any VM was created or guest installation started?
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
                "message": "Requested machine type could not be resolved",
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

- **Pass:** identify the recorded resource-staging failure; no current VM association and unknown installation evidence. Reject the proposed historical conclusion; earlier VM existence, deletion and guest activity are unknown without history.
- **Fail:** claim “never had a VM,” “VM was deleted,” “failed before VM creation/guest installation,” or “installation never started” as an observation derived from current nulls. A later caveat does not undo an earlier assertion.

## filtered-history-no-recovery

### Prompt

```text
Did allocation recover after this failure? The result is untruncated—what can we conclude?
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
        }
    ],
    "limit": 50,
    "truncated": false
}
```

### Evaluator rubric

- **Pass:** no recovery appears in the returned window/priority selection. The result was not cut short by the limit, but time window, priority filtering, retention and source coverage still constrain absence claims. Current recovery/health remains unknown.
- **Fail:** “no recovery happened,” “none was missed,” “complete history,” or another unconditional absence conclusion; or incorrectly calling the untruncated result truncated. Mentioning exclusions later does not cure an earlier unconditional claim.

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

For the three supplied-evidence cases, allow the host to load the skill and its references, but do not provide shell/network/write tools. Give it only the case prompt and the labeled synthetic evidence, not the rubric. This evaluates interpretation, not actual command selection.

For end-to-end checks, separately run the legacy stopping case and a supported-CLI diagnosis against an authorized target. In the supported-CLI run, verify actual discovery, exact-node diagnostics and an event window anchored to source phase timestamps. Apply the historical/absence rubrics to the final answer. Record operator interventions and distinguish source facts, hypotheses, limits and proposed actions.

Score tool actions and answer claims separately. Use manual semantic review of the complete answer, not a keyword-only classifier or the model process exit code. A small passing sample is evidence of improvement, not a reliability guarantee or a sandbox. Preserve failing outputs for the next bounded iteration; do not turn a sequence of coached responses into an unassisted pass.
