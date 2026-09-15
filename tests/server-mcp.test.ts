import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, test } from "vitest";
import { createCycleCloudMcpServer } from "../src/server.js";
import {
    createCycleCloudClient,
    type CycleCloudClient,
} from "../src/cyclecloud-client.js";
import { createFileCredentialProvider } from "../src/credentials.js";
import { startFakeCycleCloudServer } from "./helpers/fake-cyclecloud.js";
import { FakeCycleCloudClient } from "./helpers/fake-client.js";
import {
    applicationNodes,
    applicationParameters,
} from "./helpers/application-context.js";

interface ConnectedServer {
    readonly client: Client;
    readonly server: McpServer;
}

const connections: ConnectedServer[] = [];

afterEach(async () => {
    await Promise.allSettled(
        connections
            .splice(0)
            .flatMap(({ client, server }) => [client.close(), server.close()]),
    );
});

async function connectServer(options: {
    readonly cycleCloud: CycleCloudClient;
    readonly enableMutations?: boolean;
    readonly onWarning?: (warning: string) => void;
}): Promise<ConnectedServer> {
    const server = createCycleCloudMcpServer({
        client: options.cycleCloud,
        enableMutations: options.enableMutations ?? false,
        ...(options.onWarning === undefined
            ? {}
            : { onWarning: options.onWarning }),
    });
    const client = new Client({
        name: "cyclecloud-mcp-test",
        version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const connected = { client, server };
    connections.push(connected);
    return connected;
}

function createReadClient(origin: string) {
    return createCycleCloudClient(
        {
            url: origin,
            verifyTls: true,
            allowInsecureHttp: false,
            enableMutations: false,
            requestTimeoutMs: 1000,
            actionTimeoutMs: 1000,
            debug: false,
        },
        createFileCredentialProvider({
            username: "test-user",
            password: "test-password",
        }),
    );
}

describe("CycleCloud MCP discovery", () => {
    test("Registers exactly four read tools by default with read-only annotations", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        const { client } = await connectServer({ cycleCloud });

        const listed = await client.listTools();

        expect(listed.tools.map((tool) => tool.name)).toEqual([
            "list_clusters",
            "get_cluster",
            "get_cluster_status",
            "get_cluster_application_context",
        ]);
        expect(
            listed.tools.every(
                (tool) => tool.annotations?.readOnlyHint === true,
            ),
        ).toBe(true);
        expect(
            listed.tools.every(
                (tool) => tool.annotations?.destructiveHint === false,
            ),
        ).toBe(true);
        expect(
            listed.tools.every(
                (tool) => tool.annotations?.idempotentHint === true,
            ),
        ).toBe(true);
        expect(
            listed.tools.every(
                (tool) => tool.annotations?.openWorldHint === true,
            ),
        ).toBe(true);
        expect(
            listed.tools.find(
                (tool) => tool.name === "get_cluster_application_context",
            )?.inputSchema,
        ).toMatchObject({
            properties: {
                view: { default: "overview", enum: ["overview", "details"] },
                section: { enum: ["environment", "storage", "attachments"] },
                offset: { default: 0 },
            },
        });
        const absentMutation = await client.callTool({
            name: "start_cluster",
            arguments: { clusterName: "cluster-1" },
        });
        expect(absentMutation.isError).toBe(true);
        expect(cycleCloud.calls.start).toBe(0);
    });

    test("Registers both mutation tools only when enabled and emits one warning", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        const warnings: string[] = [];
        const { client } = await connectServer({
            cycleCloud,
            enableMutations: true,
            onWarning: (warning) => warnings.push(warning),
        });

        const listed = await client.listTools();

        expect(listed.tools.map((tool) => tool.name)).toEqual([
            "list_clusters",
            "get_cluster",
            "get_cluster_status",
            "get_cluster_application_context",
            "start_cluster",
            "terminate_cluster",
        ]);
        const mutations = listed.tools.filter(
            (tool) =>
                tool.name.endsWith("_cluster") && !tool.name.startsWith("get_"),
        );
        expect(
            mutations.every((tool) => tool.annotations?.readOnlyHint === false),
        ).toBe(true);
        expect(
            mutations.every(
                (tool) => tool.annotations?.destructiveHint === true,
            ),
        ).toBe(true);
        expect(
            mutations.every(
                (tool) => tool.annotations?.idempotentHint === false,
            ),
        ).toBe(true);
        expect(warnings).toEqual(["mutations_enabled"]);
    });
});

