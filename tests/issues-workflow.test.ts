import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, test } from "vitest";

const cli = process.env.CYCLECLOUD_TEST_CLI;
const python = process.env.CYCLECLOUD_TEST_PYTHON;
const fixture = process.env.CYCLECLOUD_TEST_ISSUES_FIXTURE;

// The CLI's fixture runs the selected executable against synthetic loopback data.
async function readIssues(
    scenario: string,
    limit = 20,
    selectGroup?: number,
    followPages = false,
) {
    if (
        !cli ||
        !python ||
        !fixture ||
        ![cli, python, fixture].every(isAbsolute)
    )
        throw new Error(
            "Explicit absolute CLI, Python and issues fixture paths are required",
        );
    const home = await mkdtemp(join(tmpdir(), "plugin-issues-workflow-"));
    try {
        return spawnSync(
            python,
            [
                "-B",
                fixture,
                "--scenario",
                scenario,
                "--cli",
                cli,
                ...(selectGroup === undefined
                    ? []
                    : ["--select-group", String(selectGroup)]),
                ...(followPages ? ["--follow-pages"] : []),
                "--",
                "issue",
                selectGroup === undefined ? "list" : "show",
                "demo",
                ...(selectGroup === undefined
                    ? []
                    : ["--group", "{groupSelector}"]),
                "--limit",
                String(limit),
                "--format",
                "json",
            ],
            {
                cwd: home,
                env: {
                    HOME: home,
                    PATH: process.env.PATH,
                    PYTHONPATH: process.env.PYTHONPATH,
                    PYTHONDONTWRITEBYTECODE: "1",
                    PYTHONNOUSERSITE: "1",
                    NO_PROXY: "127.0.0.1,localhost",
                },
                encoding: "utf8",
                timeout: 40_000,
                maxBuffer: 128 * 1024,
            },
        );
    } finally {
        await rm(home, { recursive: true, force: true });
    }
}

test.skipIf(!cli || !python || !fixture)(
    "Reads grouped occurrence counts and preserves truncated or empty selections",
    async () => {
        const report = await readIssues("mixed");
        expect(report.error).toBeUndefined();
        expect(report.status, report.stderr).toBe(0);
        expect(JSON.parse(report.stdout)).toMatchObject({
            contract: "cyclecloud.cluster-issues.v1",
            source: "cloud.node.current_issues",
            scope: {
                cluster: "demo",
                kind: "currentIssues",
                statuses: ["Error", "Warning"],
            },
            limit: 20,
            truncated: false,
            groups: [
                {
                    name: "VirtualMachine",
                    label: "Virtual Machine",
                    status: "Error",
                    message: "Allocation failed",
                    occurrenceCount: 3,
                    clippedFields: [],
                },
                {
                    name: "SoftwareConfiguration",
                    label: "Software Configuration",
                    status: "Warning",
                    message: "Configuration delayed",
                    occurrenceCount: 7,
                },
            ],
        });

        const truncated = await readIssues("truncated", 2);
        expect(truncated.error).toBeUndefined();
        expect(truncated.status, truncated.stderr).toBe(0);
        expect(JSON.parse(truncated.stdout)).toMatchObject({
            limit: 2,
            truncated: true,
            groups: [{ occurrenceCount: 3 }, { occurrenceCount: 7 }],
        });

        const empty = await readIssues("empty");
        expect(empty.error).toBeUndefined();
        expect(empty.status, empty.stderr).toBe(0);
        expect(JSON.parse(empty.stdout)).toMatchObject({
            scope: { cluster: "demo", statuses: ["Error", "Warning"] },
            groups: [],
            truncated: false,
        });
    },
    130_000,
);

test.skipIf(!cli || !python || !fixture)(
    "Reports denied grouped-issue reads as failures rather than zero issues",
    async () => {
        const denied = await readIssues("denied");
        expect(denied.error).toBeUndefined();
        expect(denied.status).toBeGreaterThan(0);
        expect(denied.stdout).toBe("");
        expect(denied.stderr.trim()).not.toBe("");
        expect(denied.stderr).not.toContain("SECRET");
    },
    50_000,
);

