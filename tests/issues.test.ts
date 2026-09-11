import { describe, expect, test } from "vitest";
import { normalizeClusterIssues } from "../src/normalize.js";
import { CycleCloudTools } from "../src/tools.js";
import { CycleCloudRequestError } from "../src/errors.js";
import { FakeCycleCloudClient } from "./helpers/fake-client.js";

const error = {
    Name: "Configuration",
    Status: "Error",
    Message: "Configuration failed",
    NodeCount: 3,
    Detail: "First line\nSecond line",
    Recommendation: "Check configuration",
    Secret: "must not be returned",
};
const input = { clusterName: "cluster-1", nodeArrayLimit: 20, bucketLimit: 20 };
const signal = new AbortController().signal;

describe("Cluster issue normalization", () => {
    test("Returns errors before warnings, ignoring other statuses and fields", () => {
        expect(
            normalizeClusterIssues(
                [
                    { ...error, Status: "Warning", Message: "Warning" },
                    { ...error, Status: "Pending" },
                    { ...error, Status: "OK" },
                    error,
                ],
                20,
            ),
        ).toEqual({
            available: true,
            items: [
                {
                    name: "Configuration",
                    severity: "Error",
                    message: "Configuration failed",
                    nodeCount: 3,
                    detail: "First line Second line",
                    recommendation: "Check configuration",
                    textTruncated: false,
                },
                {
                    name: "Configuration",
                    severity: "Warning",
                    message: "Warning",
                    nodeCount: 3,
                    detail: "First line Second line",
                    recommendation: "Check configuration",
                    textTruncated: false,
                },
            ],
            total: 2,
            returned: 2,
            truncated: false,
        });
    });

    test("Reports counts and truncation even with a zero limit", () => {
        expect(normalizeClusterIssues([error, error], 0)).toEqual({
            available: true,
            items: [],
            total: 2,
            returned: 0,
            truncated: true,
        });
        expect(normalizeClusterIssues([], 20)).toEqual({
            available: true,
            items: [],
            total: 0,
            returned: 0,
            truncated: false,
        });
    });

    test("Accepts case-insensitive fields and absent optional text", () => {
        expect(
            normalizeClusterIssues(
                [
                    {
                        name: "Boot",
                        status: "Error",
                        nodecount: 1,
                        message: null,
                        detail: null,
                    },
                ],
                20,
            ).items[0],
        ).toEqual({
            name: "Boot",
            severity: "Error",
            nodeCount: 1,
            textTruncated: false,
        });
    });

    test("Bounds diagnostic text without losing the issue", () => {
        const result = normalizeClusterIssues(
            [
                {
                    ...error,
                    Message: "雪".repeat(3000),
                    Detail: "bad\u001btext",
                },
            ],
            20,
        );
        expect([...(result.items[0]?.message ?? "")]).toHaveLength(2048);
        expect(result.items[0]?.message).toMatch(/…$/u);
        expect(result.items[0]).toMatchObject({
            detail: "bad text",
            textTruncated: true,
        });
    });

    test.each([
        null,
        {},
        [{ ...error, NodeCount: -1 }],
        [{ ...error, Status: "Unexpected" }],
        [{ ...error, Message: {} }],
        [{ ...error, Message: "\ud800" }],
        [{ ...error, status: "Warning" }],
    ])("Rejects malformed issue data: %j", (raw) => {
        expect(() => normalizeClusterIssues(raw, 20)).toThrow(
            CycleCloudRequestError,
        );
    });

    test.each([-1, 101, 1.5])("Rejects invalid limit %s", (limit) => {
        expect(() => normalizeClusterIssues([], limit)).toThrow(
            CycleCloudRequestError,
        );
    });
});

describe("Status issue enrichment", () => {
    test("Includes bounded issues and forwards cluster identity and signal", async () => {
        const client = new FakeCycleCloudClient();
        let observed: unknown;
        client.getClusterIssues = (name, options) => {
            observed = { name, signal: options?.signal };
            return Promise.resolve([error]);
        };
        const result = await new CycleCloudTools(client).getClusterStatus(
            { ...input, issueLimit: 0 },
            signal,
        );
        expect(observed).toEqual({ name: input.clusterName, signal });
        expect(result.status.issues).toMatchObject({
            available: true,
            items: [],
            total: 1,
            truncated: true,
        });
    });

    test.each(["permission_denied", "timeout", "invalid_response"] as const)(
        "Preserves status when issues fail: %s",
        async (category) => {
            const client = new FakeCycleCloudClient();
            client.getClusterIssues = () =>
                Promise.reject(new CycleCloudRequestError(category, false));
            const result = await new CycleCloudTools(client).getClusterStatus(
                input,
                signal,
            );
            expect(result.status.clusterName).toBe(input.clusterName);
            expect(result.status.issues).toEqual({
                available: false,
                warning:
                    "Cluster status is available, but node issues could not be retrieved.",
            });
        },
    );

    test("Does not disguise malformed issue data as no issues", async () => {
        const client = new FakeCycleCloudClient();
        client.getClusterIssues = () => Promise.resolve({});
        const result = await new CycleCloudTools(client).getClusterStatus(
            input,
            signal,
        );
        expect(result.status.issues.available).toBe(false);
    });

    test("Does not query issues when the status read fails", async () => {
        const client = new FakeCycleCloudClient();
        client.statusResult = null;
        await expect(
            new CycleCloudTools(client).getClusterStatus(input, signal),
        ).rejects.toMatchObject({ category: "invalid_response" });
        expect(client.calls.issues).toBe(0);
    });

    test("Propagates cancellation during issue retrieval", async () => {
        const client = new FakeCycleCloudClient();
        client.getClusterIssues = () =>
            Promise.reject(new CycleCloudRequestError("cancelled", false));
        await expect(
            new CycleCloudTools(client).getClusterStatus(input, signal),
        ).rejects.toMatchObject({ category: "cancelled" });
    });
});