describe("CycleCloud MCP calls", () => {
    test.each([
        "list_clusters",
        "get_cluster",
        "get_cluster_status",
        "get_cluster_application_context",
        "start_cluster",
        "terminate_cluster",
    ])("Reports an unreachable instance through %s", async (name) => {
        const backend = await startFakeCycleCloudServer();
        await backend.close();
        const cycleCloud = await createCycleCloudClient(
            {
                url: backend.origin,
                verifyTls: true,
                allowInsecureHttp: true,
                enableMutations: true,
                requestTimeoutMs: 1_000,
                actionTimeoutMs: 1_000,
                debug: false,
            },
            createFileCredentialProvider({
                username: "test-user",
                password: "test-password",
            }),
        );
        try {
            const { client } = await connectServer({
                cycleCloud,
                enableMutations: true,
            });
            const result = await client.callTool({
                name,
                arguments:
                    name === "list_clusters"
                        ? {}
                        : { clusterName: "cluster-1" },
            });
            const message =
                "The CycleCloud instance is unreachable. Check that CycleCloud is running, the configured URL is correct, and network/VPN access is available before retrying.";
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toEqual({
                error: {
                    category: "cyclecloud_unreachable",
                    message,
                    retryable: true,
                },
            });
            expect(result.content).toEqual([{ type: "text", text: message }]);
        } finally {
            await cycleCloud.close();
        }
    });

    test.each([200, 403])(
        "Reads application context over HTTP with optional parameter status %i",
        async (parameterStatus) => {
            const backend = await startFakeCycleCloudServer();
            backend.enqueue({
                status: 200,
                body: JSON.stringify([{ ClusterName: "demo" }]),
            });
            backend.enqueue({
                status: 200,
                body: JSON.stringify([applicationNodes()[0]]),
            });
            backend.enqueue({
                status: 200,
                body: JSON.stringify(applicationNodes()),
            });
            backend.enqueue({
                status: parameterStatus,
                body: JSON.stringify(applicationParameters()),
            });
            const cycleCloud = await createReadClient(backend.origin);
            try {
                const { client } = await connectServer({ cycleCloud });
                const result = await client.callTool({
                    name: "get_cluster_application_context",
                    arguments: {
                        clusterName: "demo",
                        targetNames: ["scheduler"],
                        view: "details",
                        section: "attachments",
                        installPath: "/shared//apps/",
                    },
                });
                expect(result.isError, JSON.stringify(result)).toBe(false);
                expect(result.structuredContent).toMatchObject({
                    context: {
                        installPath: "/shared/apps",
                        targets: { available: true, total: 1 },
                        attachmentParameters: {
                            available: parameterStatus === 200,
                        },
                    },
                });
                expect(JSON.stringify(result)).not.toContain("SECRET_");
                expect(backend.requests).toHaveLength(4);
                expect(
                    backend.requests.every(
                        (request) => request.method === "GET",
                    ),
                ).toBe(true);
            } finally {
                await cycleCloud.close();
                await backend.close();
            }
        },
    );

    test.each([200, 403])(
        "Enriches environment platform metadata over HTTP (status=%i)",
        async (status) => {
            const backend = await startFakeCycleCloudServer();
            backend.enqueue({
                status: 200,
                body: JSON.stringify([{ ClusterName: "demo" }]),
            });
            backend.enqueue({
                status: 200,
                body: JSON.stringify([applicationNodes()[0]]),
            });
            backend.enqueue({
                status,
                body: JSON.stringify([
                    {
                        Name: "cycle.image.ubuntu22",
                        PackageType: "image",
                        OS: "linux",
                        JetpackPlatform: "ubuntu-22.04",
                        Label: "Ubuntu 22.04 LTS",
                        Secret: "SECRET_IMAGE",
                    },
                ]),
            });
            const cycleCloud = await createReadClient(backend.origin);
            try {
                const { client } = await connectServer({ cycleCloud });
                const result = await client.callTool({
                    name: "get_cluster_application_context",
                    arguments: {
                        clusterName: "demo",
                        view: "details",
                        targetNames: ["scheduler"],
                        section: "environment",
                    },
                });
                expect(result.isError).toBe(false);
                expect(result.structuredContent).toMatchObject({
                    context: {
                        targets: {
                            available: true,
                            items: [
                                {
                                    scheduler: { version: "23.11" },
                                    platform: { available: status === 200 },
                                },
                            ],
                        },
                    },
                });
                expect(JSON.stringify(result)).not.toContain("SECRET_");
                expect(backend.requests).toHaveLength(3);
                expect(
                    backend.requests.every(
                        (request) => request.method === "GET",
                    ),
                ).toBe(true);
            } finally {
                await cycleCloud.close();
                await backend.close();
            }
        },
    );

    test("Returns application authoring context with defaults and no raw secrets", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        cycleCloud.clusterResult = [{ ClusterName: "demo" }];
        cycleCloud.applicationNodesResult = applicationNodes();
        cycleCloud.applicationParametersResult = applicationParameters();
        const { client } = await connectServer({ cycleCloud });
        const result = await client.callTool({
            name: "get_cluster_application_context",
            arguments: { clusterName: "demo" },
        });
        expect(result.isError, JSON.stringify(result)).toBe(false);
        expect(result.structuredContent).toMatchObject({
            context: {
                evidence: "configured",
                installPath: "/shared/apps",
                targets: { available: true, total: 3 },
            },
        });
        expect(JSON.stringify(result)).not.toContain("SECRET_");
    });

    test.each([
        { installPath: "relative" },
        { installPath: "/shared/../etc" },
        { installPath: "/shared/\0" },
        { installPath: "/shared/\ud800" },
        { targetLimit: 0 },
        { targetLimit: 21 },
        { view: "details" },
        { view: "details", targetNames: ["scheduler", "hpc"] },
        { view: "details", targetNames: ["hpc"], section: "all" },
        { section: "storage" },
        { offset: -1 },
        { offset: 1_000_001 },
        { itemLimit: 11 },
        { targetNames: [] },
        { targetNames: ["."] },
        { targetNames: Array(21).fill("node") },
        { rawQuery: "select *" },
    ])(
        "Rejects invalid application context input before reads: %j",
        async (args) => {
            const cycleCloud = new FakeCycleCloudClient();
            const { client } = await connectServer({ cycleCloud });
            const result = await client.callTool({
                name: "get_cluster_application_context",
                arguments: { clusterName: "demo", ...args },
            });
            expect(result.isError).toBe(true);
            expect(cycleCloud.calls.cluster).toBe(0);
            expect(cycleCloud.calls.applicationNodes).toBe(0);
        },
    );

    test("Returns structured bounded read content and applies input defaults", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        cycleCloud.listResult = [{ ClusterName: "cluster-1" }];
        const { client } = await connectServer({ cycleCloud });

        const result = await client.callTool({
            name: "list_clusters",
            arguments: {},
        });

        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
            total: 1,
            returned: 1,
            truncated: false,
        });
        expect(result.content).toEqual([
            { type: "text", text: "Returned 1 of 1 CycleCloud clusters." },
        ]);
        expect(cycleCloud.calls.list).toBe(1);
    });

    test("Trims and validates cluster names before calling CycleCloud", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        cycleCloud.clusterResult = [{ ClusterName: "cluster-1" }];
        const { client } = await connectServer({ cycleCloud });

        await expect(
            client.callTool({
                name: "get_cluster",
                arguments: { clusterName: "  cluster-1  " },
            }),
        ).resolves.toMatchObject({
            isError: false,
        });
        const dotSegment = await client.callTool({
            name: "get_cluster",
            arguments: { clusterName: ".." },
        });
        const controlCharacter = await client.callTool({
            name: "get_cluster",
            arguments: { clusterName: "bad\nname" },
        });
        expect(dotSegment.isError).toBe(true);
        expect(controlCharacter.isError).toBe(true);
        expect(cycleCloud.calls.cluster).toBe(1);
    });

    test("Rejects out-of-range and undeclared inputs before calling CycleCloud", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        const { client } = await connectServer({
            cycleCloud,
            enableMutations: true,
        });

        const listLimit = await client.callTool({
            name: "list_clusters",
            arguments: { limit: 201 },
        });
        const nodeArrayLimit = await client.callTool({
            name: "get_cluster_status",
            arguments: { clusterName: "cluster-1", nodeArrayLimit: 51 },
        });
        const undeclaredMutationInput = await client.callTool({
            name: "start_cluster",
            arguments: { clusterName: "cluster-1", test_mode: true },
        });

        expect(
            [listLimit, nodeArrayLimit, undeclaredMutationInput].every(
                (result) => result.isError === true,
            ),
        ).toBe(true);
        expect(cycleCloud.calls).toMatchObject({
            list: 0,
            status: 0,
            start: 0,
        });
    });

    test("Exposes issue limits and summaries through MCP", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        cycleCloud.getClusterIssues = () =>
            Promise.resolve([
                {
                    Name: "Boot",
                    Status: "Error",
                    Message: "Boot failed",
                    NodeCount: 2,
                },
            ]);
        const { client } = await connectServer({ cycleCloud });
        const result = await client.callTool({
            name: "get_cluster_status",
            arguments: { clusterName: "cluster-1", issueLimit: 0 },
        });
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toMatchObject({
            status: {
                issues: {
                    available: true,
                    total: 1,
                    returned: 0,
                    truncated: true,
                },
            },
        });
        expect(result.content).toEqual([
            {
                type: "text",
                text: "Returned CycleCloud cluster status with 0 of 1 node issue groups.",
            },
        ]);
        const invalid = await client.callTool({
            name: "get_cluster_status",
            arguments: { clusterName: "cluster-1", issueLimit: 101 },
        });
        expect(invalid.isError).toBe(true);
        expect(cycleCloud.calls.status).toBe(1);
    });

    test("Warns in MCP text when node issues are unavailable", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        cycleCloud.getClusterIssues = () => Promise.resolve(null);
        const { client } = await connectServer({ cycleCloud });
        const result = await client.callTool({
            name: "get_cluster_status",
            arguments: { clusterName: "cluster-1" },
        });
        expect(result.isError).toBe(false);
        expect(result.content).toEqual([
            {
                type: "text",
                text: "Cluster status is available, but node issues could not be retrieved.",
            },
        ]);
    });

    test("Returns exact fixed structured errors without server text", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        cycleCloud.listResult = null;
        const { client } = await connectServer({ cycleCloud });

        const result = await client.callTool({
            name: "list_clusters",
            arguments: {},
        });

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({
            error: {
                category: "invalid_response",
                message:
                    "CycleCloud returned a response the plugin could not safely use.",
                retryable: false,
            },
        });
        expect(result.content).toEqual([
            {
                type: "text",
                text: "CycleCloud returned a response the plugin could not safely use.",
            },
        ]);
    });

    test("Returns an uncertain mutation as a successful result", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        cycleCloud.startResult = { outcome: "unknown" };
        const { client } = await connectServer({
            cycleCloud,
            enableMutations: true,
        });

        const result = await client.callTool({
            name: "start_cluster",
            arguments: { clusterName: "cluster-1" },
        });

        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
            action: "start",
            clusterName: "cluster-1",
            recursive: false,
            outcome: "unknown",
        });
        expect(cycleCloud.calls).toMatchObject({ start: 1, status: 0 });
    });
});
