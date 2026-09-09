import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfiguration } from "../src/config.js";
import { StartupError } from "../src/errors.js";

const configName = "cyclecloud.json";
const exampleName = "cyclecloud.example.json";

let pluginData: string;

beforeEach(async () => {
  pluginData = await mkdtemp(join(tmpdir(), "cyclecloud-mcp-config-"));
  await chmod(pluginData, 0o700);
});

afterEach(async () => {
  await rm(pluginData, { recursive: true, force: true });
});

function validDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: "https://cyclecloud.example.com",
    username: "cyclecloud-poc",
    password: "correct horse battery staple",
    ...overrides,
  };
}

async function writeConfig(document: Record<string, unknown>, mode = 0o600): Promise<string> {
  const path = join(pluginData, configName);
  await writeFile(path, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  await chmod(path, mode);
  return path;
}

async function expectStartupError(promise: Promise<unknown>, code: string, reason?: string): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(StartupError);
  expect(error).toMatchObject({ code, reason });
  expect(String(error)).not.toContain("correct horse battery staple");
}

describe("CycleCloud configuration", () => {
  test("Applies secure defaults and separates credentials from settings", async () => {
    await writeConfig(validDocument());

    const loaded = await loadConfiguration({ pluginData });

    expect(loaded.settings).toEqual({
      url: "https://cyclecloud.example.com",
      verifyTls: true,
      allowInsecureHttp: false,
      enableMutations: false,
      requestTimeoutMs: 30_000,
      actionTimeoutMs: 60_000,
      debug: false,
    });
    expect(JSON.stringify(loaded.settings)).not.toMatch(/username|password|correct horse/i);
    expect(loaded.credentials.getCredentials()).toEqual({
      username: "cyclecloud-poc",
      password: "correct horse battery staple",
    });
    expect(loaded.credentials.getCredentials()).not.toBe(loaded.credentials.getCredentials());
  });

  test("Accepts explicit valid settings", async () => {
    await writeConfig(
      validDocument({
        caCertPath: "/tmp/cyclecloud-ca.pem",
        enableMutations: true,
        requestTimeoutMs: 1_000,
        actionTimeoutMs: 300_000,
        debug: true,
      }),
    );

    const loaded = await loadConfiguration({ pluginData });

    expect(loaded.settings).toMatchObject({
      caCertPath: "/tmp/cyclecloud-ca.pem",
      enableMutations: true,
      requestTimeoutMs: 1_000,
      actionTimeoutMs: 300_000,
      debug: true,
    });
  });

  test("Rejects unknown properties", async () => {
    await writeConfig(validDocument({ unexpected: true }));

    await expectStartupError(loadConfiguration({ pluginData }), "configuration_invalid", "unknown_property");
  });

  test.each([
    ["empty username", { username: "" }, "invalid_username"],
    ["username colon", { username: "bad:name" }, "invalid_username"],
    ["username control", { username: "bad\nname" }, "invalid_username"],
    ["non-ASCII username", { username: "usér" }, "invalid_username"],
    ["empty password", { password: "" }, "invalid_password"],
    ["password control", { password: "bad\tpassword" }, "invalid_password"],
    ["non-ASCII password", { password: "pässword" }, "invalid_password"],
    ["short read timeout", { requestTimeoutMs: 999 }, "invalid_timeout"],
    ["long read timeout", { requestTimeoutMs: 60_001 }, "invalid_timeout"],
    ["short action timeout", { actionTimeoutMs: 34_999 }, "invalid_timeout"],
    ["long action timeout", { actionTimeoutMs: 300_001 }, "invalid_timeout"],
    ["non-boolean mutation gate", { enableMutations: "true" }, "invalid_boolean"],
    ["empty CA path", { caCertPath: "" }, "invalid_ca_path"],
    ["relative CA path", { caCertPath: "ca.pem" }, "invalid_ca_path"],
  ])("Rejects invalid %s", async (_label, overrides, reason) => {
    await writeConfig(validDocument(overrides));

    await expectStartupError(loadConfiguration({ pluginData }), "configuration_invalid", reason);
  });

  test.each([
    ["FTP", { url: "ftp://cyclecloud.example.com" }],
    ["credentials in URL", { url: "https://user:pass@cyclecloud.example.com" }],
    ["query", { url: "https://cyclecloud.example.com?x=1" }],
    ["fragment", { url: "https://cyclecloud.example.com/#x" }],
    ["path prefix", { url: "https://cyclecloud.example.com/cyclecloud" }],
  ])("Rejects a URL with %s", async (_label, overrides) => {
    await writeConfig(validDocument(overrides));

    await expectStartupError(loadConfiguration({ pluginData }), "configuration_invalid", "invalid_url");
  });

  test.each([
    ["remote HTTP without opt-in", { url: "http://cyclecloud.example.com" }],
    ["HTTP with disabled TLS flag", { url: "http://127.0.0.1", verifyTls: false }],
    ["HTTP with a CA", { url: "http://127.0.0.1", caCertPath: "/tmp/ca.pem" }],
    ["loopback HTTP with redundant opt-in", { url: "http://127.0.0.1", allowInsecureHttp: true }],
    ["remote HTTPS with disabled verification", { verifyTls: false }],
    ["disabled verification with a CA", { url: "https://127.0.0.1", verifyTls: false, caCertPath: "/tmp/ca.pem" }],
    ["HTTPS with insecure HTTP opt-in", { allowInsecureHttp: true }],
  ])("Rejects invalid transport combination %s", async (_label, overrides) => {
    await writeConfig(validDocument(overrides));

    await expectStartupError(loadConfiguration({ pluginData }), "configuration_invalid", "invalid_transport");
  });

  test.each([
    ["loopback HTTP", { url: "http://127.0.0.1" }],
    ["explicit remote HTTP", { url: "http://cyclecloud.example.com", allowInsecureHttp: true }],
    ["verified HTTPS", {}],
    ["loopback HTTPS without verification", { url: "https://[::1]", verifyTls: false }],
  ])("Accepts valid transport combination %s", async (_label, overrides) => {
    await writeConfig(validDocument(overrides));

    await expect(loadConfiguration({ pluginData })).resolves.toBeDefined();
  });

  test("Accepts credential mode 0400", async () => {
    await writeConfig(validDocument(), 0o400);

    await expect(loadConfiguration({ pluginData })).resolves.toBeDefined();
  });

  test.each([0o644, 0o700, 0o200, 0o4600])("Rejects credential mode %s", async (mode) => {
    await writeConfig(validDocument(), mode);

    await expectStartupError(loadConfiguration({ pluginData }), "credential_file_insecure", "unsafe_permissions");
  });

  test("Rejects a symlinked credential file", async () => {
    const target = join(pluginData, "target.json");
    await writeFile(target, JSON.stringify(validDocument()), { mode: 0o600 });
    await symlink(target, join(pluginData, configName));

    await expectStartupError(loadConfiguration({ pluginData }), "credential_file_insecure", "symlink");
  });

  test("Rejects a non-regular credential file", async () => {
    await mkdir(join(pluginData, configName), { mode: 0o700 });

    await expectStartupError(loadConfiguration({ pluginData }), "credential_file_insecure", "not_regular");
  });

  test("Rejects a credential file not owned by the effective user", async () => {
    const path = await writeConfig(validDocument());
    const stats = await lstat(path);

    await expectStartupError(loadConfiguration({ pluginData, effectiveUserId: stats.uid + 1 }), "credential_file_insecure", "wrong_owner");
  });

  test("Creates a secret-free example when configuration is missing", async () => {
    await expectStartupError(loadConfiguration({ pluginData }), "configuration_missing", "created_example");

    const examplePath = join(pluginData, exampleName);
    const contents = await readFile(examplePath, "utf8");
    const stats = await lstat(examplePath);
    expect(stats.mode & 0o777).toBe(0o600);
    expect(JSON.parse(contents)).toEqual({
      url: "https://cyclecloud.example.com",
      username: "cyclecloud-poc",
      password: "",
      verifyTls: true,
      allowInsecureHttp: false,
      enableMutations: false,
      requestTimeoutMs: 30_000,
      actionTimeoutMs: 60_000,
      debug: false,
    });
  });

  test("Preserves an existing example when configuration is missing", async () => {
    const examplePath = join(pluginData, exampleName);
    await writeFile(examplePath, "keep me\n", { mode: 0o600 });

    await expectStartupError(loadConfiguration({ pluginData }), "configuration_missing", "example_exists");
    await expect(readFile(examplePath, "utf8")).resolves.toBe("keep me\n");
  });
});
