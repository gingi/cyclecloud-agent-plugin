import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    createCycleCloudClient,
    type CycleCloudClient,
} from "./cyclecloud-client.js";
import { loadConfiguration } from "./config.js";
import { StartupError } from "./errors.js";
import { createCycleCloudMcpServer } from "./server.js";

export interface PluginEnvironment {
    readonly pluginRoot: string;
    readonly pluginData: string;
}

export async function requirePluginEnvironment(
    environment: Readonly<Record<string, string | undefined>>,
): Promise<PluginEnvironment> {
    // Both source and bundled entry points live one directory below the root.
    const configuredPluginRoot = dirname(
        dirname(fileURLToPath(import.meta.url)),
    );
    const configuredPluginData =
        environment.PLUGIN_DATA ??
        join(
            environment.HOME ?? homedir(),
            ".copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp",
        );
    if (!isAbsolute(configuredPluginData)) {
        throw new StartupError(
            "plugin_environment_invalid",
            "invalid_plugin_data",
        );
    }

    try {
        const [pluginRoot, pluginData] = await Promise.all([
            realpath(configuredPluginRoot),
            realpath(configuredPluginData),
        ]);
        const [pluginRootStats, pluginDataStats] = await Promise.all([
            stat(pluginRoot),
            stat(pluginData),
        ]);
        if (
            !pluginRootStats.isDirectory() ||
            !pluginDataStats.isDirectory() ||
            pathsOverlap(pluginRoot, pluginData)
        ) {
            throw new StartupError(
                "plugin_environment_invalid",
                "invalid_plugin_data",
            );
        }
        return { pluginRoot, pluginData };
    } catch (error: unknown) {
        if (error instanceof StartupError) throw error;
        throw new StartupError(
            "plugin_environment_invalid",
            "invalid_plugin_data",
        );
    }
}

function pathsOverlap(left: string, right: string): boolean {
    return isWithin(left, right) || isWithin(right, left);
}

function isWithin(parent: string, candidate: string): boolean {
    const pathFromParent = relative(parent, candidate);
    return (
        pathFromParent === "" ||
        (pathFromParent !== ".." &&
            !pathFromParent.startsWith(`..${sep}`) &&
            !isAbsolute(pathFromParent))
    );
}

export function formatStartupError(error: unknown): string {
    if (error instanceof StartupError) {
        return JSON.stringify({
            event: error.code,
            reason: error.reason,
            message: error.message,
            ...(error.path === undefined ? {} : { path: error.path }),
        });
    }
    return JSON.stringify({
        event: "startup_failed",
        message: "The CycleCloud plugin failed to start.",
    });
}

export async function startFromCommandLine(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
    let client: CycleCloudClient | undefined;
    try {
        const pluginEnvironment = await requirePluginEnvironment(environment);
        const configuration = await loadConfiguration({
            pluginData: pluginEnvironment.pluginData,
        });
        client = await createCycleCloudClient(
            configuration.settings,
            configuration.credentials,
        );
        const server = createCycleCloudMcpServer({
            client,
            enableMutations: configuration.settings.enableMutations,
            onWarning: (event) =>
                process.stderr.write(`${JSON.stringify({ event })}\n`),
        });
        await server.connect(new StdioServerTransport());
    } catch (error: unknown) {
        process.stderr.write(`${formatStartupError(error)}\n`);
        process.exitCode = 1;
        if (client !== undefined) {
            try {
                await client.close();
            } catch {
                // Startup reporting must remain fixed even if transport cleanup also fails.
            }
        }
    }
}

function isMainModule(): boolean {
    const entryPoint = process.argv[1];
    return (
        entryPoint !== undefined &&
        pathToFileURL(resolve(entryPoint)).href === import.meta.url
    );
}

if (isMainModule()) void startFromCommandLine();
