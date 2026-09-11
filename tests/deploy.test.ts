import { spawnSync } from "node:child_process";
import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let home: string;
let checkout: string;
let installed: string;
let backup: string;
let localBundle: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cyclecloud deploy "));
    checkout = join(home, "checkout");
    installed = join(
        home,
        ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/bin/cyclecloud-mcp.mjs",
    );
    backup = `${installed}.before-local-test`;
    localBundle = join(checkout, "bin/cyclecloud-mcp.mjs");
    await mkdir(join(checkout, "scripts"), { recursive: true });
    await mkdir(join(checkout, "bin"));
    await mkdir(join(installed, ".."), { recursive: true });
    await writeFile(installed, "original installed bundle");
    await writeFile(localBundle, "development bundle 1");
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

async function run(command: string) {
    await copyFile(
        new URL("../scripts/deploy.mjs", import.meta.url),
        join(checkout, "scripts/deploy.mjs"),
    );
    return spawnSync(
        process.execPath,
        [join(checkout, "scripts/deploy.mjs"), command],
        { cwd: home, env: { ...process.env, HOME: home }, encoding: "utf8" },
    );
}

describe("developer deployment", () => {
    test("Deploys repeatedly without replacing the original backup", async () => {
        expect((await run("deploy")).status).toBe(0);
        expect(await readFile(installed, "utf8")).toBe("development bundle 1");
        expect(await readFile(backup, "utf8")).toBe(
            "original installed bundle",
        );

        await writeFile(localBundle, "development bundle 2");
        const result = await run("deploy");
        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(installed, "utf8")).toBe("development bundle 2");
        expect(await readFile(backup, "utf8")).toBe(
            "original installed bundle",
        );
        expect(result.stdout).toContain("fresh Copilot session");
        expect((await readdir(join(installed, ".."))).sort()).toEqual([
            "cyclecloud-mcp.mjs",
            "cyclecloud-mcp.mjs.before-local-test",
        ]);
    });

    test("Restores without a local build and removes the used backup", async () => {
        expect((await run("deploy")).status).toBe(0);
        await rm(localBundle);
        const result = await run("restore");
        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(installed, "utf8")).toBe(
            "original installed bundle",
        );
        await expect(readFile(backup)).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(result.stdout).toContain("fresh Copilot session");
    });

    test("Leaves credential and registration files unchanged", async () => {
        const config = join(
            home,
            ".copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json",
        );
        const manifest = join(installed, "../../mcp.json");
        await mkdir(join(config, ".."), { recursive: true });
        await writeFile(config, "credential canary", { mode: 0o600 });
        await writeFile(manifest, "registration canary");
        await run("deploy");
        await run("restore");
        expect(await readFile(config, "utf8")).toBe("credential canary");
        expect(await readFile(manifest, "utf8")).toBe("registration canary");
    });

    test("Refuses deployment when the plugin is not installed", async () => {
        await rm(installed);
        const result = await run("deploy");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("installed plugin bundle");
        await expect(readFile(backup)).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    test("Refuses deployment without a build, before creating a backup", async () => {
        await rm(localBundle);
        const result = await run("deploy");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("local bundle");
        expect(await readFile(installed, "utf8")).toBe(
            "original installed bundle",
        );
        await expect(readFile(backup)).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    test("Refuses restoration without a backup", async () => {
        const result = await run("restore");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("backup");
        expect(await readFile(installed, "utf8")).toBe(
            "original installed bundle",
        );
    });

    test.each(["deploy", "restore"])(
        "Refuses a symlinked backup during %s",
        async (command) => {
            await symlink(localBundle, backup);
            const result = await run(command);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain("regular file");
            expect(await readFile(installed, "utf8")).toBe(
                "original installed bundle",
            );
            expect(await readFile(localBundle, "utf8")).toBe(
                "development bundle 1",
            );
        },
    );

    test("Refuses a symlinked installed bundle", async () => {
        await rm(installed);
        await symlink(localBundle, installed);
        expect((await run("deploy")).status).toBe(1);
        expect(await readFile(localBundle, "utf8")).toBe(
            "development bundle 1",
        );
    });

    test("Rejects unknown commands without changing files", async () => {
        const result = await run("publish");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("deploy|restore");
        expect(await readFile(installed, "utf8")).toBe(
            "original installed bundle",
        );
    });

    test("npm deploy builds first and restore does not build", async () => {
        const packageJson = JSON.parse(
            await readFile(new URL("../package.json", import.meta.url), "utf8"),
        ) as { scripts: Record<string, string> };
        expect(packageJson.scripts.deploy).toBe(
            "npm run build && node scripts/deploy.mjs deploy",
        );
        expect(packageJson.scripts.restore).toBe(
            "node scripts/deploy.mjs restore",
        );
    });
});
