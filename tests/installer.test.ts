import { spawnSync } from "node:child_process";
import {
    chmod,
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
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const installer = fileURLToPath(new URL("../install.sh", import.meta.url));
const template = fileURLToPath(
    new URL("../cyclecloud.example.json", import.meta.url),
);
const fakeCopilot = fileURLToPath(
    new URL("./helpers/fake-copilot.mjs", import.meta.url),
);
const pluginId = "cyclecloud-mcp@cyclecloud-mcp";
const installCommand = `plugin install ${pluginId}`;
const marketplaceCommand = "plugin marketplace add gingi/cyclecloud-mcp";

interface CliState {
    plugins: Array<{
        name: string;
        marketplace: string;
        version: string;
        enabled: boolean;
        source: string;
    }>;
    marketplaces: Array<{ name: string; source: string; isDefault: boolean }>;
    failCommand?: string;
    omitTemplate?: boolean;
}

let home: string;
let bin: string;
let data: string;
let config: string;
let statePath: string;
let callsPath: string;
let state: CliState;

function quote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

async function executable(name: string, body: string): Promise<void> {
    await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o700 });
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cyclecloud installer "));
    bin = join(home, "bin");
    data = join(home, ".copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp");
    config = join(data, "cyclecloud.json");
    statePath = join(home, "cli-state.json");
    callsPath = join(home, "cli-calls.jsonl");
    state = { plugins: [], marketplaces: [] };
    await mkdir(bin);
    await saveState();
    await executable("uname", 'printf "%s\\n" "${FAKE_OS:-Linux}"');
    await executable(
        "node",
        `if [ "$1" = "--version" ]; then\n` +
            `    printf '%s\\n' "\${FAKE_NODE_VERSION:-v24.13.1}"\n` +
            `else\n    exec ${quote(process.execPath)} "$@"\nfi`,
    );
    await executable(
        "copilot",
        `exec ${quote(process.execPath)} ${quote(fakeCopilot)} "$@"`,
    );
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

async function saveState(): Promise<void> {
    await writeFile(statePath, JSON.stringify(state));
}

async function calls(): Promise<string[]> {
    const text = await readFile(callsPath, "utf8").catch(() => "");
    return text.trim()
        ? text
              .trim()
              .split("\n")
              .map((l) => (JSON.parse(l) as string[]).join(" "))
        : [];
}

function run(extraEnv: Record<string, string> = {}, input?: string) {
    return spawnSync("/bin/sh", input === undefined ? [installer] : ["-s"], {
        cwd: home,
        env: {
            HOME: home,
            PATH: bin,
            FAKE_COPILOT_STATE: statePath,
            FAKE_COPILOT_CALLS: callsPath,
            FAKE_COPILOT_TEMPLATE: template,
            ...extraEnv,
        },
        input,
        encoding: "utf8",
        timeout: 10_000,
    });
}

