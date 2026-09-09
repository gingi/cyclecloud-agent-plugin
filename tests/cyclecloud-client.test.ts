import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import { createCycleCloudClient, type CycleCloudClient, type CycleCloudRequestOptions } from "../src/cyclecloud-client.js";
import type { CycleCloudSettings } from "../src/config.js";
import { createFileCredentialProvider } from "../src/credentials.js";
import { CycleCloudRequestError, StartupError } from "../src/errors.js";
import { createTestPki, startFakeCycleCloudServer, type FakeCycleCloudServer } from "./helpers/fake-cyclecloud.js";

const username = "cyclecloud-poc";
const password = "test-password";
const credentials = createFileCredentialProvider({ username, password });
const clients: CycleCloudClient[] = [];
const servers: FakeCycleCloudServer[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  await Promise.allSettled(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function settings(url: string, overrides: Partial<CycleCloudSettings> = {}): CycleCloudSettings {
  return {
    url,
    verifyTls: true,
    allowInsecureHttp: false,
    enableMutations: false,
    requestTimeoutMs: 1_000,
    actionTimeoutMs: 1_000,
    debug: false,
    ...overrides,
  };
}

async function createClient(configuration: CycleCloudSettings): Promise<CycleCloudClient> {
  const client = await createCycleCloudClient(configuration, credentials);
  clients.push(client);
  return client;
}

async function createServer(): Promise<FakeCycleCloudServer> {
  const server = await startFakeCycleCloudServer();
  servers.push(server);
  return server;
}

async function expectRequestError(promise: Promise<unknown>, category: string, retryable: boolean): Promise<CycleCloudRequestError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CycleCloudRequestError);
  expect(error).toMatchObject({ category, retryable });
  return error instanceof CycleCloudRequestError ? error : new CycleCloudRequestError("invalid_response", false);
}

describe("CycleCloud HTTP request shape", () => {
  test("Uses exact routes, encoded names, queries, and Basic authorization", async () => {
    const server = await createServer();
    for (let index = 0; index < 3; index += 1) server.enqueue({ status: 200, body: index === 2 ? "{}" : "[]" });
    server.enqueue({ status: 202, body: "ignored start body" });
    server.enqueue({ status: 204 });
    const client = await createClient(settings(server.origin));
    const options: CycleCloudRequestOptions = {};

    await client.listClusters(options);
    await client.getCluster("cluster / one", options);
    await client.getClusterStatus("cluster / one", options);
    await client.startCluster("cluster / one", true, options);
    await client.terminateCluster("cluster / one", false, options);

    expect(server.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /cloud/api/clusters?summary=true&cloud_instances=true",
      "GET /cloud/api/clusters/cluster%20%2F%20one?summary=true&cloud_instances=true",
      "GET /clusters/cluster%20%2F%20one/status?nodes=false",
      "POST /cloud/actions/startcluster/cluster%20%2F%20one?wait_time=30&recursive=true&test_mode=false",
      "POST /cloud/actions/terminatecluster/cluster%20%2F%20one?wait_time=30&recursive=false",
    ]);
    const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`, "ascii").toString("base64")}`;
    expect(server.requests.every((request) => request.authorization === expectedAuthorization)).toBe(true);
  });

  test("Does not follow redirects or forward credentials", async () => {
    const server = await createServer();
    server.enqueue({ status: 302, headers: { location: `${server.origin}/redirect-target` }, body: "redirect" });
    const client = await createClient(settings(server.origin));

    await expectRequestError(client.listClusters(), "unexpected_redirect", false);
    expect(server.requests).toHaveLength(1);
  });
});

