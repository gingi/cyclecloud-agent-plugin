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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { startFakeCycleCloudServer } from "./helpers/fake-cyclecloud.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
    "plugin.json",
    "bin/cyclecloud-mcp.mjs",
    "cyclecloud.example.json",
    "LICENSE",
    "install.sh",
    ".github/plugin/marketplace.json",
];
let home: string;
let source: string;
let managed: string;
let config: string;
let statePath: string;
let callsPath: string;
let env: Record<string, string>;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cyclecloud local install (test) "));
    source = join(home, "source package");
    managed = join(home, ".local/share/cyclecloud-mcp/marketplace");
    config = join(
        home,
        ".copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json",
    );
    for (const file of files) {
        await mkdir(dirname(join(source, file)), { recursive: true });
        await copyFile(join(root, file), join(source, file));
    }
    const bin = join(home, "commands");
    await mkdir(bin);
    await symlink(process.execPath, join(bin, "node"));
    await symlink("/usr/bin/uname", join(bin, "uname"));
    await symlink("/usr/bin/dirname", join(bin, "dirname"));
    await writeFile(
        join(bin, "copilot"),
        `#!/bin/sh\nexec '${process.execPath}' '${join(root, "tests/helpers/fake-copilot.mjs")}' "$@"\n`,
        { mode: 0o700 },
    );
    statePath = join(home, "state.json");
    callsPath = join(home, "calls.jsonl");
    await writeFile(
        statePath,
        JSON.stringify({
            plugins: [],
            marketplaces: [],
            flatPluginJson: true,
            liveLocal: true,
        }),
    );
    env = {
        HOME: home,
        PATH: bin,
        FAKE_COPILOT_STATE: statePath,
        FAKE_COPILOT_CALLS: callsPath,
        FAKE_COPILOT_TEMPLATE: join(root, "cyclecloud.example.json"),
    };
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

function run(...args: string[]) {
    return spawnSync("/bin/sh", [join(source, "install.sh"), ...args], {
        cwd: home,
        env,
        encoding: "utf8",
        timeout: 15_000,
    });
}
interface State {
    plugins: Array<{
        name: string;
        enabled: boolean;
        source: string;
        marketplace?: string;
        installedFrom?: string;
    }>;
    marketplaces: Array<{ name: string; source: string }>;
    liveLocal: boolean;
    failCommand?: string;
}
async function state(): Promise<State> {
    return JSON.parse(await readFile(statePath, "utf8")) as State;
}
async function mutateState(
    change: (value: Awaited<ReturnType<typeof state>>) => void,
) {
    const value = await state();
    change(value);
    await writeFile(statePath, JSON.stringify(value));
}
async function calls(): Promise<string[]> {
    return (await readFile(callsPath, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as string[]).join(" "));
}