describe("installer", () => {
    test("Installs through Copilot and prepares a private template", async () => {
        const result = run();
        expect(result.status, result.stderr).toBe(0);
        expect(await calls()).toContain(marketplaceCommand);
        expect(await calls()).toContain(installCommand);
        expect((await lstat(data)).mode & 0o777).toBe(0o700);
        expect((await lstat(config)).mode & 0o777).toBe(0o600);
        expect(await readFile(config, "utf8")).toBe(
            await readFile(template, "utf8"),
        );
        expect(result.stdout).toContain(config);
        expect(result.stdout).toContain("enableMutations");
        expect(result.stdout).not.toContain('"password"');
    });

    test("Works detached from the repository when passed through stdin", async () => {
        const result = run({}, await readFile(installer, "utf8"));
        expect(result.status, result.stderr).toBe(0);
        expect((await lstat(config)).mode & 0o777).toBe(0o600);
    });

    test("Reruns preserve credentials and disabled plugin state without upgrades", async () => {
        expect(run().status).toBe(0);
        await writeFile(config, "secret sentinel: do not read or print\n");
        await chmod(config, 0o400);
        state = JSON.parse(await readFile(statePath, "utf8")) as CliState;
        const installed = state.plugins[0];
        if (!installed) throw new Error("Fixture plugin was not installed");
        installed.enabled = false;
        await saveState();
        await writeFile(callsPath, "");

        const result = run();
        expect(result.status, result.stderr).toBe(0);
        expect(await calls()).toEqual([
            "plugin list --json",
            "plugin marketplace list --json",
        ]);
        expect(await readFile(config, "utf8")).toContain("secret sentinel");
        expect((await lstat(config)).mode & 0o777).toBe(0o400);
        expect(result.stdout).toContain("disabled");
        expect(result.stdout + result.stderr).not.toContain("secret sentinel");
    });

    test.each([
        "v20.18.9",
        "v22.11.9",
        "v21.7.0",
        "v23.1.0",
        "v18.20.0",
        "v24.0.0-rc.1",
    ])(
        "Rejects unsupported Node %s before invoking Copilot",
        async (version) => {
            const result = run({ FAKE_NODE_VERSION: version });
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("Node");
            expect(await calls()).toEqual([]);
        },
    );

    test.each(["v20.19.0", "v22.12.0", "v24.0.0", "v25.0.0"])(
        "Accepts supported Node %s",
        (version) => {
            const result = run({ FAKE_NODE_VERSION: version });
            expect(result.status, result.stderr).toBe(0);
        },
    );

    test("Accepts macOS", () => {
        const result = run({ FAKE_OS: "Darwin" });
        expect(result.status, result.stderr).toBe(0);
    });

    test("Rejects native Windows before invoking Copilot", async () => {
        const result = run({ FAKE_OS: "MINGW64_NT-10.0" });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("WSL");
        expect(await calls()).toEqual([]);
    });

    test.each(["node", "copilot"])("Explains missing %s", async (name) => {
        await rm(join(bin, name));
        const result = run();
        expect(result.status).not.toBe(0);
        expect(result.stderr.toLowerCase()).toContain(name);
        expect(await calls()).toEqual([]);
    });

    test.each([
        "plugin list --json",
        "plugin marketplace list --json",
        marketplaceCommand,
        installCommand,
    ])("Stops on %s failure and permits a safe retry", async (command) => {
        state.failCommand = command;
        await saveState();
        const failed = run();
        expect(failed.status).not.toBe(0);
        await expect(lstat(config)).rejects.toMatchObject({ code: "ENOENT" });
        state = JSON.parse(await readFile(statePath, "utf8")) as CliState;
        delete state.failCommand;
        await saveState();
        expect(run().status).toBe(0);
    });

    test("Rejects a marketplace name already registered to another source", async () => {
        state.marketplaces.push({
            name: "cyclecloud-mcp",
            source: "GitHub: other/repo",
            isDefault: false,
        });
        await saveState();
        const result = run();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("source");
        expect(await calls()).not.toContain(installCommand);
    });

    test("Rejects same-name plugins from another source", async () => {
        state.plugins.push({
            name: "cyclecloud-mcp",
            marketplace: "other",
            version: "1.0.0",
            enabled: true,
            source: "installed",
        });
        await saveState();
        const result = run();
        expect(result.status).not.toBe(0);
        expect(await calls()).not.toContain(installCommand);
        expect(await calls()).not.toContain(marketplaceCommand);
    });

    test("Reports an old installation with no template without upgrading it", async () => {
        state.omitTemplate = true;
        await saveState();
        const result = run();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("template");
        await expect(lstat(config)).rejects.toMatchObject({ code: "ENOENT" });
        expect((await calls()).some((c) => c.includes("update"))).toBe(false);
    });

    test("Rejects a symlinked data directory", async () => {
        await mkdir(join(home, ".copilot"));
        const target = join(home, "shared-data");
        await mkdir(target);
        await symlink(target, join(home, ".copilot/plugin-data"));
        const result = run();
        expect(result.status).not.toBe(0);
        await expect(
            lstat(join(target, "cyclecloud-mcp")),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("Rejects a credential symlink without touching its target", async () => {
        await mkdir(data, { recursive: true });
        const target = join(home, "must-not-create");
        await symlink(target, config);
        expect(run().status).not.toBe(0);
        expect((await lstat(config)).isSymbolicLink()).toBe(true);
        await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("Rejects unsupported CLI JSON without installing anything", async () => {
        await writeFile(statePath, JSON.stringify({ ...state, plugins: {} }));
        const result = run();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("JSON");
        expect(await calls()).toEqual(["plugin list --json"]);
        await expect(lstat(config)).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("Preserves existing configuration even when an older package has no template", async () => {
        expect(run().status).toBe(0);
        const installedTemplate = join(
            home,
            ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.example.json",
        );
        await rm(installedTemplate);
        await writeFile(callsPath, "");
        const result = run();
        expect(result.status, result.stderr).toBe(0);
        expect(await calls()).not.toContain(installCommand);
        expect(await readFile(config, "utf8")).toBe(
            await readFile(template, "utf8"),
        );
    });

    test("Rejects a template containing credentials or unsafe defaults", async () => {
        const unsafe = join(home, "unsafe-template.json");
        await writeFile(
            unsafe,
            JSON.stringify({
                password: "never print me",
                enableMutations: true,
            }),
        );
        const result = run({ FAKE_COPILOT_TEMPLATE: unsafe });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("template");
        expect(result.stdout + result.stderr).not.toContain("never print me");
        await expect(lstat(config)).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("Shows help without dependencies or changes", async () => {
        const result = spawnSync("/bin/sh", [installer, "--help"], {
            env: { HOME: home, PATH: "" },
            encoding: "utf8",
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Usage:");
        expect(await calls()).toEqual([]);
    });

    test("Does not chmod or overwrite an insecure existing configuration", async () => {
        await mkdir(data, { recursive: true });
        await writeFile(config, "leave unchanged");
        await chmod(config, 0o644);
        const result = run();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("0600");
        expect((await lstat(config)).mode & 0o777).toBe(0o644);
        expect(await readFile(config, "utf8")).toBe("leave unchanged");
    });
});
