import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { releaseRepository } from "./helpers/release-repository.js";

const root = fileURLToPath(new URL("../", import.meta.url));
async function json(directory: string, file: string) {
    return JSON.parse(
        await readFile(resolve(directory, file), "utf8"),
    ) as Record<string, unknown>;
}
async function expectSourceIdentities(directory: string) {
    const pkg = await json(directory, "package.json");
    const plugin = await json(directory, "plugin.json");
    const marketplace = await json(
        directory,
        ".github/plugin/marketplace.json",
    );
    expect(plugin).toEqual({
        name: "cyclecloud",
        version: pkg.version,
        description:
            "Azure CycleCloud Agent Plugin: read-only inspection and application authoring.",
        keywords: ["azure-cyclecloud", "hpc", "agent-plugin"],
    });
    expect(marketplace).toEqual({
        name: "cyclecloud",
        owner: { name: "Azure CycleCloud" },
        metadata: {
            description: "Azure CycleCloud Agent Plugin",
            version: plugin.version,
        },
        plugins: [
            {
                name: "cyclecloud",
                description: plugin.description,
                version: plugin.version,
                repository: "https://github.com/gingi/cyclecloud-agent-plugin",
                source: "./",
            },
        ],
    });
    expect(pkg.name).toBe("cyclecloud-agent-plugin");
    expect(pkg.dependencies ?? {}).toEqual({});
}

describe("Source Agent Plugin identities", () => {
    test("publishes cyclecloud in the local cyclecloud marketplace without MCP", async () => {
        await expectSourceIdentities(root);
    });
    test("keeps all identity guards valid after preparing an isolated next release", async () => {
        const repository = await releaseRepository();
        const workspace = repository.checkout;
        const currentVersion = (await json(root, "package.json")).version;
        const nextVersion = "9.8.7-rc.1";
        try {
            await writeFile(
                join(workspace, "CHANGELOG.md"),
                `# Changelog\n\n## [${nextVersion}]\n\nIsolated next-release identity regression.\n`,
            );
            repository.commit("docs: prepare fixture release notes");
            const prepared = spawnSync(
                process.execPath,
                [join(root, "scripts/prepare-release.mjs"), nextVersion],
                { cwd: workspace, encoding: "utf8", timeout: 10_000 },
            );
            expect(prepared.status, prepared.stderr).toBe(0);
            expect(repository.git("branch", "--show-current")).toBe(
                `release/prepare-${nextVersion}`,
            );
            expect((await json(workspace, "package.json")).version).toBe(
                nextVersion,
            );
            await expectSourceIdentities(workspace);
            expect((await json(root, "package.json")).version).toBe(
                currentVersion,
            );
            expect((await json(root, "plugin.json")).version).toBe(
                currentVersion,
            );
        } finally {
            await rm(repository.directory, { recursive: true, force: true });
        }
    });
});