test.skipIf(!cli || !python || !fixture)(
    "Follows an exact group selector to resolved and unresolved node references",
    async () => {
        const report = await readIssues("issue-nodes", 2, 0);
        expect(report.error).toBeUndefined();
        expect(report.status, report.stderr).toBe(0);
        const data: unknown = JSON.parse(report.stdout);
        expect(data).toHaveProperty(
            "groupSelector",
            expect.stringMatching(/^[a-z0-9][a-z0-9-]{0,23}:[0-9a-f]{16}$/),
        );
        expect(data).toMatchObject({
            contract: "cyclecloud.issue-nodes.v1",
            source: "cloud.node.current_issue_nodes",
            scope: {
                cluster: "demo",
                kind: "currentIssues",
                statuses: ["Error", "Warning"],
            },
            nodeReferences: [
                { nodeId: "id-1", name: "execute-1", resolution: "resolved" },
                {
                    nodeId: "id-hidden",
                    name: null,
                    resolution: "notFoundOrNotReadable",
                },
            ],
            limit: 2,
            truncated: true,
        });
    },
    50_000,
);

test.skipIf(!cli || !python || !fixture)(
    "Continues beyond one hundred references using the returned cursor",
    async () => {
        const report = await readIssues("node-pages", 100, 0, true);
        expect(report.error).toBeUndefined();
        expect(report.status, report.stderr).toBe(0);
        const pages: unknown = JSON.parse(report.stdout);
        expect(pages).toHaveLength(2);
        expect(pages).toHaveProperty("0.nodeReferences.length", 100);
        expect(pages).toHaveProperty("0.nodeReferences.99", {
            nodeId: "id-099",
            name: null,
            resolution: "notFoundOrNotReadable",
        });
        expect(pages).toHaveProperty("0.page.nextCursor", expect.any(String));
        expect(pages).toHaveProperty(
            "1.nodeReferences",
            Array.from({ length: 5 }, (_, index) => ({
                nodeId: `id-${100 + index}`,
                name: `execute-${100 + index}`,
                resolution: "resolved",
            })),
        );
        expect(pages).toHaveProperty("1.page", {
            limit: 100,
            nextCursor: null,
        });
        expect(pages).toHaveProperty("1.truncated", false);
    },
    130_000,
);

test.skipIf(!cli || !python || !fixture)(
    "Pages through grouped issues and selects a group from a later page",
    async () => {
        const report = await readIssues("group-pages", 100, undefined, true);
        expect(report.error).toBeUndefined();
        expect(report.status, report.stderr).toBe(0);
        const pages: unknown = JSON.parse(report.stdout);
        expect(pages).toHaveLength(2);
        expect(pages).toHaveProperty("0.groups.length", 100);
        expect(pages).toHaveProperty("0.groups.99.message", "failure-099");
        expect(pages).toHaveProperty("0.page.nextCursor", expect.any(String));
        expect(pages).toHaveProperty("1.groups.length", 5);
        expect(pages).toHaveProperty("1.groups.0.message", "failure-100");
        expect(pages).toHaveProperty("1.groups.4.message", "failure-104");
        expect(pages).toHaveProperty("1.page", {
            limit: 100,
            nextCursor: null,
        });
        expect(pages).toHaveProperty("1.truncated", false);

        const selected = await readIssues("group-pages", 2, 100);
        expect(selected.error).toBeUndefined();
        expect(selected.status, selected.stderr).toBe(0);
        expect(JSON.parse(selected.stdout)).toMatchObject({
            contract: "cyclecloud.issue-nodes.v1",
            nodeReferences: [
                { nodeId: "id-1", name: "execute-1", resolution: "resolved" },
                {
                    nodeId: "id-hidden",
                    name: null,
                    resolution: "notFoundOrNotReadable",
                },
            ],
            truncated: true,
        });
    },
    130_000,
);

test.skipIf(!cli || !python || !fixture).each(["node-stale", "node-denied"])(
    "Reports %s drilldown as failure instead of an empty node preview",
    async (scenario) => {
        const report = await readIssues(scenario, 2, 0);
        expect(report.error).toBeUndefined();
        expect(report.status).toBeGreaterThan(0);
        expect(report.stdout).toBe("");
        expect(report.stderr).toContain("Refresh issue list");
        expect(report.stderr).not.toContain("SECRET");
    },
    50_000,
);
