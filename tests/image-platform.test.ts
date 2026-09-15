import { describe, expect, test, vi } from "vitest";
import { normalizeImagePlatform } from "../src/image-platform.js";
import { CycleCloudRequestError } from "../src/errors.js";
import { CycleCloudTools } from "../src/tools.js";
import { FakeCycleCloudClient } from "./helpers/fake-client.js";
import { applicationNodes } from "./helpers/application-context.js";

const image = "cycle.image.ubuntu22";
const record = {
    Name: image,
    PackageType: "image",
    Label: "Ubuntu 22.04 LTS",
    OS: "linux",
    JetpackPlatform: "ubuntu-22.04",
    Version: "8.9.3",
    Secret: "SECRET_IMAGE",
    Description: "SECRET_DESCRIPTION",
};
const input = {
    clusterName: "demo",
    view: "details" as const,
    section: "environment" as const,
    targetNames: ["scheduler"],
    installPath: "/shared/apps",
    targetLimit: 10,
};
const signal = new AbortController().signal;
function fixture() {
    const client = new FakeCycleCloudClient();
    client.clusterResult = [{ ClusterName: "demo" }];
    client.applicationNodesResult = applicationNodes();
    client.imageMetadataResult = [record];
    return client;
}

describe("Configured image platform", () => {
    test("resolves Ubuntu from declared metadata, not an image-name heuristic", () => {
        const result = normalizeImagePlatform(
            [{ ...record, Name: "custom-image" }],
            "custom-image",
        );
        expect(result).toMatchObject({
            available: true,
            source: "CycleCloud Package metadata",
            os: "linux",
            jetpackPlatform: "ubuntu-22.04",
            distribution: "ubuntu",
            release: "22.04",
            label: "Ubuntu 22.04 LTS",
            runtimeVerified: false,
            matchingRecords: 1,
        });
        expect(JSON.stringify(result)).not.toContain("SECRET_");
        expect(result).not.toHaveProperty("version");
    });

    test.each(["", null, undefined])(
        "resolves platform metadata without an optional label: %j",
        (label) => {
            const result = normalizeImagePlatform(
                [{ ...record, Label: label }],
                image,
            );
            expect(result).toMatchObject({
                available: true,
                os: "linux",
                distribution: "ubuntu",
                release: "22.04",
            });
            expect(result).not.toHaveProperty("label");
        },
    );

    test.each(["OS", "JetpackPlatform"])(
        "keeps an empty %s unresolved",
        (field) => {
            const result = normalizeImagePlatform(
                [{ ...record, [field]: "" }],
                image,
            );
            expect(result).toMatchObject({ available: false });
            expect(result).not.toHaveProperty("release");
        },
    );

    test("accepts consistent platform metadata across package revisions without selecting a revision", () => {
        const result = normalizeImagePlatform(
            [
                record,
                {
                    ...record,
                    Version: "8.8.0",
                    Label: "Different display label",
                },
            ],
            image,
        );
        expect(result).toMatchObject({
            available: true,
            release: "22.04",
            matchingRecords: 2,
        });
        expect(result).not.toHaveProperty("label");
        expect(result).not.toHaveProperty("packageVersion");
    });

    test("leaves conflicting or incomplete platform metadata unresolved", () => {
        expect(
            normalizeImagePlatform(
                [record, { ...record, JetpackPlatform: "ubuntu-24.04" }],
                image,
            ),
        ).toMatchObject({ available: false });
        expect(
            normalizeImagePlatform(
                [{ Name: image, PackageType: "image", Label: "Ubuntu 22.04" }],
                image,
            ),
        ).toMatchObject({ available: false });
        expect(
            normalizeImagePlatform([record, { ...record, OS: null }], image),
        ).toMatchObject({ available: false });
    });

    test("does not infer releases from aliases, labels or unknown platform names", () => {
        expect(normalizeImagePlatform([], image)).toMatchObject({
            available: false,
        });
        const result = normalizeImagePlatform(
            [{ ...record, JetpackPlatform: "custom-linux" }],
            image,
        );
        expect(result).toMatchObject({
            available: true,
            jetpackPlatform: "custom-linux",
        });
        expect(result).not.toHaveProperty("release");
        expect(result).not.toHaveProperty("distribution");
    });

    test.each([
        { ...record, Name: "other" },
        { ...record, Name: "" },
        { ...record, PackageType: "" },
        { ...record, PackageType: "application" },
        { ...record, Label: 42 },
        { ...record, Label: String.fromCharCode(0) },
        { ...record, Label: String.fromCharCode(0xd800) },
        { ...record, OS: 42 },
        { ...record, OS: "linux", os: "windows" },
        { ...record, JetpackPlatform: "x".repeat(129) },
        { ...record, Label: "x".repeat(257) },
    ])("rejects mismatched or malformed consumed metadata: %j", (raw) => {
        expect(() => normalizeImagePlatform([raw], image)).toThrow(
            CycleCloudRequestError,
        );
    });

    test("does not expose or mutate raw metadata", () => {
        const raw = [{ ...record }];
        const before = JSON.stringify(raw);
        const result = normalizeImagePlatform(raw, image);
        if (!result.available) throw new Error("Expected platform");
        result.release = "changed";
        expect(JSON.stringify(raw)).toBe(before);
        expect(normalizeImagePlatform(raw, image)).toMatchObject({
            release: "22.04",
        });
    });
});

