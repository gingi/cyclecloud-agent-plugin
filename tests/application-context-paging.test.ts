import { describe, expect, test, vi } from "vitest";
import { CycleCloudTools } from "../src/tools.js";
import { FakeCycleCloudClient } from "./helpers/fake-client.js";
import {
    applicationNodes,
    applicationParameters,
} from "./helpers/application-context.js";

const signal = new AbortController().signal;
const input = {
    clusterName: "demo",
    installPath: "/shared/apps",
    targetLimit: 10,
};
function fixture() {
    const client = new FakeCycleCloudClient();
    client.clusterResult = [{ ClusterName: "demo" }];
    client.applicationNodesResult = applicationNodes();
    client.applicationParametersResult = applicationParameters();
    return client;
}

describe("Compact application context", () => {
    test("defaults to overview without nested records or parameter reads", async () => {
        const client = fixture();
        const read = vi.spyOn(client, "getApplicationNodes");
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(input, signal);
        expect(result.context.view).toBe("overview");
        expect(result.context.targets).toMatchObject({
            available: true,
            total: 3,
            offset: 0,
            nextOffset: null,
        });
        if (!result.context.targets.available)
            throw new Error("Expected overview");
        expect(result.context.targets.items[0]).toMatchObject({
            name: "hpc",
            kind: "nodearray",
            role: "execute",
            partition: "hpc",
        });
        expect(result.context.targets.items[0]).not.toHaveProperty("mounts");
        expect(result.context.targets.items[0]).not.toHaveProperty("specs");
        expect(result.context.attachmentParameters).toBeUndefined();
        expect(read).toHaveBeenCalledWith(
            "demo",
            { signal },
            { view: "overview" },
        );
        expect(client.calls.applicationParameters).toBe(0);
    });

    test("pages overview targets instead of making later entries unreachable", async () => {
        const client = fixture();
        const tools = new CycleCloudTools(client);
        const first = await tools.getClusterApplicationContext(
            { ...input, targetLimit: 2 },
            signal,
        );
        const next = await tools.getClusterApplicationContext(
            { ...input, targetLimit: 2, offset: 2 },
            signal,
        );
        expect(first.context.targets).toMatchObject({
            returned: 2,
            nextOffset: 2,
        });
        expect(next.context.targets).toMatchObject({
            returned: 1,
            nextOffset: null,
            items: [{ name: "scheduler-ha" }],
        });
    });

    test("retrieves only storage for one explicit target", async () => {
        const client = fixture();
        client.applicationNodesResult = [applicationNodes()[0]];
        const read = vi.spyOn(client, "getApplicationNodes");
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(
            {
                ...input,
                view: "details",
                targetNames: ["scheduler"],
                section: "storage",
            },
            signal,
        );
        expect(read).toHaveBeenCalledWith(
            "demo",
            { signal },
            { view: "details", targetName: "scheduler", section: "storage" },
        );
        if (!result.context.targets.available)
            throw new Error("Expected details");
        expect(result.context.targets.items[0]).toHaveProperty("mounts");
        expect(result.context.targets.items[0]).not.toHaveProperty("specs");
        expect(result.context.targets.items[0]).not.toHaveProperty("bases");
        expect(client.calls.applicationParameters).toBe(0);
    });

    test("attachment details preserve shared scope and page both spec lists", async () => {
        const client = fixture();
        const read = vi.spyOn(client, "getApplicationNodes");
        read.mockResolvedValueOnce([
            applicationNodes()[0],
        ]).mockResolvedValueOnce(applicationNodes());
        const metadata = vi.spyOn(client, "getApplicationParameters");
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(
            {
                ...input,
                view: "details",
                targetNames: ["scheduler"],
                section: "attachments",
                itemLimit: 1,
            },
            signal,
        );
        if (!result.context.targets.available)
            throw new Error("Expected details");
        expect(result.context.targets.items[0]).toMatchObject({
            specs: { total: 2, returned: 1, nextOffset: 1 },
        });
        expect(result.context.attachmentParameters).toMatchObject({
            available: true,
            items: [
                {
                    name: "SchedulerClusterInitSpecs",
                    usedBy: {
                        available: true,
                        total: 2,
                        returned: 1,
                        nextOffset: 1,
                        items: ["scheduler"],
                    },
                },
            ],
        });
        expect(metadata).toHaveBeenCalledWith(
            "demo",
            { signal },
            "SchedulerClusterInitSpecs",
        );
        expect(read).toHaveBeenNthCalledWith(
            2,
            "demo",
            { signal },
            { view: "overview" },
        );
    });

    test.each([
        "${ifThenElse(UseCustom, SECRET_CustomSpecs, SchedulerClusterInitSpecs)}",
        undefined,
        "",
    ])(
        "marks shared uses unavailable for an unresolved reference: %s",
        async (reference) => {
            const client = fixture();
            client.applicationNodesResult = applicationNodes().map((node) =>
                node.Name === "scheduler-ha"
                    ? { ...node, AttachmentReference: reference }
                    : node,
            );
            const tools = new CycleCloudTools(client);
            for (const offset of [0, 1]) {
                const result = await tools.getClusterApplicationContext(
                    {
                        ...input,
                        view: "details",
                        targetNames: ["scheduler"],
                        section: "attachments",
                        itemLimit: 1,
                        offset,
                    },
                    signal,
                );
                expect(result.context.targets).toMatchObject({
                    available: true,
                });
                expect(result.context.attachmentParameters).toMatchObject({
                    available: true,
                    items: [
                        {
                            name: "SchedulerClusterInitSpecs",
                            specs: { available: true },
                            usedBy: {
                                available: false,
                                warning: expect.stringContaining(
                                    "single-target",
                                ) as unknown,
                            },
                        },
                    ],
                });
                const parameters = result.context.attachmentParameters;
                if (!parameters?.available)
                    throw new Error("Expected parameter metadata");
                expect(parameters.items[0]?.usedBy).not.toHaveProperty("total");
                expect(parameters.items[0]?.usedBy).not.toHaveProperty("items");
                expect(JSON.stringify(result)).not.toContain("SECRET_");
                expect(JSON.stringify(result)).not.toContain("ifThenElse");
            }
        },
    );

    test("keeps parameter values when shared-use discovery is denied", async () => {
        const client = fixture();
        vi.spyOn(client, "getApplicationNodes")
            .mockResolvedValueOnce([applicationNodes()[0]])
            .mockRejectedValueOnce(new Error("denied"));
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(
            {
                ...input,
                view: "details",
                targetNames: ["scheduler"],
                section: "attachments",
            },
            signal,
        );
        expect(result.context.attachmentParameters).toMatchObject({
            available: true,
            items: [
                {
                    name: "SchedulerClusterInitSpecs",
                    usedBy: { available: false },
                    specs: { available: true },
                },
            ],
        });
    });

    test("refuses mismatched detail identities rather than returning another target", async () => {
        const client = fixture();
        vi.spyOn(client, "getApplicationNodes").mockResolvedValue([
            applicationNodes()[0],
        ]);
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(
            {
                ...input,
                view: "details",
                targetNames: ["hpc"],
                section: "environment",
            },
            signal,
        );
        expect(result.context.targets).toMatchObject({ available: false });
        expect(client.calls.applicationParameters).toBe(0);
    });

    test("keeps a large cluster overview small and ignores irrelevant malformed details", async () => {
        const client = fixture();
        client.applicationNodesResult = Array.from({ length: 200 }, (_, i) => ({
            Name: `node-${i.toString().padStart(3, "0")}`,
            IsArray: true,
            SlurmRole: "execute",
            ImageName: "image",
            Mounts: "malformed detail not fetched by overview",
            ClusterInitSpecs: { secret: "do not normalize" },
        }));
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(input, signal);
        expect(result.context.targets).toMatchObject({
            available: true,
            total: 200,
            returned: 10,
            nextOffset: 10,
        });
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
            8 * 1024,
        );
        expect(JSON.stringify(result)).not.toContain("malformed");
    });

    test("uses byte-limited pages without discarding long valid names", async () => {
        const client = fixture();
        const nodes = Array.from({ length: 20 }, (_, i) => ({
            Name: `${i}-${"雪".repeat(250)}`,
            IsArray: true,
            ImageName: "雪".repeat(256),
            SlurmRole: "雪".repeat(256),
            SlurmPartition: "雪".repeat(256),
        }));
        client.applicationNodesResult = nodes;
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext({ ...input, targetLimit: 20 }, signal);
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
            16 * 1024,
        );
        if (!result.context.targets.available)
            throw new Error("Expected overview");
        expect(result.context.targets.returned).toBeGreaterThan(0);
        expect(result.context.targets.nextOffset).toBe(
            result.context.targets.returned,
        );
        expect(result.context.targets.items[0]?.name).toBe(nodes[0]?.Name);
    });

    test("pages large attachment collections within a compact response budget", async () => {
        const client = fixture();
        const specs = Object.fromEntries(
            Array.from({ length: 30 }, (_, i) => [
                `p${i.toString().padStart(2, "0")}:s`,
                {
                    Project: `p${i}-${"雪".repeat(250)}`,
                    Spec: "雪".repeat(256),
                    Version: "1".repeat(256),
                    SourceLocker: "l".repeat(256),
                },
            ]),
        );
        const node = {
            Name: "scheduler",
            Template: "scheduler",
            AttachmentReference: "$Specs",
            ClusterInitSpecs: specs,
        };
        vi.spyOn(client, "getApplicationNodes")
            .mockResolvedValueOnce([node])
            .mockResolvedValueOnce([node]);
        client.applicationParametersResult = [
            {
                Name: "Specs",
                ParameterType: "Cloud.ClusterInitSpecs",
                Value: specs,
            },
        ];
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(
            {
                ...input,
                view: "details",
                targetNames: ["scheduler"],
                section: "attachments",
                offset: 22,
                itemLimit: 10,
            },
            signal,
        );
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
            24 * 1024,
        );
        if (!result.context.targets.available)
            throw new Error("Expected details");
        const target = result.context.targets.items[0];
        if (
            target === undefined ||
            !("specs" in target) ||
            !target.specs.available
        )
            throw new Error("Expected paged specs");
        expect(target.specs).toMatchObject({ offset: 22, total: 30 });
        expect(target.specs.returned).toBeGreaterThan(0);
        expect(target.specs.returned).toBeLessThan(8);
        expect(target.specs.items[0]?.project).toBe(`p22-${"雪".repeat(250)}`);
        expect(JSON.stringify(result)).not.toContain("SECRET_");
    });
});