describe("CycleCloud HTTP error handling", () => {
  test.each([
    [401, "authentication_failed", false],
    [403, "permission_denied", false],
    [404, "cluster_not_found", false],
    [408, "cyclecloud_rejected_request", true],
    [425, "cyclecloud_rejected_request", true],
    [429, "cyclecloud_rejected_request", true],
    [400, "cyclecloud_rejected_request", false],
    [500, "cyclecloud_unavailable", true],
  ])("Maps read status %s to %s", async (status, category, retryable) => {
    const server = await createServer();
    server.enqueue({ status, body: "server-controlled secret instruction" });
    const client = await createClient(settings(server.origin));

    const error = await expectRequestError(client.listClusters(), category, retryable);
    expect(error.message).not.toMatch(/secret|instruction|server-controlled/i);
    expect(server.requests).toHaveLength(1);
  });

  test("Rejects malformed and oversized successful JSON", async () => {
    const server = await createServer();
    server.enqueue({ status: 200, body: "{" });
    server.enqueue({ status: 200, body: JSON.stringify({ value: "x".repeat(8 * 1024 * 1024) }) });
    const client = await createClient(settings(server.origin));

    await expectRequestError(client.listClusters(), "invalid_response", false);
    await expectRequestError(client.listClusters(), "invalid_response", false);
    expect(server.requests).toHaveLength(2);
  });

  test("Enforces the response limit after decompression", async () => {
    const server = await createServer();
    const oversized = gzipSync(Buffer.from(JSON.stringify({ value: "x".repeat(8 * 1024 * 1024) })));
    server.enqueue({
      status: 200,
      body: oversized,
      headers: { "content-encoding": "gzip", "content-type": "application/json" },
    });
    const client = await createClient(settings(server.origin));

    await expectRequestError(client.listClusters(), "invalid_response", false);
    expect(server.requests).toHaveLength(1);
  });

  test("Maps read timeout and pre-dispatch cancellation without exposing exceptions", async () => {
    const server = await createServer();
    server.enqueue({ status: 200, body: "[]", delayMs: 100 });
    const client = await createClient(settings(server.origin, { requestTimeoutMs: 20 }));

    const timeout = await expectRequestError(client.listClusters(), "timeout", true);
    expect(timeout.message).not.toMatch(/abort|socket|fetch/i);
    const controller = new AbortController();
    controller.abort();
    await expectRequestError(client.listClusters({ signal: controller.signal }), "cancelled", false);
    expect(server.requests).toHaveLength(1);
  });

  test("Classifies lifecycle responses without retrying", async () => {
    const server = await createServer();
    server.enqueue({ status: 202, body: "accepted body is ignored" });
    server.enqueue({ status: 409, body: "possibly partially progressed" });
    server.enqueue({ status: 401, body: "no" });
    const client = await createClient(settings(server.origin));

    await expect(client.startCluster("cluster-1", false)).resolves.toEqual({ outcome: "accepted" });
    await expect(client.terminateCluster("cluster-1", true)).resolves.toEqual({ outcome: "unknown" });
    await expectRequestError(client.startCluster("cluster-1", false), "authentication_failed", false);
    expect(server.requests).toHaveLength(3);
  });
});

describe("CycleCloud TLS", () => {
  test("Extends default trust with a permission-checked custom CA and enforces SAN", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cyclecloud-mcp-pki-"));
    temporaryDirectories.push(directory);
    const pki = await createTestPki(directory);
    const server = await startFakeCycleCloudServer({
      tls: { certificate: pki.certificate, privateKey: pki.privateKey },
      originHost: "localhost",
    });
    servers.push(server);
    server.enqueue({ status: 200, body: "[]" });
    server.enqueue({ status: 200, body: "[]" });
    server.enqueue({ status: 200, body: "[]" });

    const trusted = await createClient(settings(server.origin, { caCertPath: pki.caPath }));
    await expect(trusted.listClusters()).resolves.toEqual([]);

    const defaultTrust = await createClient(settings(server.origin));
    await expectRequestError(defaultTrust.listClusters(), "tls_error", false);

    const mismatchedHost = await createClient(settings(server.origin.replace("localhost", "127.0.0.1"), { caCertPath: pki.caPath }));
    await expectRequestError(mismatchedHost.listClusters(), "tls_error", false);
  });

  test("Rejects an insecure custom CA file before making a request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cyclecloud-mcp-pki-"));
    temporaryDirectories.push(directory);
    const pki = await createTestPki(directory);
    await chmod(pki.caPath, 0o666);

    const error = await createCycleCloudClient(settings("https://localhost", { caCertPath: pki.caPath }), credentials).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StartupError);
    expect(error).toMatchObject({ code: "configuration_invalid", reason: "invalid_ca_path" });
  });
});
