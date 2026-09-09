import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { createFileCredentialProvider, type CredentialProvider } from "./credentials.js";
import { StartupError, type StartupErrorReason } from "./errors.js";

const configFileName = "cyclecloud.json";
const exampleFileName = "cyclecloud.example.json";
const acceptedCredentialModes = new Set([0o600, 0o400]);
const printableAscii = /^[\x20-\x7e]+$/u;

const configurationSchema = z
  .object({
    url: z.string().min(1),
    username: z
      .string()
      .min(1)
      .max(256)
      .regex(printableAscii)
      .refine((value) => !value.includes(":")),
    password: z.string().min(1).max(4096).regex(printableAscii),
    verifyTls: z.boolean().default(true),
    caCertPath: z.string().min(1).optional(),
    allowInsecureHttp: z.boolean().default(false),
    enableMutations: z.boolean().default(false),
    requestTimeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
    actionTimeoutMs: z.number().int().min(35_000).max(300_000).default(60_000),
    debug: z.boolean().default(false),
  })
  .strict();

type ConfigurationDocument = z.infer<typeof configurationSchema>;

export interface CycleCloudSettings {
  readonly url: string;
  readonly verifyTls: boolean;
  readonly caCertPath?: string;
  readonly allowInsecureHttp: boolean;
  readonly enableMutations: boolean;
  readonly requestTimeoutMs: number;
  readonly actionTimeoutMs: number;
  readonly debug: boolean;
}

export interface LoadedConfiguration {
  readonly settings: CycleCloudSettings;
  readonly credentials: CredentialProvider;
}

export interface LoadConfigurationOptions {
  readonly pluginData: string;
  readonly effectiveUserId?: number;
}

const exampleDocument = {
  url: "https://cyclecloud.example.com",
  username: "cyclecloud-poc",
  password: "",
  verifyTls: true,
  allowInsecureHttp: false,
  enableMutations: false,
  requestTimeoutMs: 30_000,
  actionTimeoutMs: 60_000,
  debug: false,
};

export async function loadConfiguration(options: LoadConfigurationOptions): Promise<LoadedConfiguration> {
  if (!isAbsolute(options.pluginData)) {
    throw new StartupError("plugin_environment_invalid", "invalid_plugin_data");
  }

  const effectiveUserId = options.effectiveUserId ?? getEffectiveUserId();
  const configPath = join(options.pluginData, configFileName);
  const contents = await readCredentialFile(configPath, effectiveUserId).catch(async (error: unknown) => {
    if (isMissingFile(error)) {
      const reason = await createExampleFile(join(options.pluginData, exampleFileName));
      throw new StartupError("configuration_missing", reason, configPath);
    }
    throw error;
  });

  const document = parseDocument(contents);
  validateUrlAndTransport(document);

  const commonSettings = {
    url: new URL(document.url).origin,
    verifyTls: document.verifyTls,
    allowInsecureHttp: document.allowInsecureHttp,
    enableMutations: document.enableMutations,
    requestTimeoutMs: document.requestTimeoutMs,
    actionTimeoutMs: document.actionTimeoutMs,
    debug: document.debug,
  };
  const settings: CycleCloudSettings =
    document.caCertPath === undefined ? commonSettings : { ...commonSettings, caCertPath: document.caCertPath };

  return {
    settings,
    credentials: createFileCredentialProvider({ username: document.username, password: document.password }),
  };
}

function getEffectiveUserId(): number {
  if (typeof process.geteuid !== "function") {
    throw new StartupError("plugin_environment_invalid", "invalid_plugin_data");
  }
  return process.geteuid();
}

