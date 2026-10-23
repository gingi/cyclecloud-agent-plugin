import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const executable = process.env.CYCLECLOUD_TEST_CLI;

// Explicit opt-in only: no PATH discovery, data reads, login or live server use.
describe.skipIf(!executable)("Selected CLI discovery smoke", () => {
    let home: string;
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "cyclecloud-discovery-"));
    });
    afterEach(async () => {
        await rm(home, { recursive: true, force: true });
    });

    function help(path: string[]): Record<string, unknown> {
        if (!executable || !isAbsolute(executable))
            throw new Error(
                "CYCLECLOUD_TEST_CLI must be an explicit absolute executable path",
            );
        const result = spawnSync(
            executable,
            [...path, "--help", "--format", "json"],
            {
                cwd: home,
                env: {
                    HOME: home,
                    PATH: process.env.PATH,
                    PYTHONPATH: process.env.PYTHONPATH,
                    PYTHONDONTWRITEBYTECODE: "1",
                    PYTHONNOUSERSITE: "1",
                },
                encoding: "utf8",
                timeout: 10_000,
                maxBuffer: 128 * 1024,
            },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const descriptor: unknown = JSON.parse(result.stdout);
        if (
            descriptor === null ||
            typeof descriptor !== "object" ||
            Array.isArray(descriptor)
        )
            throw new Error("Expected a structured help object");
        return { ...descriptor };
    }

    test("Discovers canonical resource groups", async () => {
        const root = help([]);
        expect(root.contract).toBe("cyclecloud.help.v1");
        expect(root.path).toEqual([]);
        for (const resource of ["cluster", "node", "issue", "event"])
            expect(root.children).toContainEqual(
                expect.objectContaining({ path: [resource] }),
            );
        expect(await readdir(home)).toEqual([]);
    });

    test.each(["cluster", "node", "issue", "event"])(
        "Discovers %s group children without execution outputs",
        async (resource) => {
            const group = help([resource]);
            expect(group.path).toEqual([resource]);
            expect(group.outputs).toEqual([]);
            const verbs = ["list", "show"];
            expect(group.children).toHaveLength(verbs.length);
            for (const verb of verbs)
                expect(group.children).toContainEqual(
                    expect.objectContaining({ path: [resource, verb] }),
                );
            expect(await readdir(home)).toEqual([]);
        },
    );

    test.each([
        ["cluster", "list", "cyclecloud.clusters.v1"],
        ["cluster", "show", "cyclecloud.clusters.v1"],
        ["node", "list", "cyclecloud.nodes.v1"],
        ["node", "show", "cyclecloud.nodes.v1"],
        ["node", "show", "cyclecloud.node-diagnostics.v1"],
        ["issue", "list", "cyclecloud.cluster-issues.v1"],
        ["issue", "show", "cyclecloud.issue-nodes.v1"],
        ["event", "list", "cyclecloud.cluster-events.v1"],
        ["event", "show", "cyclecloud.cluster-event.v1"],
    ])(
        "Describes %s %s output contract %s",
        async (resource, verb, contract) => {
            const leaf = help([resource, verb]);
            expect(leaf.path).toEqual([resource, verb]);
            expect(leaf.children).toEqual([]);
            expect(leaf.options).toContainEqual(
                expect.objectContaining({ names: ["--format"] }),
            );
            expect(leaf.outputs).toContainEqual({ mode: "json", contract });
            expect(await readdir(home)).toEqual([]);
        },
    );

    test("Advertises opt-in saved image context with its diagnostics prerequisite", async () => {
        const leaf = help(["node", "show"]);
        expect(leaf.outputs).toContainEqual({
            mode: "json",
            contract: "cyclecloud.node-diagnostics.v1",
        });
        expect(leaf.options).toContainEqual(
            expect.objectContaining({
                names: ["--image-context"],
                type: "boolean",
                default: false,
                repeatable: false,
                requirements: ["--diagnostics"],
            }),
        );
        expect(await readdir(home)).toEqual([]);
    });

    test("Preserves the legacy node output contract for limited fallback", async () => {
        const root = help([]);
        expect(root.contract).toBe("cyclecloud.help.v1");
        expect(root.path).toEqual([]);
        expect(root.children).toContainEqual(
            expect.objectContaining({ path: ["show_nodes"] }),
        );
        const nodes = help(["show_nodes"]);
        expect(nodes.path).toEqual(["show_nodes"]);
        expect(nodes.options).toContainEqual(
            expect.objectContaining({ names: ["--format"] }),
        );
        expect(nodes.outputs).toContainEqual({
            mode: "json",
            contract: "cyclecloud.show_nodes.legacy-json.v1",
        });
        const reference = await readFile(
            new URL("../docs/cli-contract.md", import.meta.url),
            "utf8",
        );
        expect(reference).toContain(nodes.contract);
        expect(reference).toContain("cyclecloud.show_nodes.legacy-json.v1");
        expect(await readdir(home)).toEqual([]);
    });

    test("describes a consequential subcommand without executing it", async () => {
        const group = help(["project"]);
        expect(group.outputs).toEqual([]);
        expect(group.children).toContainEqual(
            expect.objectContaining({ path: ["project", "upload"] }),
        );
        const upload = help(["project", "upload"]);
        expect(upload.path).toEqual(["project", "upload"]);
        expect(upload.effects).toContain("remote_write");
        expect(await readdir(home)).toEqual([]);
    });
});