describe("Independent local installation", () => {
    test("Packages only distributable runtime files and supports packaging twice", async () => {
        for (let i = 0; i < 2; i++) {
            const result = spawnSync(
                process.execPath,
                [join(root, "scripts/package-local.mjs")],
                { encoding: "utf8" },
            );
            expect(result.status, result.stderr).toBe(0);
        }
        const { readdir } = await import("node:fs/promises");
        const packaged = join(root, "dist/cyclecloud-mcp");
        const entries = await readdir(packaged, {
            recursive: true,
            withFileTypes: true,
        });
        const names = entries
            .filter((entry) => entry.isFile())
            .map((entry) =>
                join(entry.parentPath, entry.name).slice(packaged.length + 1),
            );
        expect(names.sort()).toEqual([...files].sort());
        for (const file of files) {
            expect(
                (await readFile(join(packaged, file))).equals(
                    await readFile(join(root, file)),
                ),
            ).toBe(true);
        }
    }, 15_000);
    test.each([true, false])(
        "Installs privately and reruns without changes (live=%s)",
        async (liveLocal) => {
            await mutateState((value) => {
                value.liveLocal = liveLocal;
            });
            let result = run("--local");
            expect(result.status, result.stderr).toBe(0);
            expect((await lstat(config)).mode & 0o777).toBe(0o600);
            expect(await readFile(join(managed, "plugin.json"), "utf8")).toBe(
                await readFile(join(source, "plugin.json"), "utf8"),
            );
            await writeFile(config, "credential sentinel\n");
            await chmod(config, 0o400);
            await mutateState((value) => {
                value.plugins.forEach((plugin) => {
                    plugin.enabled = false;
                });
            });
            await writeFile(callsPath, "");
            const before = await lstat(join(managed, "bin/cyclecloud-mcp.mjs"));
            result = run("--local", source);
            expect(result.status, result.stderr).toBe(0);
            expect(await calls()).toEqual([
                "plugins list --json",
                "plugin marketplace list",
            ]);
            expect(
                (await lstat(join(managed, "bin/cyclecloud-mcp.mjs"))).mtimeMs,
            ).toBe(before.mtimeMs);
            expect(await readFile(config, "utf8")).toBe(
                "credential sentinel\n",
            );
            expect((await lstat(config)).mode & 0o777).toBe(0o400);
            expect(result.stdout + result.stderr).not.toContain(
                "credential sentinel",
            );
            expect((await state()).plugins).toHaveLength(1);
            expect((await state()).plugins[0]?.enabled).toBe(false);
            expect(JSON.stringify(await state())).not.toContain(source);
        },
    );

    test.each([true, false])(
        "Updates changed payload and repairs missing files (live=%s)",
        async (liveLocal) => {
            await mutateState((value) => {
                value.liveLocal = liveLocal;
            });
            expect(run("--local").status).toBe(0);
            await writeFile(join(source, "LICENSE"), "updated license\n");
            expect(run("--local").status).toBe(0);
            expect(await readFile(join(managed, "LICENSE"), "utf8")).toBe(
                "updated license\n",
            );
            const installed = liveLocal
                ? managed
                : join(
                      home,
                      ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
                  );
            expect(await readFile(join(installed, "LICENSE"), "utf8")).toBe(
                "updated license\n",
            );
            await rm(join(installed, "plugin.json"));
            const result = run("--local");
            expect(result.status, result.stderr).toBe(0);
            expect(
                await readFile(join(installed, "plugin.json"), "utf8"),
            ).toContain("cyclecloud");
        },
    );

    test("Explicitly switches the known remote source without losing credentials or enablement", async () => {
        expect(run().status).toBe(0);
        await writeFile(config, "keep me\n");
        await mutateState((value) => {
            value.plugins.forEach((plugin) => {
                plugin.enabled = false;
            });
        });
        const result = run("--local");
        expect(result.status, result.stderr).toBe(0);
        expect((await state()).plugins).toHaveLength(1);
        expect((await state()).plugins[0]?.enabled).toBe(false);
        expect(await readFile(config, "utf8")).toBe("keep me\n");
        expect(run().status).not.toBe(0); // Never silently undo a local install.
    });

    test("Preserves disabled state across a partial source-switch failure and retry", async () => {
        expect(run().status).toBe(0);
        await mutateState((value) => {
            value.plugins.forEach((plugin) => {
                plugin.enabled = false;
            });
            value.failCommand = `plugin marketplace add ${managed}`;
        });
        expect(run("--local").status).not.toBe(0);
        await mutateState((value) => {
            delete value.failCommand;
        });
        const result = run("--local");
        expect(result.status, result.stderr).toBe(0);
        expect((await state()).plugins[0]?.enabled).toBe(false);
    });

    test.each([
        "plugin.json",
        "bin/cyclecloud-mcp.mjs",
        "cyclecloud.example.json",
    ])("Rejects incomplete packages before registration: %s", async (file) => {
        await rm(join(source, file));
        expect(run("--local").status).not.toBe(0);
        expect(await calls()).toEqual([]);
    });

    test("Rejects malformed manifests before registration", async () => {
        await writeFile(join(source, "plugin.json"), "{}");
        expect(run("--local").status).not.toBe(0);
        expect(await calls()).toEqual([]);
    });

    test("Refuses an unrelated same-name marketplace", async () => {
        await mutateState((value) => {
            value.marketplaces.push({
                name: "cyclecloud-mcp",
                source: "GitHub: someone/else",
            });
        });
        expect(run("--local").status).not.toBe(0);
        expect(
            (await calls()).some(
                (call) => call.includes("remove") || call.includes("uninstall"),
            ),
        ).toBe(false);
    });

    test("Removes stale package files on a local rerun", async () => {
        expect(run("--local").status).toBe(0);
        await writeFile(join(managed, "obsolete-hook.js"), "// obsolete\n");
        const result = run("--local");
        expect(result.status, result.stderr).toBe(0);
        await expect(
            lstat(join(managed, "obsolete-hook.js")),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("Refuses symlinked managed destinations", async () => {
        await mkdir(dirname(managed), { recursive: true });
        await symlink(source, managed);
        expect(run("--local").status).not.toBe(0);
        expect(await calls()).toEqual([]);
    });

    test("Maintains a complete VS Code-discoverable copy for a live CLI registration", async () => {
        const visible = join(
            home,
            ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
        );
        let result = run("--local");
        expect(result.status, result.stderr).toBe(0);
        for (const file of files) {
            expect(
                (await readFile(join(visible, file))).equals(
                    await readFile(join(managed, file)),
                ),
            ).toBe(true);
        }
        await writeFile(join(source, "LICENSE"), "updated\n");
        await rm(join(visible, "bin/cyclecloud-mcp.mjs"));
        await writeFile(join(visible, ".mcp.json"), "{}");
        result = run("--local");
        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(join(visible, "LICENSE"), "utf8")).toBe(
            "updated\n",
        );
        expect(
            (await readFile(join(visible, "bin/cyclecloud-mcp.mjs"))).equals(
                await readFile(join(managed, "bin/cyclecloud-mcp.mjs")),
            ),
        ).toBe(true);
        await expect(lstat(join(visible, ".mcp.json"))).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect((await state()).plugins).toHaveLength(1);
    });

    test("Refuses a symlinked VS Code discovery parent before changing registrations", async () => {
        await mkdir(join(home, ".copilot"));
        await symlink(source, join(home, ".copilot/installed-plugins"));
        expect(run("--local").status).not.toBe(0);
        expect(await calls()).toEqual([]);
    });

    test.each(["cli", "vscode"])(
        "Runs the %s runtime copy after deleting the source package",
        async (host) => {
            const runtimeRoot =
                host === "cli"
                    ? managed
                    : join(
                          home,
                          ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
                      );
            const result = run("--local");
            expect(result.status, result.stderr).toBe(0);
            await rm(source, { recursive: true });
            const server = await startFakeCycleCloudServer();
            const client = new Client({
                name: "independent-install-test",
                version: "0.1.0",
            });
            try {
                await writeFile(
                    config,
                    JSON.stringify({
                        url: server.origin,
                        username: "test",
                        password: "test",
                    }),
                );
                server.enqueue({
                    status: 200,
                    body: JSON.stringify([{ ClusterName: "independent" }]),
                });
                const manifest = JSON.parse(
                    await readFile(join(runtimeRoot, "plugin.json"), "utf8"),
                ) as { mcpServers: { cyclecloud: { args: string[] } } };
                const declaration = manifest.mcpServers.cyclecloud;
                const transport = new StdioClientTransport({
                    command: process.execPath,
                    args: declaration.args.map((arg: string) =>
                        arg.replaceAll("${PLUGIN_ROOT}", runtimeRoot),
                    ),
                    env: { HOME: home, PATH: process.env.PATH ?? "" },
                    stderr: "pipe",
                });
                await client.connect(transport);
                expect(
                    (await client.listTools()).tools.map((tool) => tool.name),
                ).toEqual([
                    "list_clusters",
                    "get_cluster",
                    "get_cluster_status",
                ]);
                const call = await client.callTool({
                    name: "list_clusters",
                    arguments: {},
                });
                expect(call.isError).not.toBe(true);
                expect(call.structuredContent).toMatchObject({ total: 1 });
                expect(JSON.stringify(await state())).not.toContain(source);
            } finally {
                await client.close();
                await server.close();
            }
        },
    );
});
