import { describe, expect, test, vi } from "vitest";
import {
    normalizeApplicationDetails,
    normalizeApplicationParameters,
    normalizeContextCluster,
    type ApplicationContextSection,
} from "../src/application-context.js";
import { CycleCloudTools } from "../src/tools.js";
import { CycleCloudRequestError } from "../src/errors.js";
import { FakeCycleCloudClient } from "./helpers/fake-client.js";
import {
    applicationNodes,
    applicationParameters,
} from "./helpers/application-context.js";

const signal = new AbortController().signal;
const input = {
    clusterName: "demo",
    installPath: "/shared/apps",
    targetLimit: 20,
};

function clientFixture() {
    const client = new FakeCycleCloudClient();
    client.clusterResult = [{ ClusterName: "demo", State: "Started" }];
    client.applicationNodesResult = applicationNodes();
    client.applicationParametersResult = applicationParameters();
    return client;
}

function details(value: unknown, section: ApplicationContextSection) {
    return normalizeApplicationDetails(value, "/shared/apps", section, {});
}
const sections = ["environment", "storage", "attachments"] as const;

describe("Application context normalization", () => {
    test("normalizes configured topology, mounts, specs and attachment references", () => {
        const raw = applicationNodes();
        const environment = details(raw, "environment");
        for (const section of sections)
            expect(details(raw, section).map((node) => node.name)).toEqual([
                "hpc",
                "scheduler",
                "scheduler-ha",
            ]);
        expect(environment[1]).toMatchObject({
            kind: "node",
            image: "cycle.image.ubuntu22",
            architecture: "x86_64",
            locker: "project-storage",
            scheduler: { role: "scheduler", haEnabled: true, primary: true },
        });
        expect(details(raw, "storage")[1]).toMatchObject({
            mounts: {
                available: true,
                items: expect.arrayContaining([
                    expect.objectContaining({
                        name: "builtinshared",
                        mountpoint: "/shared",
                        coversInstallPath: true,
                    }),
                ]) as unknown,
            },
            volumes: {
                available: true,
                items: [
                    {
                        name: "shared",
                        mount: "builtinshared",
                        persistent: true,
                        disabled: false,
                    },
                ],
            },
        });
        expect(environment[2]).toMatchObject({
            bases: { available: true, items: ["scheduler"] },
        });
        expect(environment[0]).toMatchObject({
            scheduler: { partition: "hpc", autoscale: true },
        });
        expect(details(raw, "attachments")).toMatchObject([
            { attachment: { parameterName: "HPCClusterInitSpecs" } },
            {
                attachment: {
                    parameterName: "SchedulerClusterInitSpecs",
                    available: true,
                },
            },
            {},
        ]);
    });

    test("accepts scalar inheritance and multi-select machine types from real templates", () => {
        const nodes = details(
            [
                {
                    Name: "dynamic",
                    IsArray: true,
                    Extends: "nodearraybase",
                    MachineType: ["Standard_D8s_v5", "Standard_D4s_v5"],
                },
            ],
            "environment",
        );
        expect(nodes[0]).toMatchObject({
            bases: { available: true, items: ["nodearraybase"] },
            machineTypes: {
                available: true,
                items: ["Standard_D8s_v5", "Standard_D4s_v5"],
            },
        });
    });

    test("preserves configured inheritance precedence", () => {
        const nodes = details(
            [
                {
                    Name: "node",
                    Template: "node",
                    Extends: ["z-base", "a-override"],
                },
            ],
            "environment",
        );
        expect(nodes[0]).toMatchObject({
            bases: { available: true, items: ["z-base", "a-override"] },
        });
    });

    test.each(sections)(
        "does not return arbitrary configuration or secrets in %s",
        (section) => {
            const text = JSON.stringify({
                nodes: details(applicationNodes(), section),
                parameters: normalizeApplicationParameters(
                    applicationParameters(),
                ),
            });
            expect(text).not.toContain("SECRET_");
            expect(text).not.toContain("Configuration");
            expect(text).not.toContain("options");
        },
    );

    test("matches mount paths by component and treats disabled or unknown-enabled mounts conservatively", () => {
        const raw = [
            {
                Name: "node",
                Template: "node",
                Mounts: {
                    root: { mountpoint: "/", disabled: false },
                    sibling: {
                        mountpoint: "/shared/appstore",
                        disabled: false,
                    },
                    disabled: { mountpoint: "/shared/apps", disabled: true },
                    unknown: { mountpoint: "/shared", type: "nfs" },
                },
            },
        ];
        expect(details(raw, "storage")[0]).toMatchObject({
            mounts: {
                items: expect.arrayContaining([
                    expect.objectContaining({
                        name: "root",
                        coversInstallPath: true,
                    }),
                    expect.objectContaining({
                        name: "sibling",
                        coversInstallPath: false,
                    }),
                    expect.objectContaining({
                        name: "disabled",
                        coversInstallPath: false,
                    }),
                    expect.objectContaining({
                        name: "unknown",
                        coversInstallPath: null,
                    }),
                ]) as unknown,
            },
        });
    });

    test("distinguishes missing collections from known empty ones and does not emit raw attachment expressions", () => {
        const raw = [
            {
                Name: "node",
                Template: "node",
                ClusterInitSpecs: {},
                AttachmentReference: '${ifThenElse(true, "SECRET", "other")}',
            },
        ];
        const nodes = details(raw, "attachments");
        expect(nodes[0]).toMatchObject({
            specs: { available: true, total: 0, items: [] },
            attachment: { available: false },
        });
        expect(details(raw, "storage")[0]).toMatchObject({
            mounts: { available: false },
        });
        expect(JSON.stringify(nodes)).not.toContain("SECRET");
    });

    test("bounds nested records and strings", () => {
        const specs = Object.fromEntries(
            Array.from({ length: 25 }, (_, index) => [
                `p${index}:s`,
                { Project: `p${index}`, Spec: "s", Version: "1.0.0" },
            ]),
        );
        const nodes = details(
            [{ Name: "node", Template: "node", ClusterInitSpecs: specs }],
            "attachments",
        );
        expect(nodes[0]).toMatchObject({
            specs: { total: 25, returned: 20, truncated: true },
        });
        expect(() =>
            details(
                [{ Name: "x".repeat(257), Template: "node" }],
                "environment",
            ),
        ).toThrow(CycleCloudRequestError);
    });

    test.each(sections)(
        "rejects malformed or duplicate identities in %s",
        (section) => {
            for (const row of [
                { Name: "node", name: "other", Template: "node" },
                { Name: "node", Template: "other" },
                { Name: "node", IsArray: "true" },
            ])
                expect(() => details([row], section)).toThrow(
                    CycleCloudRequestError,
                );
            expect(() =>
                details(
                    [
                        { Name: "node", Template: "node" },
                        { Name: "node", Template: "node" },
                    ],
                    section,
                ),
            ).toThrow(CycleCloudRequestError);
        },
    );

    test.each([
        [
            "storage",
            { Mounts: { a: { mountpoint: "/shared", MountPoint: "/other" } } },
            "mounts",
        ],
        [
            "attachments",
            {
                ClusterInitSpecs: {
                    a: { Project: "p", Spec: "s", Version: 1 },
                },
            },
            "specs",
        ],
        ["environment", { SlurmVersion: 42 }, "scheduler"],
    ] as const)(
        "validates only consumed fields in %s",
        (section, fields, outputField) => {
            const raw = [{ Name: "node", Template: "node", ...fields }];
            expect(() => details(raw, section)).toThrow(CycleCloudRequestError);
            for (const other of sections.filter((value) => value !== section)) {
                expect(() => details(raw, other)).not.toThrow();
                expect(details(raw, other)[0]).not.toHaveProperty(outputField);
            }
        },
    );

    test.each([{ shared: {}, Shared: {} }, { ["x".repeat(257)]: {} }])(
        "rejects duplicate or oversized collection names: %j",
        (mounts) => {
            expect(() =>
                details(
                    [{ Name: "node", Template: "node", Mounts: mounts }],
                    "storage",
                ),
            ).toThrow(CycleCloudRequestError);
        },
    );

    test("rejects unexpected parameter types", () => {
        expect(() =>
            normalizeApplicationParameters([
                {
                    Name: "password",
                    ParameterType: "Password",
                    Value: "secret",
                },
            ]),
        ).toThrow(CycleCloudRequestError);
    });

    test.each(["", null, undefined])(
        "treats empty or missing optional text as absent: %j",
        (value) => {
            expect(
                normalizeContextCluster(
                    [
                        {
                            ClusterName: "demo",
                            ParentName: value,
                            State: value,
                            TargetState: value,
                        },
                    ],
                    "demo",
                ),
            ).toMatchObject({
                name: "demo",
                parentName: undefined,
                state: undefined,
                targetState: undefined,
            });
            expect(
                details(
                    [
                        {
                            Name: "hpc",
                            IsArray: true,
                            State: value,
                            SlurmRole: value,
                            SlurmVersion: "23.11",
                        },
                    ],
                    "environment",
                )[0],
            ).toMatchObject({
                name: "hpc",
                state: undefined,
                scheduler: { role: undefined, version: "23.11" },
            });
            expect(
                normalizeApplicationParameters([
                    {
                        Name: "Specs",
                        ParameterType: "Cloud.ClusterInitSpecs",
                        Label: value,
                        Value: {},
                    },
                ])[0],
            ).toMatchObject({
                name: "Specs",
                label: undefined,
                specs: { available: true, total: 0 },
            });
        },
    );

    test.each([42, String.fromCharCode(0), "\ud800", "x".repeat(257)])(
        "still rejects malformed optional text: %j",
        (state) => {
            expect(() =>
                normalizeContextCluster(
                    [{ ClusterName: "demo", State: state }],
                    "demo",
                ),
            ).toThrow(CycleCloudRequestError);
        },
    );

    test("still rejects empty required parameter names", () => {
        expect(() =>
            normalizeApplicationParameters([
                {
                    Name: "",
                    ParameterType: "Cloud.ClusterInitSpecs",
                    Label: "",
                    Value: {},
                },
            ]),
        ).toThrow(CycleCloudRequestError);
    });

    test("returns independent values and never changes input records", () => {
        const raw = applicationNodes();
        const before = JSON.stringify(raw);
        const first = details(raw, "attachments");
        const target = first[0];
        const scheduler = first[1];
        if (
            target === undefined ||
            scheduler === undefined ||
            !("specs" in scheduler) ||
            !scheduler.specs.available ||
            scheduler.specs.items[0] === undefined
        )
            throw new Error("Expected complete fixture");
        target.name = "changed";
        scheduler.specs.items[0].project = "changed";
        expect(JSON.stringify(raw)).toBe(before);
        expect(details(raw, "attachments")[0]?.name).toBe("hpc");
    });

    test("verifies exact cluster identity without exposing other fields", () => {
        expect(
            normalizeContextCluster(
                [
                    {
                        ClusterName: "demo",
                        ParentName: "root",
                        Password: "secret",
                    },
                ],
                "demo",
            ),
        ).toEqual({ name: "demo", parentName: "root" });
        expect(() => normalizeContextCluster([], "demo")).toThrow(
            CycleCloudRequestError,
        );
        expect(() =>
            normalizeContextCluster([{ ClusterName: "other" }], "demo"),
        ).toThrow(CycleCloudRequestError);
    });
});

