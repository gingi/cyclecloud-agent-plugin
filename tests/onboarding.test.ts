import { spawnSync } from "node:child_process";
import {
    chmod,
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let home: string;
let plugin: string;
let data: string;
let config: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cyclecloud onboarding "));
    plugin = join(
        home,
        ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
    );
    data = join(home, ".copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp");
    config = join(data, "cyclecloud.json");
    await mkdir(plugin, { recursive: true });
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

async function installTemplate(): Promise<void> {
    await copyFile(
        new URL("../cyclecloud.example.json", import.meta.url),
        join(plugin, "cyclecloud.example.json"),
    );
}

async function runSetup() {
    const troubleshooting = await readFile(
        new URL("../docs/troubleshooting.md", import.meta.url),
        "utf8",
    );
    const section = troubleshooting.split("### Prepare configuration")[1];
    const command = section?.match(/```bash\n([\s\S]*?)\n```/)?.[1];
    expect(command, "Manual setup command must be documented").toBeTruthy();
    if (!command) throw new Error("Missing setup command");
    return spawnSync("sh", ["-c", `umask 000;\n${command}`], {
        env: { ...process.env, HOME: home },
        encoding: "utf8",
        timeout: 5_000,
    });
}

describe("Documented manual configuration setup", () => {
    test("Copies the template privately with spaces in HOME", async () => {
        await installTemplate();

        const result = await runSetup();

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
        expect((await lstat(data)).mode & 0o777).toBe(0o700);
        expect((await lstat(config)).mode & 0o777).toBe(0o600);
        expect(await readFile(config, "utf8")).toBe(
            await readFile(join(plugin, "cyclecloud.example.json"), "utf8"),
        );
    });

    test("Refuses to overwrite or chmod an existing credential file", async () => {
        await installTemplate();
        await mkdir(data, { recursive: true });
        await writeFile(config, "keep existing configuration\n");
        await chmod(config, 0o400);

        const result = await runSetup();

        expect(result.status).not.toBe(0);
        expect(await readFile(config, "utf8")).toBe(
            "keep existing configuration\n",
        );
        expect((await lstat(config)).mode & 0o777).toBe(0o400);
    });

    test("Refuses to follow a dangling destination symlink", async () => {
        await installTemplate();
        await mkdir(data, { recursive: true });
        const target = join(home, "must-not-create.json");
        await symlink(target, config);

        const result = await runSetup();

        expect(result.status).not.toBe(0);
        expect((await lstat(config)).isSymbolicLink()).toBe(true);
        await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("Does not leave an empty configuration when the template is missing", async () => {
        const result = await runSetup();

        expect(result.status).not.toBe(0);
        await expect(lstat(config)).rejects.toMatchObject({ code: "ENOENT" });
    });
});
