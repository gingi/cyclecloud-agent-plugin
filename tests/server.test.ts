import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { formatStartupError, requirePluginEnvironment } from "../src/index.js";
import { StartupError } from "../src/errors.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const expectedPlugin = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "cyclecloud-mcp",
  version: "0.1.0",
  description: "Inspect Azure CycleCloud with optional bounded lifecycle actions.",
  keywords: ["azure-cyclecloud", "hpc", "mcp"],
};

const expectedMcp = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: {
    cyclecloud: {
      type: "stdio",
      command: "node",
      args: ["${PLUGIN_ROOT}/bin/cyclecloud-mcp.mjs"],
    },
  },
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Agent plugin manifests", () => {
  test("Match the approved Agent Plugins 1.0 contract", () => {
    const pluginPath = resolve(repositoryRoot, "plugin.json");
    const mcpPath = resolve(repositoryRoot, "mcp.json");

    expect(existsSync(pluginPath)).toBe(true);
    expect(existsSync(mcpPath)).toBe(true);
    expect(readJson(pluginPath)).toEqual(expectedPlugin);
    expect(readJson(mcpPath)).toEqual(expectedMcp);
  });

  test("Launch the server with the exact secret-free stdio command", () => {
    const mcpPath = resolve(repositoryRoot, "mcp.json");

    expect(existsSync(mcpPath)).toBe(true);
    const mcp = readJson(mcpPath);
    expect(mcp).toEqual(expectedMcp);
    expect(JSON.stringify(mcp)).not.toMatch(/password|credential|secret/i);
    expect(JSON.stringify(mcp)).not.toContain('"env"');
    expect(JSON.stringify(mcp)).not.toContain('"cwd"');
  });

  test("Declare the Node versions supported by the locked toolchain", () => {
    const packageJson = readJson(resolve(repositoryRoot, "package.json"));

    expect(packageJson).toMatchObject({
      engines: { node: "^20.19.0 || ^22.12.0 || >=24.0.0" },
    });
  });

  test("Lock public dependencies to the public npm registry", () => {
    const packageLock = JSON.stringify(readJson(resolve(repositoryRoot, "package-lock.json")));

    expect(packageLock).toContain("registry.npmjs.org");
    expect(packageLock).not.toContain("msazure.pkgs.visualstudio.com");
  });
});

describe("Command-line startup", () => {
  test("Require separate existing injected plugin roots", async () => {
    const base = await mkdtemp(join(tmpdir(), "cyclecloud-mcp-roots-"));
    const pluginRoot = join(base, "plugin");
    const pluginData = join(base, "data");
    const nestedData = join(pluginRoot, "data");
    const nestedPlugin = join(pluginData, "plugin");
    await mkdir(pluginRoot);
    await mkdir(pluginData);
    await mkdir(nestedData);
    await mkdir(nestedPlugin);
    try {
      await expect(requirePluginEnvironment({})).rejects.toMatchObject({
        code: "plugin_environment_invalid",
        reason: "invalid_plugin_data",
      });
      await expect(requirePluginEnvironment({ PLUGIN_ROOT: "relative", PLUGIN_DATA: pluginData })).rejects.toThrow();
      await expect(requirePluginEnvironment({ PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: pluginRoot })).rejects.toThrow();
      await expect(requirePluginEnvironment({ PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: nestedData })).rejects.toThrow();
      await expect(requirePluginEnvironment({ PLUGIN_ROOT: nestedPlugin, PLUGIN_DATA: pluginData })).rejects.toThrow();
      await expect(requirePluginEnvironment({ PLUGIN_ROOT: join(base, "missing"), PLUGIN_DATA: pluginData })).rejects.toThrow();
      await expect(requirePluginEnvironment({ PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: pluginData })).resolves.toEqual({
        pluginRoot,
        pluginData,
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("Serialize fixed startup errors without caught text", () => {
    const known = formatStartupError(new StartupError("configuration_invalid", "invalid_json"));
    const unknown = formatStartupError(new Error("secret exception text"));

    expect(JSON.parse(known)).toEqual({
      event: "configuration_invalid",
      reason: "invalid_json",
      message: "CycleCloud configuration is invalid.",
    });
    expect(JSON.parse(unknown)).toEqual({
      event: "startup_failed",
      message: "The CycleCloud plugin failed to start.",
    });
    expect(`${known}${unknown}`).not.toContain("secret exception text");
  });

  test("Bound and remove controls from a missing-configuration path", () => {
    const unsafePath = `/tmp/data${String.fromCodePoint(0x0a)}${String.fromCodePoint(0x85)}/${"x".repeat(600)}`;
    const formatted = formatStartupError(new StartupError("configuration_missing", "created_example", unsafePath));
    const parsed: unknown = JSON.parse(formatted);

    expect(typeof parsed).toBe("object");
    if (typeof parsed !== "object" || parsed === null || !("path" in parsed) || typeof parsed.path !== "string") return;
    expect(
      [...parsed.path].every((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint === undefined || (codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f));
      }),
    ).toBe(true);
    expect([...parsed.path]).toHaveLength(512);
    expect(parsed.path.endsWith("…")).toBe(true);
  });
});
