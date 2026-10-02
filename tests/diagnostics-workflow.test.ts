import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, test } from "vitest";

const cli = process.env.CYCLECLOUD_TEST_CLI;
const python = process.env.CYCLECLOUD_TEST_PYTHON;
const fixture = process.env.CYCLECLOUD_TEST_DIAGNOSTICS_FIXTURE;

// Run the public CLI with its own scripted fixture responses, never live credentials.
const scenario = String.raw`
import json, os, runpy, subprocess, sys
from pathlib import Path
from cyclecli.util import encode

fixture_path, executable = sys.argv[1:]
sys.path.insert(0, str(Path(fixture_path).resolve().parents[1]))
from tests.cluster_json_fixture import serve
fixture = runpy.run_path(fixture_path, run_name="tests.node_diagnostics_fixture")
backend, condition = fixture["DiagnosticsScenario"](), fixture["condition"]
config = Path(os.environ["HOME"]) / "fixture.ini"
results = {}
with serve(backend) as url:
    config.write_text("[cycleserver]\nurl=" + url + "\nusername=fixture\nkey=" + encode("fixture-only") + "\n")
    def call():
        return subprocess.run(
            [executable, "node", "show", "scheduler", "--config", str(config), "--cluster", "demo",
             "--kind", "concrete", "--format", "json", "--diagnostics", "--detail-limit", "1"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=20,
        )
    def success():
        result = call()
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)

    backend.conditions = [condition(Status="error", Description="Stored failure explanation", GroupKey="x" * 1300)]
    results["report"] = success()
    backend.replies["conditions"] = (403, {"error": "private fixture detail"})
    results["denied"] = success()["conditions"]
    backend.replies.clear()
    backend.node["InstanceId"] = backend.identity["InstanceId"] = None
    results["unlinked"] = success()["vm"]
    backend.conditions = [condition(), condition("Zzz later", NodeId="other-node", Resource="node/other-node")]
    failed = call()
    results["wrongAssociation"] = {"status": failed.returncode, "stdout": failed.stdout, "hasError": bool(failed.stderr)}
assert not backend.errors, backend.errors
print(json.dumps(results))
`;

test.skipIf(!cli || !python || !fixture)(
    "reads selected-node evidence without confusing previews, unavailable sections or VM association",
    async () => {
        if (
            !cli ||
            !python ||
            !fixture ||
            ![cli, python, fixture].every(isAbsolute)
        )
            throw new Error(
                "Explicit absolute CLI, Python and diagnostics fixture paths are required",
            );
        const home = await mkdtemp(
            join(tmpdir(), "plugin-diagnostics-workflow-"),
        );
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
                    timeout: 100_000,
                    maxBuffer: 128 * 1024,
                },
            );
            expect(result.error).toBeUndefined();
            expect(result.status, result.stderr).toBe(0);
            const data = JSON.parse(result.stdout) as Record<string, unknown>;
            expect(data.report).toMatchObject({
                contract: "cyclecloud.node-diagnostics.v1",
                scope: { kind: "concrete", cluster: "demo", name: "scheduler" },
                node: { name: "scheduler", status: "Failed" },
                installation: {
                    installationStatus: "Installing",
                    configured: {
                        awaitInstallation: true,
                        awaitInstallationTimeout: 0,
                        requireInstallationSuccess: false,
                    },
                },
                phases: {
                    status: "available",
                    scope: "active",
                    total: 2,
                    truncated: true,
                    items: [{ name: "Install", status: "Failed" }],
                },
                conditions: {
                    status: "available",
                    scope: "currentIssues",
                    total: 1,
                    truncated: false,
                    items: [
                        {
                            status: "error",
                            description: "Stored failure explanation",
                            clippedFields: ["groupKey"],
                        },
                    ],
                },
                vm: {
                    status: "available",
                    instanceId: "vm-id",
                    powerState: "running",
                },
            });
            expect(data.denied).toMatchObject({
                status: "unavailable",
                scope: "currentIssues",
                reason: "permissionDenied",
                items: [],
                total: null,
                truncated: null,
            });
            expect(data.unlinked).toEqual({
                status: "notAssociated",
                instanceId: null,
            });
            expect(data.wrongAssociation).toMatchObject({
                stdout: "",
                hasError: true,
            });
            expect(data.wrongAssociation).not.toMatchObject({ status: 0 });
        } finally {
            await rm(home, { recursive: true, force: true });
        }
    },
    110_000,
);