async function readCredentialFile(path: string, effectiveUserId: number): Promise<string> {
  let pathStats;
  try {
    pathStats = await lstat(path);
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      throw error;
    }
    throw new StartupError("credential_file_insecure", "open_failed");
  }

  validateCredentialStats(pathStats, effectiveUserId);

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ELOOP")) {
      throw new StartupError("credential_file_insecure", "symlink");
    }
    throw new StartupError("credential_file_insecure", "open_failed");
  }

  try {
    validateCredentialStats(await handle.stat(), effectiveUserId);
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

function validateCredentialStats(stats: Stats, effectiveUserId: number): void {
  if (stats.isSymbolicLink()) {
    throw new StartupError("credential_file_insecure", "symlink");
  }
  if (!stats.isFile()) {
    throw new StartupError("credential_file_insecure", "not_regular");
  }
  if (stats.uid !== effectiveUserId) {
    throw new StartupError("credential_file_insecure", "wrong_owner");
  }
  if (!acceptedCredentialModes.has(stats.mode & 0o7777)) {
    throw new StartupError("credential_file_insecure", "unsafe_permissions");
  }
}

async function createExampleFile(path: string): Promise<StartupErrorReason> {
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch (error: unknown) {
    return isNodeErrorWithCode(error, "EEXIST") ? "example_exists" : "example_creation_failed";
  }

  try {
    await handle.writeFile(`${JSON.stringify(exampleDocument, null, 2)}\n`, { encoding: "utf8" });
    await handle.chmod(0o600);
    return "created_example";
  } catch {
    return "example_creation_failed";
  } finally {
    await handle.close();
  }
}

function parseDocument(contents: string): ConfigurationDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new StartupError("configuration_invalid", "invalid_json");
  }

  const result = configurationSchema.safeParse(parsed);
  if (!result.success) {
    throw new StartupError("configuration_invalid", classifySchemaFailure(result.error));
  }
  if (result.data.caCertPath !== undefined && !isAbsolute(result.data.caCertPath)) {
    throw new StartupError("configuration_invalid", "invalid_ca_path");
  }
  return result.data;
}

function classifySchemaFailure(error: z.ZodError): StartupErrorReason {
  if (error.issues.some((issue) => issue.code === "unrecognized_keys")) {
    return "unknown_property";
  }

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === "username") return "invalid_username";
    if (field === "password") return "invalid_password";
    if (field === "url") return "invalid_url";
    if (field === "caCertPath") return "invalid_ca_path";
    if (field === "requestTimeoutMs" || field === "actionTimeoutMs") return "invalid_timeout";
    if (field === "verifyTls" || field === "allowInsecureHttp" || field === "enableMutations" || field === "debug") {
      return "invalid_boolean";
    }
  }
  return "invalid_json";
}

function validateUrlAndTransport(document: ConfigurationDocument): void {
  let url: URL;
  try {
    url = new URL(document.url);
  } catch {
    throw new StartupError("configuration_invalid", "invalid_url");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new StartupError("configuration_invalid", "invalid_url");
  }

  const loopback = isLoopbackAddress(url.hostname);
  const hasCa = document.caCertPath !== undefined;
  const validHttp =
    url.protocol === "http:" &&
    document.verifyTls &&
    !hasCa &&
    ((loopback && !document.allowInsecureHttp) || (!loopback && document.allowInsecureHttp));
  const validVerifiedHttps = url.protocol === "https:" && document.verifyTls && !document.allowInsecureHttp;
  const validUnverifiedLoopbackHttps =
    url.protocol === "https:" && loopback && !document.verifyTls && !hasCa && !document.allowInsecureHttp;

  if (!validHttp && !validVerifiedHttps && !validUnverifiedLoopbackHttps) {
    throw new StartupError("configuration_invalid", "invalid_transport");
  }
}

function isLoopbackAddress(hostname: string): boolean {
  if (hostname === "[::1]" || hostname === "::1") return true;
  const octets = hostname.split(".").map(Number);
  return octets.length === 4 && octets[0] === 127 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
}

function isMissingFile(error: unknown): boolean {
  return isNodeErrorWithCode(error, "ENOENT");
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
