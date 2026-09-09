import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, test } from "vitest";
import { createCycleCloudMcpServer } from "../src/server.js";
import { FakeCycleCloudClient } from "./helpers/fake-client.js";

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
    readonly cycleCloud: FakeCycleCloudClient;
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

describe("CycleCloud MCP discovery", () => {
    test("Registers exactly three read tools by default with read-only annotations", async () => {
        const cycleCloud = new FakeCycleCloudClient();
        const { client } = await connectServer({ cycleCloud });

        const listed = await client.listTools();

        expect(listed.tools.map((tool) => tool.name)).toEqual([
            "list_clusters",
            "get_cluster",
            "get_cluster_status",
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
