import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { Agent, fetch, type Dispatcher, type Response } from "undici";
import type { CycleCloudSettings } from "./config.js";
import type { CredentialProvider } from "./credentials.js";
import { CycleCloudRequestError, StartupError } from "./errors.js";

const maximumResponseBytes = 8 * 1024 * 1024;
const maximumCaBytes = 1024 * 1024;
const certificatePattern = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const tlsErrorCodes = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const networkErrorCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);

export interface CycleCloudRequestOptions {
  readonly signal?: AbortSignal;
}

export interface ActionDispatchResult {
  readonly outcome: "accepted" | "unknown";
}

export interface CycleCloudClient {
  listClusters(options?: CycleCloudRequestOptions): Promise<unknown>;
  getCluster(clusterName: string, options?: CycleCloudRequestOptions): Promise<unknown>;
  getClusterStatus(clusterName: string, options?: CycleCloudRequestOptions): Promise<unknown>;
  startCluster(clusterName: string, recursive: boolean, options?: CycleCloudRequestOptions): Promise<ActionDispatchResult>;
  terminateCluster(clusterName: string, recursive: boolean, options?: CycleCloudRequestOptions): Promise<ActionDispatchResult>;
  close(): Promise<void>;
}

export async function createCycleCloudClient(settings: CycleCloudSettings, credentials: CredentialProvider): Promise<CycleCloudClient> {
  const dispatcher = await createDispatcher(settings);
  return new HttpCycleCloudClient(settings, credentials, dispatcher);
}

class HttpCycleCloudClient implements CycleCloudClient {
  readonly #settings: CycleCloudSettings;
  readonly #dispatcher: Dispatcher;
  readonly #authorization: string;

  constructor(settings: CycleCloudSettings, credentials: CredentialProvider, dispatcher: Dispatcher) {
    this.#settings = settings;
    this.#dispatcher = dispatcher;
    const value = credentials.getCredentials();
    this.#authorization = `Basic ${Buffer.from(`${value.username}:${value.password}`, "ascii").toString("base64")}`;
  }

  async listClusters(options: CycleCloudRequestOptions = {}): Promise<unknown> {
    return this.#read("/cloud/api/clusters?summary=true&cloud_instances=true", options);
  }

  async getCluster(clusterName: string, options: CycleCloudRequestOptions = {}): Promise<unknown> {
    return this.#read(`/cloud/api/clusters/${encodeURIComponent(clusterName)}?summary=true&cloud_instances=true`, options);
  }

  async getClusterStatus(clusterName: string, options: CycleCloudRequestOptions = {}): Promise<unknown> {
    return this.#read(`/clusters/${encodeURIComponent(clusterName)}/status?nodes=false`, options);
  }

  async startCluster(clusterName: string, recursive: boolean, options: CycleCloudRequestOptions = {}): Promise<ActionDispatchResult> {
    return this.#action(
      `/cloud/actions/startcluster/${encodeURIComponent(clusterName)}?wait_time=30&recursive=${String(recursive)}&test_mode=false`,
      options,
    );
  }

  async terminateCluster(clusterName: string, recursive: boolean, options: CycleCloudRequestOptions = {}): Promise<ActionDispatchResult> {
    return this.#action(
      `/cloud/actions/terminatecluster/${encodeURIComponent(clusterName)}?wait_time=30&recursive=${String(recursive)}`,
      options,
    );
  }

  async close(): Promise<void> {
    await this.#dispatcher.close();
  }

  async #read(path: string, options: CycleCloudRequestOptions): Promise<unknown> {
    return this.#execute(path, "GET", this.#settings.requestTimeoutMs, options.signal, async (response) => {
      if (response.status < 200 || response.status >= 300) {
        await discardBody(response);
        throw readStatusError(response.status);
      }
      return readBoundedJson(response);
    });
  }

  async #action(path: string, options: CycleCloudRequestOptions): Promise<ActionDispatchResult> {
    return this.#execute(
      path,
      "POST",
      this.#settings.actionTimeoutMs,
      options.signal,
      async (response) => {
        await discardBody(response);
        if (response.status >= 200 && response.status < 300) return { outcome: "accepted" };
        if (response.status === 401) throw new CycleCloudRequestError("authentication_failed", false);
        if (response.status === 403) throw new CycleCloudRequestError("permission_denied", false);
        if (response.status === 404) throw new CycleCloudRequestError("cluster_not_found", false);
        return { outcome: "unknown" };
      },
      () => ({ outcome: "unknown" }),
    );
  }

  async #execute<Result>(
    path: string,
    method: "GET" | "POST",
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
    consume: (response: Response) => Promise<Result>,
    uncertainResult?: () => Result,
  ): Promise<Result> {
    if (isAborted(callerSignal)) throw new CycleCloudRequestError("cancelled", false);

    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = (): void => controller.abort();
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref();

    try {
      const response = await fetch(new URL(path, `${this.#settings.url}/`), {
        method,
        dispatcher: this.#dispatcher,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: this.#authorization,
        },
      });
      return await consume(response);
    } catch (error: unknown) {
      if (error instanceof CycleCloudRequestError) throw error;
      const causeCategory = classifyCause(error);
      if (causeCategory !== undefined) throw causeCategory;
      if (uncertainResult !== undefined) return uncertainResult();
      if (isAborted(callerSignal)) throw new CycleCloudRequestError("cancelled", false);
      if (timedOut) throw new CycleCloudRequestError("timeout", true);
      throw new CycleCloudRequestError("network_error", true);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

async function createDispatcher(settings: CycleCloudSettings): Promise<Agent> {
  const url = new URL(settings.url);
  if (url.protocol !== "https:") return new Agent({ connections: 4 });

  const ca = settings.caCertPath === undefined ? [...rootCertificates] : [...rootCertificates, await loadCustomCa(settings.caCertPath)];
  return new Agent({
    connections: 4,
    connect: {
      rejectUnauthorized: settings.verifyTls,
      ca,
    },
  });
}

async function loadCustomCa(path: string): Promise<string> {
  const effectiveUserId = typeof process.geteuid === "function" ? process.geteuid() : -1;
  let handle;
  try {
    const pathStats = await lstat(path);
    validateCaStats(pathStats, effectiveUserId);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    validateCaStats(await handle.stat(), effectiveUserId);
    const pem = await handle.readFile({ encoding: "utf8" });
    validatePem(pem);
    return pem;
  } catch (error: unknown) {
    if (error instanceof StartupError) throw error;
    throw new StartupError("configuration_invalid", "invalid_ca_path");
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        throw new StartupError("configuration_invalid", "invalid_ca_path");
      }
    }
  }
}

