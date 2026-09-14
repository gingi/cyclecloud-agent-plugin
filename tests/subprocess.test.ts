import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
    chmod,
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
    getDefaultEnvironment,
    StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { afterEach, describe, expect, test } from "vitest";
import {
    startFakeCycleCloudServer,
    type FakeCycleCloudServer,
} from "./helpers/fake-cyclecloud.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const captureWrapper = join(repositoryRoot, "tests/helpers/capture-stdio.mjs");
const manifestSchema = z.object({
    mcpServers: z.object({
        cyclecloud: z.object({
            command: z.string(),
            args: z.array(z.string()).length(1),
        }),
    }),
});
const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(repositoryRoot, "plugin.json"), "utf8")),
);
const command = manifest.mcpServers.cyclecloud.command;
const configuredArgs = manifest.mcpServers.cyclecloud.args;
const sourceBundle = join(repositoryRoot, "bin/cyclecloud-mcp.mjs");
const temporaryDirectories: string[] = [];
const servers: FakeCycleCloudServer[] = [];

afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.close()));
    await Promise.allSettled(
        temporaryDirectories
            .splice(0)
            .map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
    );
});

async function createTemporaryDirectory(prefix: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    temporaryDirectories.push(directory);
    await chmod(directory, 0o700);
    return directory;
}

async function createPluginRoot(): Promise<string> {
    const pluginRoot = await createTemporaryDirectory("cyclecloud-mcp-plugin-");
    await mkdir(join(pluginRoot, "bin"));
    await Promise.all([
        copyFile(
            join(repositoryRoot, "plugin.json"),
            join(pluginRoot, "plugin.json"),
        ),
        copyFile(sourceBundle, join(pluginRoot, "bin/cyclecloud-mcp.mjs")),
    ]);
    await chmod(join(pluginRoot, "bin/cyclecloud-mcp.mjs"), 0o644);
    return pluginRoot;
}

function serverArgs(pluginRoot: string): string[] {
    return configuredArgs.map((argument) =>
        argument.replace("${PLUGIN_ROOT}", pluginRoot),
    );
}

function childEnvironment(
    pluginRoot: string,
    pluginData: string,
): Record<string, string> {
    return {
        ...getDefaultEnvironment(),
        PLUGIN_ROOT: pluginRoot,
        PLUGIN_DATA: pluginData,
    };
}

async function snapshotPluginRoot(
    pluginRoot: string,
): Promise<readonly string[]> {
    const names = (await readdir(pluginRoot, { recursive: true })).sort();
    const snapshot: string[] = [];
    for (const name of names) {
        const path = join(pluginRoot, name);
        const stats = await lstat(path);
        const digest = stats.isFile()
            ? createHash("sha256")
                  .update(await readFile(path))
                  .digest("hex")
            : "directory";
        snapshot.push(`${name}:${stats.mode}:${stats.size}:${digest}`);
    }
    return snapshot;
}

async function runChild(
    pluginRoot: string,
    pluginData: string,
): Promise<{
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}> {
    const child = spawn(command, serverArgs(pluginRoot), {
        env: childEnvironment(pluginRoot, pluginData),
        stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
    });
    const code = await new Promise<number | null>((resolveClose, reject) => {
        child.once("error", reject);
        child.once("close", resolveClose);
    });
    return { code, stdout, stderr };
}

async function writeConfiguration(
    pluginData: string,
    url: string,
    username: string,
    password: string,
): Promise<void> {
    const path = join(pluginData, "cyclecloud.json");
    await writeFile(path, `${JSON.stringify({ url, username, password })}\n`, {
        mode: 0o600,
    });
    await chmod(path, 0o600);
}

describe("Bundled stdio MCP server", () => {
    test("Builds the manifest target as a non-executable module without a shebang", async () => {
        const path = serverArgs(repositoryRoot)[0];
        expect(path).toBeDefined();
        if (path === undefined) return;
        expect(existsSync(path)).toBe(true);
        const stats = await lstat(path);
        const source = await readFile(path, "utf8");
        expect(stats.isFile()).toBe(true);
        expect(stats.mode & 0o111).toBe(0);
        expect(source.startsWith("#!")).toBe(false);
    });

    test("Reports missing configuration only on stderr without changing the plugin root", async () => {
        const pluginRoot = await createPluginRoot();
        const pluginData = await createTemporaryDirectory(
            "cyclecloud-mcp-data-",
        );
        const before = await snapshotPluginRoot(pluginRoot);

        const result = await runChild(pluginRoot, pluginData);

        expect(result.code).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(JSON.parse(result.stderr.trim())).toMatchObject({
            event: "configuration_missing",
            reason: "created_example",
            path: join(pluginData, "cyclecloud.json"),
        });
        const examplePath = join(pluginData, "cyclecloud.example.json");
        const example = await readFile(examplePath, "utf8");
        const stats = await lstat(examplePath);
        expect(stats.mode & 0o777).toBe(0o600);
        expect(example).toContain('"password": ""');
        expect(await snapshotPluginRoot(pluginRoot)).toEqual(before);
    });

    test("Captures a real MCP session and exposes no credential on stdout, stderr, or results", async () => {
        const pluginRoot = await createPluginRoot();
        const pluginData = await createTemporaryDirectory(
            "cyclecloud-mcp-data-",
        );
        const before = await snapshotPluginRoot(pluginRoot);
        const capturePath = join(pluginData, "captured-stdout.jsonl");
        const server = await startFakeCycleCloudServer();
        servers.push(server);
        server.enqueue({
            status: 200,
            body: JSON.stringify([{ ClusterName: "cluster-1" }]),
        });
        const username = "subprocess-user";
        const password = "subprocess-password";
        await writeConfiguration(pluginData, server.origin, username, password);
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [
                captureWrapper,
                capturePath,
                command,
                ...serverArgs(pluginRoot),
            ],
            env: childEnvironment(pluginRoot, pluginData),
            stderr: "pipe",
        });
        let stderr = "";
        transport.stderr?.on("data", (chunk: unknown) => {
            stderr += Buffer.isBuffer(chunk)
                ? chunk.toString("utf8")
                : String(chunk);
        });
        const client = new Client({
            name: "cyclecloud-mcp-subprocess-test",
            version: "0.1.0",
        });
        let tools: Awaited<ReturnType<Client["listTools"]>> | undefined;
        let result: Awaited<ReturnType<Client["callTool"]>> | undefined;

        try {
            await client.connect(transport);
            tools = await client.listTools();
            result = await client.callTool({
                name: "list_clusters",
                arguments: {},
            });
            expect(tools.tools.map((tool) => tool.name)).toEqual([
                "list_clusters",
                "get_cluster",
                "get_cluster_status",
            ]);
            expect(result.isError).not.toBe(true);
            expect(result.structuredContent).toMatchObject({
                total: 1,
                returned: 1,
            });
        } finally {
            await client.close();
        }

        const rawStdout = await readFile(capturePath, "utf8");
        const protocolLines = rawStdout.trim().split("\n");
        expect(protocolLines.length).toBeGreaterThan(0);
        for (const line of protocolLines) {
            expect(() => {
                JSON.parse(line);
            }).not.toThrow();
        }
        const encoded = Buffer.from(
            `${username}:${password}`,
            "ascii",
        ).toString("base64");
        const exposed = JSON.stringify({ rawStdout, stderr, tools, result });
        expect(exposed).not.toContain(username);
        expect(exposed).not.toContain(password);
        expect(exposed).not.toContain(encoded);
        expect(exposed).not.toContain(`Basic ${encoded}`);
        expect(await snapshotPluginRoot(pluginRoot)).toEqual(before);
    });
});
