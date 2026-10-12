import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const skill = new URL("../skills/use-cyclecloud/SKILL.md", import.meta.url);
const reference = new URL("../docs/cli-contract.md", import.meta.url);

// Instruction contracts, not a model-backed test of agent compliance.
describe("CLI-first guidance", () => {
    test("discovers the selected executable and actual command contracts", async () => {
        const text = await readFile(skill, "utf8");
        for (const term of [
            "name: use-cyclecloud",
            "CYCLECLOUD_CLI",
            "PATH",
            "--help --format json",
            "cyclecloud.help.v1",
            "outputs",
            "unsupported",
            "unknown",
        ])
            expect(text).toContain(term);
        expect(text).toContain("Do not silently switch");
        expect(text).toContain("Do not infer execution JSON support");
        const discovery = text
            .split("## Discover before executing")[1]
            ?.split("\n## ")[0];
        for (const term of [
            "complete structured help",
            "contract-name `grep`",
            "successful discovery and validation",
            "unconditional `;`",
        ])
            expect(discovery).toContain(term);
    });

    test("Preserves complete command results before interpreting JSON", async () => {
        const text = await readFile(skill, "utf8");
        const execution = text
            .split("## Preserve command results")[1]
            ?.split("\n## ")[0];
        expect(execution).toBeDefined();
        for (const term of [
            "single direct command",
            "CLI exit status",
            "stderr separate from stdout",
            "printing `$?` does not preserve",
            "replaying stderr onto stdout",
            "`head`",
            "complete JSON",
            "supported limits",
            "host truncates",
            "approved local file",
            "unique per-invocation path",
            "return the CLI's actual status",
        ])
            expect(execution).toContain(term);
        expect(text.indexOf("## Preserve command results")).toBeLessThan(
            text.indexOf("## Choose a diagnostic path"),
        );
    });

    test("Keeps routine metadata internal while reporting limitations that affect the request", async () => {
        const text = await readFile(skill, "utf8");
        const presentation = text
            .split("## Present results for the user's question")[1]
            ?.split("\n## ")[0];
        expect(presentation).toBeDefined();
        for (const term of [
            "internal validation",
            "nextCursor",
            "weren't requested",
            "requested facts",
            "complete cluster listing",
            "partial cluster listing",
            "plain language",
            "more results remain",
        ])
            expect(presentation).toContain(term);
    });

    test("Applies evidence checks to every answer, not just Event Log correlation", async () => {
        const text = await readFile(skill, "utf8");
        const evidence = text
            .split("## Check evidence before answering")[1]
            ?.split("\n## ")[0];
        expect(evidence).toBeDefined();
        for (const term of [
            "failed lookup",
            "underlying cause",
            "Current null fields",
            "Time proximity does not establish causation",
            "first error in the returned selection",
            "caveat later",
            "next discriminating check",
        ])
            expect(evidence).toContain(term);
        expect(text.indexOf("## Check evidence before answering")).toBeLessThan(
            text.indexOf("## Choose a diagnostic path"),
        );
    });

    test("Recommends follow-up reads only when they add relevant evidence", async () => {
        const text = await readFile(skill, "utf8");
        const evidence = text
            .split("## Check evidence before answering")[1]
            ?.split("\n## ")[0];
        for (const term of [
            "what new evidence it would add",
            "already covered",
            "untruncated",
            "freshness",
            "answer and stop",
        ])
            expect(evidence).toContain(term);
    });

    test("Keeps permission-denial follow-up on the selected identity and configuration", async () => {
        const text = await readFile(skill, "utf8");
        const failure = text
            .split("## Handle gaps and failures deliberately")[1]
            ?.split("\n## ")[0];
        for (const term of [
            "Permission denial",
            "selected account and configuration",
            "verify access to that specific read",
            "another identity or `--config`",
            "which permission is missing",
            "do not invite a profile switch",
        ])
            expect(failure).toContain(term);
    });

    test("uses cluster detail for counts and preserves paging limitations", async () => {
        const text = await readFile(skill, "utf8");
        for (const term of [
            "cyclecloud.clusters.v1",
            "show_cluster",
            "notRequested",
            "partial",
            "readablePersistedDefinitions",
            "page.nextCursor",
            "--after",
            "exact named lookup",
        ])
            expect(text).toContain(term);
        const contract = await readFile(reference, "utf8");
        expect(contract).toContain("unclassifiedRecords");
        expect(contract).toContain("1 MiB");
        expect(contract).toContain("not a snapshot");
        expect(contract).toContain("safe text");
    });

    test("selects bounded node kinds without implying runtime readiness or diagnosis", async () => {
        const text = await readFile(skill, "utf8");
        for (const term of [
            "cyclecloud.nodes.v1",
            "--kind definition",
            "--kind concrete",
            "--failed",
            "--node-array",
            "not a health check",
            "standalone",
            "Off",
            "nodeId",
        ])
            expect(text).toContain(term);
        const contract = await readFile(reference, "utf8");
        expect(contract).toContain("--kind");
        expect(contract).toContain("not necessarily a UUID");
        expect(contract).toContain("Name-keyed");
        expect(contract).toContain("one target or an error");
    });

    test("Limits legacy diagnosis to one state projection before stopping", async () => {
        const text = await readFile(skill, "utf8");
        const route = text
            .split("## Choose a diagnostic path")[1]
            ?.split("\n## ")[0];
        expect(route).toBeDefined();
        expect(route).toContain("at most one exact-node state read");
        expect(route).toContain(
            "--attrs Name,ClusterName,NodeId,State,TargetState,Status,PhaseFailed",
        );
        expect(route).toContain("Stop rich diagnosis after that state summary");
        expect(route).toContain("Do not reconstruct phases or history");
        expect(route).toContain("If only Event Log support is missing");
        expect(text).toContain(
            "Use supplied evidence before planning more reads",
        );
        expect(text).toContain(
            "Check explicit fields before calling evidence missing",
        );
    });

    test("Triages grouped current issues without inventing affected-node counts", async () => {
        const text = await readFile(skill, "utf8");
        const triage = text
            .split("## Triage a cluster's current issues")[1]
            ?.split("\n## ")[0];
        expect(triage).toBeDefined();
        for (const term of [
            "show_issues --help --format json",
            "cyclecloud.cluster-issues.v1",
            "page.nextCursor",
            "--after",
            "identity order",
            "Error",
            "Warning",
            "occurrenceCount",
            "not distinct affected nodes",
            "No node identities",
            "non-null short logical group ID",
            "last emitted group's representative",
            "PageVersion=2",
            "not a health verdict",
            "Do not fan out",
        ])
            expect(triage).toContain(term);
        const contract = (await readFile(reference, "utf8"))
            .split("## Grouped current issues")[1]
            ?.split("\n## ")[0];
        expect(contract).toBeDefined();
        for (const term of [
            "cloud.node.current_issues",
            "raw aspect name, status and message",
            "1–100",
            "limit + 1",
            "aggregation scan",
            "unsupported",
            "nonzero",
        ])
            expect(contract).toContain(term);
    });

    test("Presents positive issue findings and follow-ups without exposing selector mechanics", async () => {
        const text = await readFile(skill, "utf8");
        const triage = text
            .split("## Triage a cluster's current issues")[1]
            ?.split("\n## ")[0];
        for (const term of [
            "positive issue finding",
            "scope materially affects the question",
            "which node is affected",
            "what caused the resource-staging failure",
            "node-reference bookkeeping internal",
            "Storage Account",
            "establishes a storage root cause",
        ])
            expect(triage).toContain(term);
    });

    test("Uses exact issue selectors and checks diagnostic identity at handoff", async () => {
        const text = await readFile(skill, "utf8");
        const drilldown = text
            .split("## Select nodes from an issue group")[1]
            ?.split("\n## ")[0];
        expect(drilldown).toBeDefined();
        for (const term of [
            "cyclecloud.issue-nodes.v1",
            "--group",
            "groupSelector",
            "nodeReferences",
            "page.nextCursor",
            "--after",
            "only as needed",
            "notFoundOrNotReadable",
            "Unresolved references consume preview slots",
            "storageaccount:7c4e9a12d63b08f5",
            "illustrative",
            "not self-contained endpoint-bound tokens",
            "representative deletion",
            "Legacy long selectors",
            "full logical fingerprint",
            "diagnostics.node.nodeId",
            "selected reference's nodeId",
            "Do not accept or attribute",
        ])
            expect(drilldown).toContain(term);
        const contract = (await readFile(reference, "utf8"))
            .split("## Issue-group node references")[1]
            ?.split("\n## ")[0];
        expect(contract).toBeDefined();
        for (const term of [
            "cloud.node.current_issue_nodes",
            "short logical group ID",
            "Legacy long selectors",
            "full logical fingerprint",
            "PageVersion=2",
            "no registry, cache or stored mapping",
            "representative",
            "endpoint",
            "not encryption or authorization",
            "ordinary user's permissions",
            "page.nextCursor",
            "--after",
            "no overall affected-node total",
        ])
            expect(contract).toContain(term);
    });

    test("diagnoses only a selected node and distinguishes evidence scopes", async () => {
        const text = await readFile(skill, "utf8");
        for (const term of [
            "cyclecloud.node-diagnostics.v1",
            "--diagnostics",
            "--detail-limit",
            "currentIssues",
            "notAssociated",
            "clippedFields",
            "completed",
        ])
            expect(text).toContain(term);
        const details = await readFile(
            new URL("../docs/node-diagnostics.md", import.meta.url),
            "utf8",
        );
        for (const term of [
            "preview limit",
            "notRecorded",
            "workLimit",
            "sensitive",
            "2 MiB",
        ])
            expect(details).toContain(term);
    });

    test("Requests machine-type context only through advertised diagnostics", async () => {
        const text = await readFile(skill, "utf8");
        const catalog = text
            .split("### Explain a machine-type lookup failure")[1]
            ?.split("\n## ")[0];
        expect(catalog).toBeDefined();
        for (const term of [
            "--machine-type-catalog",
            "advertises",
            "--diagnostics",
            "configuredName",
            "lookupNameSource",
            "persisted",
            "notRecorded",
            "changedDuringRead",
            "server default",
        ])
            expect(catalog).toContain(term);
        const contract = (await readFile(reference, "utf8"))
            .split("### Optional machine-type catalog context")[1]
            ?.split("\n## ")[0];
        expect(contract).toBeDefined();
        for (const term of [
            "unchanged",
            "Name only",
            "notFoundOrNotReadable",
            "notRequested",
            "noConfiguredName",
            "4096",
        ])
            expect(contract).toContain(term);
    });

    test("Ties catalog recommendations to current versus recorded evidence", async () => {
        const text = await readFile(skill, "utf8");
        const catalog = text
            .split("### Explain a machine-type lookup failure")[1]
            ?.split("\n## ")[0];
        expect(catalog).toBeDefined();
        for (const term of [
            "description/detail",
            "recorded",
            "present",
            "notFoundOrNotReadable",
            "existing but hidden",
            "confirmed absent",
            "intended type",
            "new failure evidence",
            "permissionDenied",
            "replacement size",
        ])
            expect(catalog).toContain(term);
    });

    test("Correlates selected-node failures with discovered cluster Event Log evidence", async () => {
        const text = await readFile(skill, "utf8");
        for (const term of [
            "show_events --help --format json",
            "cyclecloud.cluster-events.v1",
            "--since",
            "--until",
            "recorded phase start/end",
            "same selected executable",
            "recent context, not incident evidence",
            "cluster-wide",
            "recovery",
            "Observations",
            "Hypotheses",
            "Unknowns",
            "separate approval",
        ])
            expect(text).toContain(term);
        expect(text).toContain("Time proximity does not establish causation");
        expect(text).toContain("No node filter, cursor or total");
        expect(text).toContain(
            "Current null fields do not establish earlier VM or guest history",
        );
        expect(text).toContain(
            "`truncated: false` does not establish complete history",
        );
        expect(text).toContain(
            "window, priority filter, retention and source coverage",
        );
        expect(text).toContain("does not establish current scheduler health");
    });

    test("Documents Event Log bounds, source identity and primary-read failures", async () => {
        const text = await readFile(reference, "utf8");
        const events = text.split("## Cluster Event Log")[1]?.split("\n## ")[0];
        expect(events).toBeDefined();
        for (const term of [
            "cyclecloud.cluster-events.v1",
            "cloud.cluster_event_log_datasource",
            "Event.Time",
            "_Timestamp",
            "Activity.EventTime",
            "[since, until)",
            "7 days",
            "historical age",
            "--include-low-priority",
            "operationId",
            "activityId",
            "clippedFields",
            "limit + 1",
            "2 MiB",
            "1 MiB",
            "nonzero",
            "not a successful empty",
            "not secret redaction",
        ])
            expect(events).toContain(term);
    });

    test("does not overstate the legacy node JSON contract", async () => {
        const text = await readFile(reference, "utf8");
        for (const term of [
            "cyclecloud.show_nodes.legacy-json.v1",
            "array",
            "Instance",
            "unbounded",
            "--attrs",
            "not concrete-only",
            "--output",
            "cyclecloud.error.v1",
            "stderr",
        ])
            expect(text).toContain(term);
    });

    test("separates help errors from legacy execution and custom output", async () => {
        const text = await readFile(reference, "utf8");
        for (const term of [
            "JSON help only",
            "nonempty `--output`",
            "custom text",
            "may prompt",
            "does not validate",
            "raw server responses",
        ])
            expect(text).toContain(term);
        expect(text).not.toContain("--json");
    });

    test("keeps setup, capability gaps and operation failures distinct", async () => {
        const text = await readFile(skill, "utf8");
        for (const term of [
            "Do not download or install automatically",
            "Never ask for passwords",
            "authentication failure",
            "permission denial",
            "no API fallback",
            "untrusted data",
            "separate approval",
            "cyclecloud *",
        ])
            expect(text).toContain(term);
    });

    test("retains evidence and connectivity boundaries", async () => {
        const text = await readFile(
            new URL("../docs/node-diagnostics.md", import.meta.url),
            "utf8",
        );
        for (const term of [
            "configured definitions",
            "instantiated-node groups",
            "unknown, not zero",
            "cluster-wide",
            "not proof",
            "from the CycleCloud server",
            "not necessarily from the CLI host",
            "user-confirmed context",
        ])
            expect(text).toContain(term);
    });

    test("references documents shipped beside the skill", async () => {
        const text = await readFile(skill, "utf8");
        for (const path of [
            "cli-contract",
            "configuration",
            "node-diagnostics",
        ]) {
            const link = `../../docs/${path}.md`;
            expect(text).toContain(link);
            await expect(
                readFile(new URL(link, skill), "utf8"),
            ).resolves.toBeTruthy();
        }
    });
});
