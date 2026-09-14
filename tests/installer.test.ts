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
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfiguration } from "../src/config.js";

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
        marketplace?: string;
        kind?: string;
        scope?: string;
        version?: string;
        enabled: boolean;
        source: string;
    }>;
    marketplaces: Array<{ name: string; source: string; isDefault: boolean }>;
    failCommand?: string;
    flatPluginJson?: boolean;
    pluginListOutput?: unknown;
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
    return spawnSync(
        "/bin/sh",
        input === undefined
            ? [installer, "--skip-config"]
            : ["-s", "--", "--skip-config"],
        {
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
        },
    );
}

function runTerminal(
    steps: string[][] = [],
    args: string[] = [],
    piped = false,
    detached = false,
): { status: number; output: string } {
    const result = spawnSync(
        "python3",
        [fileURLToPath(new URL("./helpers/installer-pty.py", import.meta.url))],
        {
            input: JSON.stringify({
                installer,
                args,
                steps,
                piped,
                detached,
                env: {
                    HOME: home,
                    PATH: bin,
                    FAKE_COPILOT_STATE: statePath,
                    FAKE_COPILOT_CALLS: callsPath,
                    FAKE_COPILOT_TEMPLATE: template,
                },
            }),
            encoding: "utf8",
            timeout: 10_000,
        },
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as { status: number; output: string };
}

// Readline redraws with column-one + erase-to-end-of-screen. Discard erased
// text before stripping ANSI codes; raw output can contain invisible prompts.
function readlineTranscript(output: string): string {
    return output
        .split("\n")
        .map((line) =>
            stripVTControlCharacters(line.split("\x1b[1G\x1b[0J").at(-1) ?? ""),
        )
        .join("\n");
}

const answers = [
    ["CycleCloud URL", "https://cluster.example.com\n"],
    ["Username", "reader\n"],
    ["Password", 'private-"password\\value\n'],
];

describe("Interactive configuration", () => {
    test("Without a controlling terminal, creates a template and preserves it on rerun", async () => {
        const result = runTerminal([], [], false, true);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("No interactive terminal");
        expect(await readFile(config, "utf8")).toBe(
            await readFile(template, "utf8"),
        );
        await writeFile(config, "unread secret sentinel");
        const rerun = runTerminal([], [], false, true);
        expect(rerun.status, rerun.output).toBe(0);
        expect(rerun.output).not.toContain("unread secret sentinel");
        expect(await readFile(config, "utf8")).toBe("unread secret sentinel");
    });

    test("Fresh configuration uses template defaults and no longer requests manual editing", async () => {
        const result = runTerminal(answers);
        expect(result.status, result.output).toBe(0);
        const expected = JSON.parse(await readFile(template, "utf8")) as Record<
            string,
            unknown
        >;
        expect(JSON.parse(await readFile(config, "utf8"))).toEqual({
            ...expected,
            url: "https://cluster.example.com",
            username: "reader",
            password: 'private-"password\\value',
        });
        expect(result.output).not.toContain("1. Edit");
        expect(result.output).toMatch(
            /1\. If in VS Code, run "Developer: Reload Window"\.[\s\S]*2\. Start a new agent session in VS Code or Copilot CLI\.[\s\S]*3\. Ask:/,
        );
        expect(result.output).not.toContain("Ensure");
    });

    test("Invalid answers are retried without saving partial configuration", async () => {
        const result = runTerminal([
            ["CycleCloud URL", "not-a-url\n"],
            ["CycleCloud URL", "http://127.0.0.1:8080\n"],
            ["Username", "invalid:username\n"],
            ["Username", "reader\n"],
            ["Password", "\n"],
            ["Password", "hidden-secret\n"],
        ]);
        expect(result.status, result.output).toBe(0);
        expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject({
            url: "http://127.0.0.1:8080",
            username: "reader",
            password: "hidden-secret",
        });
        expect(result.output).not.toContain("hidden-secret");
    });

    test("Cancelling first-time setup creates no config or plugin", async () => {
        const result = runTerminal([["CycleCloud URL", "\x03"]]);
        expect(result.status).not.toBe(0);
        await expect(lstat(config)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await calls()).not.toContain(installCommand);
    });

    test.each([false, true])(
        "Prompts and saves before installation (piped=%s)",
        async (piped) => {
            state.failCommand = installCommand;
            await saveState();
            const result = runTerminal(answers, [], piped);
            expect(result.status).not.toBe(0);
            expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject({
                url: "https://cluster.example.com",
                username: "reader",
                password: 'private-"password\\value',
                verifyTls: true,
                enableMutations: false,
            });
            expect((await lstat(config)).mode & 0o777).toBe(0o600);
            expect((await lstat(data)).mode & 0o777).toBe(0o700);
            expect(result.output).not.toContain("private-");
            expect(result.output).toContain("Saved private configuration");
        },
    );

    test("Uses masked defaults and preserves unchanged bytes, mode, and optional settings", async () => {
        await mkdir(data, { recursive: true });
        const contents = JSON.stringify({
            url: "https://existing.example.com",
            username: "existing-user",
            password: "existing-secret",
            caCertPath: "/private/ca.pem",
            debug: true,
        });
        await writeFile(config, contents, { mode: 0o400 });
        const result = runTerminal([
            ["CycleCloud URL", "\n"],
            ["Username", "\n"],
            ["Password", "\n"],
        ]);
        expect(result.status, result.output).toBe(0);
        const visible = readlineTranscript(result.output);
        expect(visible).toContain(
            "CycleCloud URL [https://existing.example.com]: ",
        );
        expect(visible).toContain("Username [existing-user]: ");
        expect(visible).toContain("Password [********]: ");
        expect(result.output).not.toContain("existing-secret");
        expect(result.output).not.toContain("1. Edit");
        expect(await readFile(config, "utf8")).toBe(contents);
        expect((await lstat(config)).mode & 0o777).toBe(0o400);
    });

    test("Updates credentials while preserving other settings and mode", async () => {
        await mkdir(data, { recursive: true });
        await writeFile(
            config,
            JSON.stringify({
                url: "https://old.example.com",
                username: "old",
                password: "old-secret",
                enableMutations: true,
            }),
            { mode: 0o400 },
        );
        const result = runTerminal(answers);
        expect(result.status, result.output).toBe(0);
        expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject({
            username: "reader",
            enableMutations: true,
        });
        expect((await lstat(config)).mode & 0o777).toBe(0o400);
        expect(result.output).not.toContain("old-secret");
    });

    test.each(["\x03", "\x04"])(
        "Cancellation leaves existing configuration unchanged (%j)",
        async (cancel) => {
            expect(run().status).toBe(0);
            const contents = await readFile(config, "utf8");
            await writeFile(callsPath, "");
            const result = runTerminal([
                ["CycleCloud URL", "https://new.example.com\n"],
                ["Username", "reader\n"],
                ["Password", cancel],
            ]);
            expect(result.status).not.toBe(0);
            expect(await readFile(config, "utf8")).toBe(contents);
            expect(await calls()).not.toContain(installCommand);
        },
    );

    test("Malformed JSON fails without leaking or overwriting contents", async () => {
        await mkdir(data, { recursive: true });
        await writeFile(config, "invalid secret contents", { mode: 0o600 });
        const result = runTerminal();
        expect(result.status).not.toBe(0);
        expect(result.output).toContain("Invalid configuration JSON");
        expect(result.output).not.toContain("invalid secret contents");
        expect(await readFile(config, "utf8")).toBe("invalid secret contents");
    });

    test("--skip-config avoids prompts and preserves existing configuration unread", async () => {
        await mkdir(data, { recursive: true });
        await writeFile(config, "do not parse secret", { mode: 0o600 });
        const result = runTerminal([], ["--skip-config"]);
        expect(result.status, result.output).toBe(0);
        expect(result.output).not.toContain("Password");
        expect(result.output).not.toContain("do not parse secret");
        expect(await readFile(config, "utf8")).toBe("do not parse secret");
    });

    test("--skip-config prepares a private template on fresh installation", async () => {
        const result = runTerminal([], ["--skip-config"]);
        expect(result.status, result.output).toBe(0);
        expect(await readFile(config, "utf8")).toBe(
            await readFile(template, "utf8"),
        );
        expect(result.output).toContain("1. Edit");
    });
});

describe("Interactive transport validation", () => {
    test.each(["http://remote.example.com:8080", "http://localhost:8080"])(
        "Rejects fresh remote HTTP without saving or installing: %s",
        async (url) => {
            const result = runTerminal([
                ["CycleCloud URL", `${url}\n`],
                ...answers.slice(1),
            ]);
            expect(result.status, result.output).not.toBe(0);
            expect(result.output).toContain("Invalid transport configuration");
            expect(result.output).toContain("allowInsecureHttp: true");
            expect(result.output).toContain("verified HTTPS");
            expect(result.output).not.toContain("Saved private configuration");
            expect(result.output).not.toContain("Next steps:");
            await expect(lstat(config)).rejects.toMatchObject({
                code: "ENOENT",
            });
            expect(await calls()).not.toContain(installCommand);
        },
    );

    test.each([
        [
            "HTTP opt-in with HTTPS",
            "http://remote.example.com",
            { allowInsecureHttp: true },
            "https://remote.example.com",
            "allowInsecureHttp: false",
        ],
        [
            "unverified remote HTTPS",
            "https://127.0.0.1",
            { verifyTls: false },
            "https://remote.example.com",
            "verifyTls",
        ],
        [
            "HTTP with verification disabled",
            "https://127.0.0.1",
            { verifyTls: false },
            "http://127.0.0.1",
            "verifyTls: true",
        ],
        [
            "HTTP with a CA",
            "https://remote.example.com",
            { caCertPath: "/private/ca.pem" },
            "http://127.0.0.1",
            "caCertPath",
        ],
        [
            "loopback HTTP with remote opt-in",
            "http://remote.example.com",
            { allowInsecureHttp: true },
            "http://127.0.0.1",
            "allowInsecureHttp: false",
        ],
        [
            "unchanged invalid configuration",
            "http://remote.example.com",
            {},
            "",
            "allowInsecureHttp: true",
        ],
        [
            "unverified loopback HTTPS with a CA",
            "https://127.0.0.1",
            { verifyTls: false, caCertPath: "/private/ca.pem" },
            "",
            "caCertPath",
        ],
        [
            "invalid verifyTls type",
            "https://remote.example.com",
            { verifyTls: "true" },
            "",
            "verifyTls",
        ],
        [
            "invalid allowInsecureHttp type",
            "https://remote.example.com",
            { allowInsecureHttp: null },
            "",
            "allowInsecureHttp",
        ],
        [
            "relative CA path",
            "https://remote.example.com",
            { caCertPath: "private/ca.pem" },
            "",
            "caCertPath",
        ],
    ])(
        "Rejects %s and preserves existing bytes and permissions",
        async (_label, url, settings, answer, field) => {
            await mkdir(data, { recursive: true });
            const contents = JSON.stringify({
                url,
                username: "reader",
                password: "original-secret",
                ...settings,
            });
            await writeFile(config, contents, { mode: 0o400 });
            const result = runTerminal([
                ["CycleCloud URL", `${answer}\n`],
                ["Username", "\n"],
                ["Password", "\n"],
            ]);
            expect(result.status, result.output).not.toBe(0);
            expect(result.output).toContain("Invalid transport configuration");
            expect(result.output).toContain(field);
            expect(result.output).toContain("Nothing was saved");
            expect(result.output).not.toContain("original-secret");
            expect(result.output).not.toContain("Next steps:");
            expect(await readFile(config, "utf8")).toBe(contents);
            expect((await lstat(config)).mode & 0o777).toBe(0o400);
            expect(await calls()).not.toContain(installCommand);
        },
    );

    test.each([
        [
            "verified HTTPS with implicit defaults",
            "https://remote.example.com",
            {},
        ],
        [
            "verified HTTPS with a CA",
            "https://remote.example.com",
            { caCertPath: "/private/ca.pem" },
        ],
        ["loopback HTTP", "http://127.0.0.1:8080", {}],
        ["loopback range HTTP", "http://127.42.0.2:8080", {}],
        ["IPv6 loopback HTTP", "http://[::1]:8080", {}],
        [
            "explicit remote HTTP",
            "http://remote.example.com:8080",
            { allowInsecureHttp: true },
        ],
        [
            "unverified loopback HTTPS",
            "https://127.0.0.1",
            { verifyTls: false },
        ],
        [
            "unverified IPv6 loopback HTTPS",
            "https://[::1]",
            { verifyTls: false },
        ],
    ])(
        "Accepts %s consistently with the runtime",
        async (_label, url, settings) => {
            await mkdir(data, { recursive: true });
            const document = {
                url,
                username: "reader",
                password: "original-secret",
                ...settings,
            };
            await writeFile(config, JSON.stringify(document), { mode: 0o600 });
            const result = runTerminal([
                ["CycleCloud URL", "\n"],
                ["Username", "updated-reader\n"],
                ["Password", "\n"],
            ]);
            expect(result.status, result.output).toBe(0);
            expect(JSON.parse(await readFile(config, "utf8"))).toEqual({
                ...document,
                username: "updated-reader",
            });
            await expect(
                loadConfiguration({ pluginData: data }),
            ).resolves.toMatchObject({
                settings: { url: new URL(url).origin },
            });
            expect(result.output).not.toContain("original-secret");
        },
    );
});

describe.each([false, true])(
    "installer (flatPluginJson=%s)",
    (flatPluginJson) => {
        beforeEach(async () => {
            state.flatPluginJson = flatPluginJson;
            await saveState();
        });

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
            expect(result.stdout).toContain(
                "Use the cyclecloud MCP to list my clusters\n",
            );
        });

        test("Prints concise host-aware session steps without enablement checks", () => {
            const result = run();
            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout).toMatch(
                /1\. Edit [\s\S]*2\. If in VS Code, run "Developer: Reload Window"\.[\s\S]*3\. Start a new agent session in VS Code or Copilot CLI\.[\s\S]*4\. Ask:/,
            );
            expect(result.stdout).not.toContain("Ensure");
            expect(result.stdout).not.toContain("Chat: Plugins Enabled");
            expect(result.stdout).not.toContain("Agent Plugins - Installed");
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
                "plugins list --json",
                "plugin marketplace list",
            ]);
            expect(await readFile(config, "utf8")).toContain("secret sentinel");
            expect((await lstat(config)).mode & 0o777).toBe(0o400);
            expect(result.stdout).toContain("disabled");
            expect(result.stdout + result.stderr).not.toContain(
                "secret sentinel",
            );
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
            "plugins list --json",
            "plugin marketplace list",
            marketplaceCommand,
            installCommand,
        ])("Stops on %s failure and permits a safe retry", async (command) => {
            state.failCommand = command;
            await saveState();
            const failed = run();
            expect(failed.status).not.toBe(0);
            await expect(lstat(config)).rejects.toMatchObject({
                code: "ENOENT",
            });
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
                version: "1.0.0",
                enabled: true,
                ...(flatPluginJson
                    ? { marketplace: "other", source: "installed" }
                    : {
                          kind: "plugin",
                          scope: "user",
                          source: "marketplace:other",
                      }),
            });
            await saveState();
            const result = run();
            expect(result.status).not.toBe(0);
            expect(await calls()).not.toContain(installCommand);
            expect(await calls()).not.toContain(marketplaceCommand);
        });

        test("Reports a missing template with complete-package recovery instructions", async () => {
            state.omitTemplate = true;
            await saveState();
            const result = run();
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain(
                "Installed configuration template is missing:",
            );
            expect(result.stderr).toContain(
                "Reinstall a complete plugin package, then rerun this installer.",
            );
            await expect(lstat(config)).rejects.toMatchObject({
                code: "ENOENT",
            });
            expect((await calls()).some((c) => c.includes("update"))).toBe(
                false,
            );
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
            await expect(lstat(target)).rejects.toMatchObject({
                code: "ENOENT",
            });
        });

        test("Rejects unsupported CLI JSON without installing anything", async () => {
            await writeFile(
                statePath,
                JSON.stringify({ ...state, plugins: {} }),
            );
            const result = run();
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("JSON");
            expect(result.stderr).toContain("1.0.81");
            expect(await calls()).toEqual(["plugins list --json"]);
            await expect(lstat(config)).rejects.toMatchObject({
                code: "ENOENT",
            });
        });

        test("Rejects duplicate same-name plugins", async () => {
            expect(run().status).toBe(0);
            state = JSON.parse(await readFile(statePath, "utf8")) as CliState;
            const installed = state.plugins[0];
            if (!installed) throw new Error("Fixture plugin was not installed");
            state.plugins.push({ ...installed });
            await saveState();
            await writeFile(callsPath, "");
            const result = run();
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("conflicting source");
            expect(await calls()).toEqual(["plugins list --json"]);
        });

        describe.skipIf(flatPluginJson)("legacy plugin inventory", () => {
            test.each([false, true])(
                "Ignores same-name MCP servers and skills (installed=%s)",
                async (installed) => {
                    if (installed) {
                        expect(run().status).toBe(0);
                        state = JSON.parse(
                            await readFile(statePath, "utf8"),
                        ) as CliState;
                    }
                    for (const kind of ["mcp", "skill"]) {
                        state.plugins.push({
                            kind,
                            name: "cyclecloud-mcp",
                            scope: "plugin",
                            source: "plugin",
                            enabled: true,
                        });
                    }
                    await saveState();
                    await writeFile(callsPath, "");
                    const result = run();
                    expect(result.status, result.stderr).toBe(0);
                    expect((await calls()).includes(installCommand)).toBe(
                        !installed,
                    );
                },
            );

            test.each([
                { source: "direct" },
                { source: "marketplace:other" },
                { scope: "project" },
                { scope: undefined },
                { source: undefined },
                { enabled: "true" },
                { enabled: undefined },
                { kind: undefined },
            ])("Rejects unsupported plugin metadata: %j", async (metadata) => {
                state.pluginListOutput = {
                    plugins: [
                        {
                            kind: "plugin",
                            name: "cyclecloud-mcp",
                            scope: "user",
                            source: "marketplace:cyclecloud-mcp",
                            enabled: true,
                            ...metadata,
                        },
                    ],
                    errors: [],
                };
                await saveState();
                const result = run();
                expect(result.status).not.toBe(0);
                expect(result.stderr).toContain("cyclecloud-mcp installer:");
                expect(await calls()).toEqual(["plugins list --json"]);
                await expect(lstat(config)).rejects.toMatchObject({
                    code: "ENOENT",
                });
            });

            test.each([
                { plugins: [], errors: ["Inventory unavailable"] },
                { plugins: [], errors: {} },
                { plugins: [] },
            ])("Rejects incomplete inventories: %j", async (output) => {
                state.pluginListOutput = output;
                await saveState();
                const result = run();
                expect(result.status).not.toBe(0);
                expect(result.stderr).toContain("cyclecloud-mcp installer:");
                expect(await calls()).toEqual(["plugins list --json"]);
                await expect(lstat(config)).rejects.toMatchObject({
                    code: "ENOENT",
                });
            });
        });

        test("Preserves existing configuration even when the installed template is missing", async () => {
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
            expect(result.stdout + result.stderr).not.toContain(
                "never print me",
            );
            await expect(lstat(config)).rejects.toMatchObject({
                code: "ENOENT",
            });
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
    },
);
