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
    def call(*options):
        return subprocess.run(
            [executable, "node", "show", "scheduler", "--config", str(config), "--cluster", "demo",
             "--kind", "concrete", "--format", "json", "--diagnostics", "--detail-limit", "1", *options],
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

results["imageContexts"] = {}
for case in ("saved", "notRecorded", "denied", "changed", "identity", "unrequested"):
    backend = fixture["DiagnosticsScenario"]()
    if case == "saved":
        backend.node["InstanceId"] = backend.identity["InstanceId"] = None
        backend.image = dict(ImageName=' /subscriptions/test/images/direct."name] \x00',
                             Image="Legacy Label", ImageVersion=" 1.2.X \n")
    elif case == "notRecorded":
        backend.image = {}
    elif case == "denied":
        backend.replies["image"] = (403, {"SECRET": "error"})
    elif case == "changed":
        backend.image = {}
        backend.replies["image-check"] = (200, [dict(backend.identity, ImageVersion="1.x")])
    elif case == "identity":
        backend.replies["image-check"] = (200, [dict(backend.identity, NodeId="replacement")])
    with serve(backend) as url:
        config.write_text("[cycleserver]\nurl=" + url + "\nusername=fixture\nkey=" + encode("fixture-only") + "\n")
        result = call(*([] if case == "unrequested" else ["--image-context"]))
        if case == "identity":
            results["imageContexts"][case] = {
                "status": result.returncode, "stdout": result.stdout, "hasError": bool(result.stderr),
            }
        else:
            assert result.returncode == 0, result.stderr
            assert not result.stderr, result.stderr
            results["imageContexts"][case] = {"document": json.loads(result.stdout), "stages": backend.stages}
    assert not backend.errors, backend.errors
print(json.dumps(results))
`;

test.skipIf(!cli || !python || !fixture)(
    "reads selected-node diagnostics and optional saved image evidence with availability and identity checks",
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

            const images = data.imageContexts as Record<
                | "saved"
                | "notRecorded"
                | "denied"
                | "changed"
                | "identity"
                | "unrequested",
                Record<string, unknown>
            >;
            const baselineStages = [
                "cluster",
                "node",
                "identity",
                "metadata",
                "statuses",
                "details",
                "conditions",
                "vm",
            ];
            for (const name of [
                "saved",
                "notRecorded",
                "denied",
                "changed",
                "unrequested",
            ] as const) {
                expect(images[name].document).toMatchObject({
                    contract: "cyclecloud.node-diagnostics.v1",
                    scope: {
                        kind: "concrete",
                        cluster: "demo",
                        name: "scheduler",
                    },
                    node: { nodeId: "retained-node-id" },
                });
                expect(images[name].document).not.toHaveProperty("machineType");
                expect(images[name].stages).not.toContain("catalog");
            }
            const saved = images.saved.document as Record<string, unknown>;
            expect(saved.image).toEqual({
                status: "available",
                current: {
                    imageName: ' /subscriptions/test/images/direct."name] \0',
                    imageLabel: "Legacy Label",
                    imageVersion: " 1.2.X \n",
                },
            });
            expect(saved.vm).toEqual({
                status: "notAssociated",
                instanceId: null,
            });
            for (const name of [
                "saved",
                "notRecorded",
                "denied",
                "changed",
            ] as const)
                expect(images[name].document).toMatchObject({
                    sources: {
                        image: "Cloud.Node.ImageName/Image/ImageVersion",
                    },
                });
            expect(images.notRecorded.document).toMatchObject({
                image: {
                    status: "notRecorded",
                    current: {
                        imageName: null,
                        imageLabel: null,
                        imageVersion: null,
                    },
                },
            });
            for (const [name, reason] of [
                ["denied", "permissionDenied"],
                ["changed", "changedDuringRead"],
            ] as const) {
                const document = images[name].document as Record<
                    string,
                    unknown
                >;
                expect(document.image).toEqual({
                    status: "unavailable",
                    reason,
                });
            }
            expect(images.notRecorded.stages).toEqual([
                ...baselineStages.slice(0, 3),
                "image",
                ...baselineStages.slice(3),
                "image-check",
            ]);
            expect(images.denied.stages).not.toContain("image-check");
            expect(images.identity).toMatchObject({
                stdout: "",
                hasError: true,
            });
            expect(images.identity).not.toMatchObject({ status: 0 });
            const unrequested = images.unrequested.document as Record<
                string,
                unknown
            >;
            expect(unrequested).not.toHaveProperty("image");
            expect(unrequested.sources).not.toHaveProperty("image");
            expect(images.unrequested.stages).toEqual(baselineStages);
        } finally {
            await rm(home, { recursive: true, force: true });
        }
    },
    110_000,
);
