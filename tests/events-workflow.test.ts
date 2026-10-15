import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, test } from "vitest";

const cli = process.env.CYCLECLOUD_TEST_CLI;
const python = process.env.CYCLECLOUD_TEST_PYTHON;
const fixture = process.env.CYCLECLOUD_TEST_EVENTS_FIXTURE;

// The CLI's fixture runs the selected executable against synthetic loopback data.
async function runEventCommand(scenario: string, command: string[]) {
    if (
        !cli ||
        !python ||
        !fixture ||
        ![cli, python, fixture].every(isAbsolute)
    )
        throw new Error(
            "Explicit absolute CLI, Python and events fixture paths are required",
        );
    const home = await mkdtemp(join(tmpdir(), "plugin-events-workflow-"));
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
                "--",
                ...command,
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

function readEvents(scenario: string, limit = 50) {
    return runEventCommand(scenario, [
        "event",
        "list",
        "demo",
        "--since",
        "2020-01-02T09:00:00Z",
        "--until",
        "2020-01-02T11:00:00Z",
        "--limit",
        String(limit),
        "--format",
        "json",
    ]);
}

test.skipIf(!cli || !python || !fixture)(
    "Reads failure and recovery as cluster events and preserves bounded or empty selection",
    async () => {
        const report = await readEvents("failure-recovery");
        expect(report.error).toBeUndefined();
        expect(report.status, report.stderr).toBe(0);
        const data: unknown = JSON.parse(report.stdout);
        expect(data).toMatchObject({
            contract: "cyclecloud.cluster-events.v1",
            source: "cloud.cluster_event_log_datasource",
            scope: { cluster: "demo", includeLowPriority: false },
            window: {
                since: "2020-01-02T09:00:00+00:00",
                until: "2020-01-02T11:00:00+00:00",
            },
            limit: 50,
            truncated: false,
            events: [
                {
                    id: "#516f739a-01e1-0000-8000-000000000002",
                    clusterName: "demo",
                    time: "2020-01-02T10:00:00+00:00",
                    level: "info",
                    priority: "medium",
                    message: "Allocation recovered",
                    operationId: "#516f739a-01e1-0000-8000-000000000010",
                    activityId: null,
                    clippedFields: [],
                },
                {
                    id: "#516f739a-01e1-0000-8000-000000000001",
                    clusterName: "demo",
                    time: "2020-01-02T09:00:00+00:00",
                    level: "error",
                    priority: "high",
                    message: "Allocation failed",
                },
            ],
        });

        const truncated = await readEvents("truncated", 1);
        expect(truncated.error).toBeUndefined();
        expect(truncated.status, truncated.stderr).toBe(0);
        expect(JSON.parse(truncated.stdout)).toMatchObject({
            limit: 1,
            truncated: true,
            events: [{ id: "#516f739a-01e1-0000-8000-000000000002" }],
        });

        const empty = await readEvents("empty");
        expect(empty.error).toBeUndefined();
        expect(empty.status, empty.stderr).toBe(0);
        expect(JSON.parse(empty.stdout)).toMatchObject({
            scope: { cluster: "demo", includeLowPriority: false },
            events: [],
            truncated: false,
        });
    },
    130_000,
);

test.skipIf(!cli || !python || !fixture).each([
    ["show", "2020-01-02T09:00:00+00:00", "error", "high"],
    ["show-low", "2010-01-02T09:00:00+00:00", "info", "low"],
])(
    "Reads one copied event ID without collection filters: %s",
    async (scenario, time, level, priority) => {
        const id = "#516f739a-01e1-0000-8000-000000000001";
        const report = await runEventCommand(scenario, [
            "event",
            "show",
            id,
            "--cluster",
            "demo",
            "--format",
            "json",
        ]);
        expect(report.error).toBeUndefined();
        expect(report.status, report.stderr).toBe(0);
        const data: unknown = JSON.parse(report.stdout);
        const observedAt: unknown = expect.any(String);
        expect(data).toEqual({
            contract: "cyclecloud.cluster-event.v1",
            source: "cloud.cluster_event_log_datasource",
            observedAt,
            scope: { cluster: "demo" },
            event: {
                id,
                clusterName: "demo",
                time,
                level,
                priority,
                message: "Allocation failed",
                operationId: "#516f739a-01e1-0000-8000-000000000010",
                activityId: null,
                clippedFields: [],
            },
        });
    },
    50_000,
);

test
    .skipIf(!cli || !python || !fixture)
    .each([
        "show-missing",
        "show-denied",
        "show-mismatched",
        "show-malformed",
        "show-ambiguous",
    ])(
    "Fails exact-event lookup without successful empty or substituted evidence: %s",
    async (scenario) => {
        const report = await runEventCommand(scenario, [
            "event",
            "show",
            "#516f739a-01e1-0000-8000-000000000001",
            "--cluster",
            "demo",
            "--format",
            "json",
        ]);
        expect(report.error).toBeUndefined();
        expect(report.status).toBeGreaterThan(0);
        expect(report.stdout).toBe("");
        expect(report.stderr.trim()).not.toBe("");
        expect(report.stderr).not.toContain("SECRET access denied");
    },
    50_000,
);

test.skipIf(!cli || !python || !fixture)(
    "Reports denied Event Log reads as failures rather than successful empty evidence",
    async () => {
        const denied = await readEvents("denied");
        expect(denied.error).toBeUndefined();
        expect(denied.status).toBeGreaterThan(0);
        expect(denied.stdout).toBe("");
        expect(denied.stderr.trim()).not.toBe("");
        expect(denied.stderr).not.toContain("SECRET access denied");
    },
    50_000,
);
