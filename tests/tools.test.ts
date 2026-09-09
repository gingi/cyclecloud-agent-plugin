import { describe, expect, test } from "vitest";
import { CycleCloudRequestError } from "../src/errors.js";
import { CycleCloudTools, unknownOutcomeWarning } from "../src/tools.js";
import { FakeCycleCloudClient } from "./helpers/fake-client.js";

const openSignal = new AbortController().signal;
const status = {
    state: "Started",
    targetState: "Started",
    nodearrays: [],
    maxCount: 10,
    maxCoreCount: 20,
};

describe("CycleCloud read tools", () => {
    test("Normalize bounded list, detail, and status results", async () => {
        const client = new FakeCycleCloudClient();
        client.listResult = [{ ClusterName: "cluster-1" }];
        client.clusterResult = [{ ClusterName: "cluster-1" }];
        client.statusResult = status;
        const tools = new CycleCloudTools(client);

        await expect(
            tools.listClusters({ limit: 50 }, openSignal),
        ).resolves.toMatchObject({ total: 1, returned: 1 });
        await expect(
            tools.getCluster(
                {
                    clusterName: "cluster-1",
                    fixedNodeLimit: 50,
                    nodeArrayLimit: 50,
                },
                openSignal,
            ),
        ).resolves.toMatchObject({ cluster: { name: "cluster-1" } });
        await expect(
            tools.getClusterStatus(
                {
                    clusterName: "cluster-1",
                    nodeArrayLimit: 20,
                    bucketLimit: 20,
                },
                openSignal,
            ),
        ).resolves.toMatchObject({
            status: { clusterName: "cluster-1", state: "Started" },
        });
        expect(client.calls).toMatchObject({ list: 1, cluster: 1, status: 1 });
    });

    test("Propagate fixed request errors unchanged", async () => {
        const client = new FakeCycleCloudClient();
        client.listResult = null;
        const tools = new CycleCloudTools(client);

        await expect(
            tools.listClusters({ limit: 50 }, openSignal),
        ).rejects.toMatchObject({
            category: "invalid_response",
            retryable: false,
        });
    });
});

describe("CycleCloud mutation tools", () => {
    test("Reject pre-dispatch cancellation without calling CycleCloud", async () => {
        const client = new FakeCycleCloudClient();
        const tools = new CycleCloudTools(client);
        const controller = new AbortController();
        controller.abort();

        await expect(
            tools.startCluster(
                { clusterName: "cluster-1", recursive: false },
                controller.signal,
            ),
        ).rejects.toMatchObject({
            category: "cancelled",
        });
        expect(client.calls.start).toBe(0);
    });

    test("Return accepted with one best-effort observed status", async () => {
        const client = new FakeCycleCloudClient();
        client.statusResult = status;
        const tools = new CycleCloudTools(client);

        await expect(
            tools.startCluster(
                { clusterName: "cluster-1", recursive: true },
                openSignal,
            ),
        ).resolves.toEqual({
            action: "start",
            clusterName: "cluster-1",
            recursive: true,
            outcome: "accepted",
            observedStatus: { state: "Started", targetState: "Started" },
        });
        expect(client.calls).toMatchObject({ start: 1, status: 1 });
    });

    test("Preserve accepted when the best-effort status read fails", async () => {
        const client = new FakeCycleCloudClient();
        client.statusResult = null;
        const tools = new CycleCloudTools(client);

        const result = await tools.terminateCluster(
            { clusterName: "cluster-1", recursive: false },
            openSignal,
        );

        expect(result).toMatchObject({
            action: "terminate",
            outcome: "accepted",
        });
        expect(result.warning).toMatch(/accepted/i);
        expect(client.calls).toMatchObject({ terminate: 1, status: 1 });
    });

    test("Return unknown without a follow-up or retry", async () => {
        const client = new FakeCycleCloudClient();
        client.startResult = { outcome: "unknown" };
        const tools = new CycleCloudTools(client);

        await expect(
            tools.startCluster(
                { clusterName: "cluster-1", recursive: false },
                openSignal,
            ),
        ).resolves.toEqual({
            action: "start",
            clusterName: "cluster-1",
            recursive: false,
            outcome: "unknown",
            warning: unknownOutcomeWarning,
        });
        expect(client.calls).toMatchObject({ start: 1, status: 0 });
    });

    test("Reject an overlapping mutation immediately as busy", async () => {
        const client = new FakeCycleCloudClient();
        client.statusResult = status;
        let acceptFirst: () => void = () => undefined;
        client.startHandler = async () =>
            new Promise((resolve) => {
                acceptFirst = () => resolve({ outcome: "accepted" });
            });
        const tools = new CycleCloudTools(client);

        const first = tools.startCluster(
            { clusterName: "cluster-1", recursive: false },
            openSignal,
        );
        await Promise.resolve();
        const cancelled = new AbortController();
        cancelled.abort();
        await expect(
            tools.terminateCluster(
                { clusterName: "cluster-1", recursive: false },
                cancelled.signal,
            ),
        ).rejects.toMatchObject({
            category: "cancelled",
        });
        await expect(
            tools.terminateCluster(
                { clusterName: "cluster-1", recursive: false },
                openSignal,
            ),
        ).rejects.toEqual(new CycleCloudRequestError("busy", true));
        expect(client.calls.terminate).toBe(0);
        acceptFirst();
        await expect(first).resolves.toMatchObject({ outcome: "accepted" });
    });
});
