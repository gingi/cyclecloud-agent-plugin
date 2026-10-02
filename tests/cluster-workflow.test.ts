import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, test } from "vitest";

const cli = process.env.CYCLECLOUD_TEST_CLI;
const python = process.env.CYCLECLOUD_TEST_PYTHON;
const fixture = process.env.CYCLECLOUD_TEST_CLUSTER_FIXTURE;

// Opt in to test public commands with the CLI repository's synthetic fixture.
// This test does not copy CLI readers or queries, discover installed CLIs, or use real credentials.
const scenario = String.raw`
import json, os, runpy, subprocess, sys
from pathlib import Path
from cyclecli.util import encode

fixture_path, executable = sys.argv[1:]
fixture = runpy.run_path(fixture_path)
backend = fixture["Scenario"]()
config = Path(os.environ["HOME"]) / "fixture.ini"
results = {}
with fixture["serve"](backend) as url:
    config.write_text("[cycleserver]\nurl=" + url + "\nusername=fixture\nkey=" + encode("fixture-only") + "\n")
    def invoke(verb, *args):
        completed = subprocess.run(
            [executable, "cluster", verb, "--config", str(config), "--format", "json", *args],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
        )
        assert completed.returncode == 0, completed.stderr
        return json.loads(completed.stdout)

    first = invoke("list", "--limit", "1")
    results["first"] = first
    results["second"] = invoke("list", "--limit", "1", "--after", first["page"]["nextCursor"])
    results["detail"] = invoke("show", first["clusters"][0]["name"])
    backend.definitions.append({"Name": "legacy-unknown"})
    results["partial"] = invoke("show", "demo")["clusters"][0]["definitionCounts"]
    backend.count_reply = (403, {"error": "fixture private detail"})
    results["unavailable"] = invoke("show", "demo")["clusters"][0]["definitionCounts"]
    failed = subprocess.run(
        [executable, "cluster", "show", "missing", "--config", str(config), "--format", "json"],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
    )
    results["missing"] = {"status": failed.returncode, "stdout": failed.stdout, "hasError": bool(failed.stderr)}
assert not backend.errors, backend.errors
print(json.dumps(results))
`;

test.skipIf(!cli || !python || !fixture)(
    "lists clusters, follows the CLI cursor, selects demo and distinguishes known from unavailable counts",
    async () => {
        if (
            !cli ||
            !python ||
            !fixture ||
            ![cli, python, fixture].every(isAbsolute)
        )
            throw new Error(
                "Explicit absolute CLI, Python and cluster fixture paths are required",
            );
        const home = await mkdtemp(join(tmpdir(), "plugin-cluster-workflow-"));
        try {
            const result = spawnSync(
                python,
                ["-B", "-c", scenario, fixture, cli],
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
                    timeout: 110_000,
                    maxBuffer: 128 * 1024,
                },
            );
            expect(result.error).toBeUndefined();
            expect(result.status, result.stderr).toBe(0);
            const data = JSON.parse(result.stdout) as Record<string, unknown>;
            expect(data.first).toMatchObject({
                contract: "cyclecloud.clusters.v1",
                scope: { kind: "inventory", includeTemplates: false },
                clusters: [
                    {
                        name: "demo",
                        definitionCounts: { status: "notRequested" },
                    },
                ],
                page: { limit: 1 },
            });
            expect(data.second).toMatchObject({
                clusters: [{ name: "other" }],
                page: { nextCursor: null },
            });
            expect(data.detail).toMatchObject({
                contract: "cyclecloud.clusters.v1",
                scope: { kind: "cluster", requestedName: "demo" },
                page: null,
                clusters: [
                    {
                        name: "demo",
                        definitionCounts: {
                            status: "available",
                            scope: "readablePersistedDefinitions",
                            arrays: 2,
                            standalone: 1,
                            unclassifiedRecords: 0,
                        },
                    },
                ],
            });
            expect(data.partial).toEqual({
                status: "partial",
                scope: "readablePersistedDefinitions",
                arrays: 2,
                standalone: null,
                unclassifiedRecords: 1,
            });
            expect(data.unavailable).toEqual({
                status: "unavailable",
                scope: "readablePersistedDefinitions",
                arrays: null,
                standalone: null,
                unclassifiedRecords: null,
                reason: "permissionDenied",
            });
            expect(data.missing).toMatchObject({ stdout: "", hasError: true });
            expect(data.missing).not.toMatchObject({ status: 0 });
        } finally {
            await rm(home, { recursive: true, force: true });
        }
    },
    120_000,
);