function validateCaStats(stats: Stats, effectiveUserId: number): void {
  if (stats.isSymbolicLink() || !stats.isFile() || (stats.uid !== 0 && stats.uid !== effectiveUserId)) {
    throw new StartupError("configuration_invalid", "invalid_ca_path");
  }
  if ((stats.mode & 0o22) !== 0 || stats.size > maximumCaBytes) {
    throw new StartupError("configuration_invalid", "invalid_ca_path");
  }
}

function validatePem(pem: string): void {
  const certificates = pem.match(certificatePattern);
  if (certificates === null || certificates.length === 0 || pem.replace(certificatePattern, "").trim() !== "") {
    throw new StartupError("configuration_invalid", "invalid_ca_path");
  }
  try {
    for (const certificate of certificates) new X509Certificate(certificate);
  } catch {
    throw new StartupError("configuration_invalid", "invalid_ca_path");
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (response.body === null) throw new CycleCloudRequestError("invalid_response", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const value: unknown = next.value;
      if (!(value instanceof Uint8Array)) throw new CycleCloudRequestError("invalid_response", false);
      bytes += value.byteLength;
      if (bytes > maximumResponseBytes) {
        await reader.cancel();
        throw new CycleCloudRequestError("invalid_response", false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CycleCloudRequestError("invalid_response", false);
  }
}

async function discardBody(response: Response): Promise<void> {
  if (response.body === null) return;
  try {
    await response.body.cancel();
  } catch {
    // The response classification is authoritative; a discard failure must not expose remote text.
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function readStatusError(status: number): CycleCloudRequestError {
  if (status >= 300 && status < 400) return new CycleCloudRequestError("unexpected_redirect", false);
  if (status === 401) return new CycleCloudRequestError("authentication_failed", false);
  if (status === 403) return new CycleCloudRequestError("permission_denied", false);
  if (status === 404) return new CycleCloudRequestError("cluster_not_found", false);
  if (status === 408 || status === 425 || status === 429) {
    return new CycleCloudRequestError("cyclecloud_rejected_request", true);
  }
  if (status >= 400 && status < 500) return new CycleCloudRequestError("cyclecloud_rejected_request", false);
  return new CycleCloudRequestError("cyclecloud_unavailable", true);
}

function classifyCause(error: unknown): CycleCloudRequestError | undefined {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null && !seen.has(current); depth += 1) {
    seen.add(current);
    if ("code" in current && typeof current.code === "string") {
      if (tlsErrorCodes.has(current.code)) return new CycleCloudRequestError("tls_error", false);
      if (networkErrorCodes.has(current.code)) return new CycleCloudRequestError("network_error", true);
      if (current.code === "UND_ERR_CONNECT_TIMEOUT") return new CycleCloudRequestError("timeout", true);
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}
