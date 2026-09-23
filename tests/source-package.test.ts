import { spawnSync } from "node:child_process";
import {
    cp,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
let workspace: string;
beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "source package "));
    for (const file of [
        "plugin.json",
        "compatibility.json",
        ".github/plugin/marketplace.json",
        "README.md",
        "CHANGELOG.md",
        "LICENSE",
        "skills",
        "python",
        "docs",
        "scripts",
    ]) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await cp(join(root, file), join(workspace, file), { recursive: true });
    }
});
afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
});
function packageSource() {
    return spawnSync(
        process.execPath,
        [join(workspace, "scripts/package-local.mjs")],
        { cwd: workspace, encoding: "utf8", timeout: 15_000 },
    );
}
function verify(directory = join(workspace, "dist/cyclecloud-agent-plugin")) {
    return spawnSync(
        process.execPath,
        [join(root, "scripts/verify-package.mjs"), directory],
        { cwd: tmpdir(), encoding: "utf8", timeout: 15_000 },
    );
}

describe("Source-only portable packaging", () => {
    test("packages all regular Python modules, skills and public docs with exact contents twice", async () => {
        await writeFile(
            join(workspace, "cyclecloud.json"),
            "credential sentinel",
        );
        await mkdir(join(workspace, "docs/superpowers"), { recursive: true });
        await writeFile(
            join(workspace, "docs/superpowers/private.md"),
            "private plan",
        );
        for (let n = 0; n < 2; n++) expect(packageSource().status).toBe(0);
        const output = join(workspace, "dist/cyclecloud-agent-plugin");
        const files = (
            await readdir(output, { recursive: true, withFileTypes: true })
        )
            .filter((entry) => entry.isFile())
            .map((entry) =>
                join(entry.parentPath, entry.name).slice(output.length + 1),
            );
        for (const file of [
            "README.md",
            "CHANGELOG.md",
            "compatibility.json",
            ".github/plugin/marketplace.json",
            "python/cyclecloud_agent_inspect/body_reader.py",
            "scripts/cyclecloud-inspect",
            "scripts/inspect-bootstrap.py",
            "skills/inspect-cyclecloud/SKILL.md",
            "docs/agent-plugin-design.md",
        ])
            expect(files).toContain(file);
        const modules = (
            await readdir(join(workspace, "python/cyclecloud_agent_inspect"))
        ).filter((name) => name.endsWith(".py"));
        for (const module of modules)
            expect(files).toContain(
                `python/cyclecloud_agent_inspect/${module}`,
            );
        expect(files.join("\n")).not.toMatch(
            /node_modules|__pycache__|\.pyc|cyclecloud\.json|superpowers|bin\/|tests\//,
        );
        for (const file of files.filter(
            (file) => file !== "SOURCE_COMMIT.json",
        ))
            expect(await readFile(join(output, file))).toEqual(
                await readFile(join(workspace, file)),
            );
        expect(
            (await lstat(join(output, "scripts/cyclecloud-inspect"))).mode &
                0o111,
        ).toBe(0o111);
        expect(verify().status).toBe(0);
        const moved = join(workspace, "elsewhere", "persistent source");
        await mkdir(dirname(moved));
        await cp(output, moved, { recursive: true });
        await rm(join(workspace, "python"), { recursive: true });
        const result = verify(moved);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("source package");
    }, 30_000);
    test.each([
        "scripts",
        "python/cyclecloud_agent_inspect",
        "skills/inspect-cyclecloud",
    ])("rejects symlinked source parents: %s", async (path) => {
        const target = join(workspace, "redirected");
        await cp(join(workspace, path), target, { recursive: true });
        await rm(join(workspace, path), { recursive: true });
        await symlink(target, join(workspace, path));
        expect(packageSource().status).not.toBe(0);
    });
    test("rejects symlinked source files and keeps an existing package unchanged", async () => {
        expect(packageSource().status).toBe(0);
        const output = join(
            workspace,
            "dist/cyclecloud-agent-plugin/plugin.json",
        );
        const before = await readFile(output);
        const file = join(
            workspace,
            "python/cyclecloud_agent_inspect/body_reader.py",
        );
        await rm(file);
        await symlink(
            join(root, "python/cyclecloud_agent_inspect/body_reader.py"),
            file,
        );
        expect(packageSource().status).not.toBe(0);
        expect(await readFile(output)).toEqual(before);
    });
    test.each(["dist", "dist/cyclecloud-agent-plugin"])(
        "rejects symlinked output: %s",
        async (path) => {
            const target = join(workspace, "outside");
            await mkdir(target);
            await mkdir(dirname(join(workspace, path)), { recursive: true });
            await symlink(target, join(workspace, path));
            expect(packageSource().status).not.toBe(0);
            expect(await readdir(target)).toEqual([]);
        },
    );
    test.each([
        "extra",
        "missing",
        "symlink",
        "mcp",
        "compatibility",
        "altered-source",
        "credential-metadata",
        "manifest-array-type",
    ])("verification rejects %s packages", async (kind) => {
        expect(packageSource().status).toBe(0);
        const output = join(workspace, "dist/cyclecloud-agent-plugin");
        if (kind === "extra")
            await writeFile(join(output, "cyclecloud.json"), "secret");
        if (kind === "missing")
            await rm(
                join(output, "python/cyclecloud_agent_inspect/body_reader.py"),
            );
        if (kind === "symlink") {
            await rm(join(output, "LICENSE"));
            await symlink(join(root, "LICENSE"), join(output, "LICENSE"));
        }
        if (kind === "mcp") {
            const path = join(output, "plugin.json");
            const value = JSON.parse(await readFile(path, "utf8")) as Record<
                string,
                unknown
            >;
            value.mcpServers = {};
            await writeFile(path, JSON.stringify(value));
        }
        if (kind === "manifest-array-type") {
            const path = join(output, "plugin.json");
            const value = JSON.parse(await readFile(path, "utf8")) as Record<
                string,
                unknown
            >;
            value.keywords = {
                0: "azure-cyclecloud",
                1: "hpc",
                2: "agent-plugin",
            };
            await writeFile(path, JSON.stringify(value));
        }
        if (kind === "credential-metadata")
            await writeFile(
                join(output, "SOURCE_COMMIT.json"),
                JSON.stringify({
                    sourceCommit: "a".repeat(40),
                    checkoutCommit: "a".repeat(40),
                    password: "private credential",
                }),
            );
        if (kind === "compatibility")
            await writeFile(join(output, "compatibility.json"), "{}");
        if (kind === "altered-source")
            await writeFile(
                join(output, "python/cyclecloud_agent_inspect/body_reader.py"),
                "raise RuntimeError('altered')\n",
            );
        expect(verify().status).not.toBe(0);
    });
});