describe("Application context orchestration", () => {
    const detailInput = {
        ...input,
        view: "details" as const,
        section: "attachments" as const,
        targetNames: ["scheduler"],
    };
    test("returns overview evidence and identifies missing requested targets", async () => {
        const client = clientFixture();
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(
            { ...input, targetNames: ["scheduler", "missing"] },
            signal,
        );
        expect(result.context).toMatchObject({
            clusterName: "demo",
            evidence: "configured",
            targets: {
                available: true,
                total: 1,
                returned: 1,
                missingRequested: ["missing"],
            },
        });
        expect(result.context.observedAt).toMatch(/^\d{4}-/);
        expect(result.context.attachmentParameters).toBeUndefined();
        expect(result.context.unverified).toContain(
            "Installed application software, compiler, MPI and node-local libraries.",
        );
        expect(client.calls.start + client.calls.terminate).toBe(0);
    });

    test("applies target bounds without claiming exhaustive results", async () => {
        const result = await new CycleCloudTools(
            clientFixture(),
        ).getClusterApplicationContext({ ...input, targetLimit: 1 }, signal);
        expect(result.context.targets).toMatchObject({
            total: 3,
            returned: 1,
            truncated: true,
        });
    });

    test("keeps identity and explicit unavailable evidence when node queries fail", async () => {
        const client = clientFixture();
        vi.spyOn(client, "getApplicationNodes").mockRejectedValue(
            new CycleCloudRequestError("permission_denied", false),
        );
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(detailInput, signal);
        expect(result.context.targets).toMatchObject({ available: false });
        expect(result.context.attachmentParameters).toBeUndefined();
        expect(client.calls.applicationParameters).toBe(0);
    });

    test("keeps node context when parameter metadata is unavailable", async () => {
        const client = clientFixture();
        vi.spyOn(client, "getApplicationParameters").mockRejectedValue(
            new CycleCloudRequestError("invalid_response", false),
        );
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(detailInput, signal);
        expect(result.context.targets).toMatchObject({ available: true });
        expect(result.context.attachmentParameters).toMatchObject({
            available: false,
        });
    });

    test("resolves and checks parent cluster identity before reading root parameters", async () => {
        const client = clientFixture();
        vi.spyOn(client, "getCluster")
            .mockResolvedValueOnce([
                { ClusterName: "demo", ParentName: "root" },
            ])
            .mockResolvedValueOnce([{ ClusterName: "root" }]);
        const metadata = vi.spyOn(client, "getApplicationParameters");
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(detailInput, signal);
        expect(metadata).toHaveBeenCalledWith(
            "root",
            { signal },
            "SchedulerClusterInitSpecs",
        );
        expect(result.context.attachmentParameters).toMatchObject({
            available: true,
            clusterName: "root",
        });
    });

    test("does not follow cyclic parent references or hide cancellation", async () => {
        const client = clientFixture();
        client.clusterResult = [{ ClusterName: "demo", ParentName: "demo" }];
        expect(
            (
                await new CycleCloudTools(client).getClusterApplicationContext(
                    detailInput,
                    signal,
                )
            ).context.attachmentParameters,
        ).toMatchObject({ available: false });
        expect(client.calls.applicationParameters).toBe(0);
        const controller = new AbortController();
        vi.spyOn(client, "getApplicationNodes").mockImplementation(() => {
            controller.abort();
            return Promise.reject(new Error("cancelled"));
        });
        await expect(
            new CycleCloudTools(client).getClusterApplicationContext(
                input,
                controller.signal,
            ),
        ).rejects.toMatchObject({ category: "cancelled" });
    });

    test("does not query context for a nonexistent cluster", async () => {
        const client = clientFixture();
        client.clusterResult = [];
        await expect(
            new CycleCloudTools(client).getClusterApplicationContext(
                input,
                signal,
            ),
        ).rejects.toMatchObject({ category: "cluster_not_found" });
        expect(client.calls.applicationNodes).toBe(0);
    });
});
