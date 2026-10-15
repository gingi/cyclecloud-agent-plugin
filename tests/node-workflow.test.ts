import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, test } from "vitest";

const cli = process.env.CYCLECLOUD_TEST_CLI;
const python = process.env.CYCLECLOUD_TEST_PYTHON;
const fixture = process.env.CYCLECLOUD_TEST_NODE_FIXTURE;

// Use the CLI's scripted scenarios to test commands through the public executable.
const scenario = String.raw`
import json, os, runpy, subprocess, sys
from pathlib import Path
from cyclecli.util import encode

fixture_path, executable = sys.argv[1:]
sys.path.insert(0, str(Path(fixture_path).resolve().parents[1]))
from tests.cluster_json_fixture import serve
fixture = runpy.run_path(fixture_path, run_name="tests.node_json_fixture")
backend, node = fixture["NodeScenario"](), fixture["node"]
config = Path(os.environ["HOME"]) / "fixture.ini"
results = {}
with serve(backend) as url:
    config.write_text("[cycleserver]\nurl=" + url + "\nusername=fixture\nkey=" + encode("fixture-only") + "\n")
    def call(verb, *args):
        return subprocess.run(
            [executable, "node", verb, "--config", str(config), "--cluster", "demo", "--kind", backend.kind, "--format", "json", *args],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
        )
    def success(verb, *args):
        result = call(verb, *args)
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)

    scheduler = node("scheduler", Template="scheduler", NodeId="local-id", State="Off")
    backend.kind = "definition"
    backend.rows = [node("empty", IsArray=True), scheduler]
    results["definitions"] = success("list")
    backend.kind = "concrete"
    backend.rows = [scheduler]
    results["concrete"] = success("list")

    backend.failed, backend.node_array = True, "workers"
    backend.rows = [node("workers-1", Template="workers", NodeId="local-worker", Status="Failed")]
    results["failed"] = success("list", "--failed", "--node-array", "workers")
    backend.failed, backend.node_array, backend.name = False, None, "workers-1"
    results["exact"] = success("show", "workers-1")

    backend.name = None
    members = [node(name, Template="workers", NodeId="id-" + name) for name in ("workers-1", "workers-2")]
    backend.rows = members
    first = success("list", "--limit", "1")
    results["first"] = first
    backend.after, backend.rows = "workers-1", members[1:]
    results["second"] = success("list", "--limit", "1", "--after", first["page"]["nextCursor"])

    backend.after, backend.node_array, backend.rows = None, "empty", []
    results["emptyArray"] = success("list", "--node-array", "empty")
    backend.node_array, backend.name = None, "missing"
    missing = call("show", "missing")
    results["missing"] = {"status": missing.returncode, "stdout": missing.stdout, "hasError": bool(missing.stderr)}
assert not backend.errors, backend.errors
print(json.dumps(results))
`;

test.skipIf(!cli || !python || !fixture)(
    "selects definitions and concrete candidates, resolves an exact node and preserves collection semantics",
    async () => {
        if (
            !cli ||
            !python ||
            !fixture ||
            ![cli, python, fixture].every(isAbsolute)
        )
            throw new Error(
                "Explicit absolute CLI, Python and node fixture paths are required",
            );
        const home = await mkdtemp(join(tmpdir(), "plugin-node-workflow-"));
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
                    timeout: 140_000,
                    maxBuffer: 128 * 1024,
                },
            );
            expect(result.error).toBeUndefined();
            expect(result.status, result.stderr).toBe(0);
            const data = JSON.parse(result.stdout) as Record<string, unknown>;
            expect(data.definitions).toMatchObject({
                contract: "cyclecloud.nodes.v1",
                scope: { kind: "definition", cluster: "demo" },
                nodes: [
                    { name: "empty", isArray: true, nodeId: null },
                    { name: "scheduler", nodeId: "local-id" },
                ],
            });
            expect(data.concrete).toMatchObject({
                scope: { kind: "concrete" },
                nodes: [
                    {
                        name: "scheduler",
                        state: "Off",
                        phaseFailed: null,
                        instanceId: null,
                    },
                ],
            });
            expect(data.failed).toMatchObject({
                scope: {
                    filters: { name: null, failed: true, nodeArray: "workers" },
                },
                nodes: [
                    {
                        name: "workers-1",
                        nodeId: "local-worker",
                        status: "Failed",
                        phaseFailed: null,
                    },
                ],
            });
            expect(data.exact).toMatchObject({
                scope: {
                    filters: {
                        name: "workers-1",
                        failed: false,
                        nodeArray: null,
                    },
                },
                nodes: [{ name: "workers-1" }],
                page: null,
            });
            expect(data.first).toMatchObject({
                nodes: [{ name: "workers-1" }],
                page: { limit: 1 },
            });
            expect(data.second).toMatchObject({
                nodes: [{ name: "workers-2" }],
                page: { nextCursor: null },
            });
            expect(data.emptyArray).toMatchObject({
                nodes: [],
                page: { nextCursor: null },
            });
            expect(data.missing).toMatchObject({ stdout: "", hasError: true });
            expect(data.missing).not.toMatchObject({ status: 0 });
        } finally {
            await rm(home, { recursive: true, force: true });
        }
    },
    150_000,
);
