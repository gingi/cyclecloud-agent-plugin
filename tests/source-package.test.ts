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
const checker =
    "skills/author-cyclecloud-application/scripts/validate-project.mjs";
let workspace: string;
beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "source package "));
    for (const file of [
        "plugin.json",
        ".github/plugin/marketplace.json",
        "README.md",
        "CHANGELOG.md",
        "LICENSE",
        "skills",
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
        {
            cwd: workspace,
            encoding: "utf8",
            timeout: 15_000,
        },
    );
}
function verify(directory = join(workspace, "dist/cyclecloud-agent-plugin")) {
    return spawnSync(
        process.execPath,
        [join(root, "scripts/verify-package.mjs"), directory],
        {
            cwd: tmpdir(),
            encoding: "utf8",
            timeout: 15_000,
        },
    );
}

describe("Source-only portable packaging", () => {
    test("packages skills, assets and docs without a CLI runtime, including after relocation", async () => {
        await writeFile(
            join(workspace, "cyclecloud.json"),
            "credential sentinel",
        );
        await mkdir(join(workspace, "docs/superpowers"), { recursive: true });
        await writeFile(
            join(workspace, "docs/superpowers/private.md"),
            "private plan",
        );
        for (let n = 0; n < 2; n++) {
            const result = packageSource();
            expect(result.status, result.stderr).toBe(0);
        }
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
            ".github/plugin/marketplace.json",
            "skills/use-cyclecloud/SKILL.md",
            checker,
            "docs/agent-plugin-design.md",
            "docs/node-diagnostics.md",
        ])
            expect(files).toContain(file);
        expect(files.join("\n")).not.toMatch(
            /node_modules|__pycache__|\.pyc|cyclecloud\.json|superpowers|bin\/|tests\/|python\//,
        );
        for (const file of files.filter(
            (file) => file !== "SOURCE_COMMIT.json",
        ))
            expect(await readFile(join(output, file))).toEqual(
                await readFile(join(workspace, file)),
            );
        expect((await lstat(join(output, checker))).mode & 0o111).toBe(0o111);
        expect(verify().status).toBe(0);
        const moved = join(workspace, "elsewhere", "persistent source");
        await mkdir(dirname(moved));
        await cp(output, moved, { recursive: true });
        await rm(join(workspace, "skills"), { recursive: true });
        const result = verify(moved);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("source package");
    }, 30_000);

    test.each([
        "skills/use-cyclecloud",
        "skills/author-cyclecloud-application/scripts",
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
        const file = join(workspace, checker);
        await rm(file);
        await symlink(join(root, checker), file);
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
        "altered-source",
        "credential-metadata",
        "manifest-array-type",
    ])("verification rejects %s packages", async (kind) => {
        expect(packageSource().status).toBe(0);
        const output = join(workspace, "dist/cyclecloud-agent-plugin");
        if (kind === "extra")
            await writeFile(join(output, "cyclecloud.json"), "secret");
        if (kind === "missing") await rm(join(output, checker));
        if (kind === "symlink") {
            await rm(join(output, "LICENSE"));
            await symlink(join(root, "LICENSE"), join(output, "LICENSE"));
        }
        if (kind === "mcp" || kind === "manifest-array-type") {
            const path = join(output, "plugin.json");
            const value = JSON.parse(await readFile(path, "utf8")) as Record<
                string,
                unknown
            >;
            if (kind === "mcp") value.mcpServers = {};
            else
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
        if (kind === "altered-source")
            await writeFile(join(output, checker), "process.exit(0);\n");
        expect(verify().status).not.toBe(0);
    });
});