describe("Environment version discovery", () => {
    test("returns platform evidence alongside the configured Slurm software version", async () => {
        const client = fixture();
        const lookup = vi.spyOn(client, "getImageMetadata");
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(input, signal);
        expect(lookup).toHaveBeenCalledWith(image, { signal });
        expect(result.context.targets).toMatchObject({
            available: true,
            items: [
                {
                    image,
                    scheduler: { version: "23.11" },
                    platform: {
                        available: true,
                        release: "22.04",
                        runtimeVerified: false,
                    },
                },
            ],
        });
        expect(result.context.sources).toContain(
            "CycleCloud Package image metadata",
        );
        expect(JSON.stringify(result)).not.toContain("SECRET_");
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
            8 * 1024,
        );
    });

    test.each(["overview", "storage", "attachments"] as const)(
        "does not add image lookups to %s",
        async (mode) => {
            const client = fixture();
            const request =
                mode === "overview"
                    ? {
                          clusterName: "demo",
                          installPath: "/shared/apps",
                          targetLimit: 10,
                      }
                    : { ...input, section: mode };
            await new CycleCloudTools(client).getClusterApplicationContext(
                request,
                signal,
            );
            expect(client.calls.imageMetadata).toBe(0);
        },
    );

    test("keeps unknown/custom image platforms unresolved without losing Slurm or image evidence", async () => {
        const client = fixture();
        client.imageMetadataResult = [];
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(input, signal);
        expect(result.context.targets).toMatchObject({
            available: true,
            items: [
                {
                    image,
                    scheduler: { version: "23.11" },
                    platform: { available: false },
                },
            ],
        });
    });

    test("preserves environment details when metadata access fails", async () => {
        const client = fixture();
        vi.spyOn(client, "getImageMetadata").mockRejectedValue(
            new CycleCloudRequestError("permission_denied", false),
        );
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(input, signal);
        expect(result.context.targets).toMatchObject({
            available: true,
            items: [{ platform: { available: false }, image }],
        });
    });

    test("does not query metadata without an image reference", async () => {
        const client = fixture();
        client.applicationNodesResult = [
            { Name: "scheduler", Template: "scheduler", SlurmVersion: "23.11" },
        ];
        const result = await new CycleCloudTools(
            client,
        ).getClusterApplicationContext(input, signal);
        expect(result.context.targets).toMatchObject({
            available: true,
            items: [
                {
                    platform: { available: false },
                    scheduler: { version: "23.11" },
                },
            ],
        });
        expect(client.calls.imageMetadata).toBe(0);
    });

    test("propagates cancellation during metadata retrieval", async () => {
        const client = fixture();
        const controller = new AbortController();
        vi.spyOn(client, "getImageMetadata").mockImplementation(() => {
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
});
