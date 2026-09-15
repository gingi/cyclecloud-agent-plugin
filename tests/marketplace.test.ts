import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { z } from "zod";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pluginManifestSchema = z.object({
    name: z.string(),
    version: z.string(),
    description: z.string(),
});
const marketplaceSchema = z
    .object({
        name: z.literal("cyclecloud-mcp"),
        owner: z.object({ name: z.string().min(1) }).strict(),
        metadata: z
            .object({
                description: z.string().min(1),
                version: z.string(),
            })
            .strict(),
        plugins: z
            .array(
                z
                    .object({
                        name: z.string(),
                        description: z.string(),
                        version: z.string(),
                        repository: z.string().url(),
                        source: z.literal("./"),
                    })
                    .strict(),
            )
            .length(1),
    })
    .strict();

async function readJson(path: string): Promise<unknown> {
    return JSON.parse(await readFile(path, "utf8"));
}

describe("Copilot CLI marketplace", () => {
    test("publishes the root Agent Plugin with matching metadata", async () => {
        const plugin = pluginManifestSchema.parse(
            await readJson(resolve(repositoryRoot, "plugin.json")),
        );
        const marketplace = marketplaceSchema.parse(
            await readJson(
                resolve(repositoryRoot, ".github/plugin/marketplace.json"),
            ),
        );

        expect(marketplace.metadata.version).toBe(plugin.version);
        expect(marketplace.plugins[0]).toMatchObject({
            name: plugin.name,
            description: plugin.description,
            version: plugin.version,
            repository: "https://github.com/gingi/cyclecloud-mcp",
        });
    });

    test("development artifacts retain the complete marketplace and source identity", async () => {
        const workflow = await readFile(
            resolve(repositoryRoot, ".github/workflows/development.yml"),
            "utf8",
        );

        expect(workflow).toContain("push:");
        expect(workflow).toContain("pull_request:");
        expect(workflow).toContain("workflow_dispatch:");
        expect(workflow).toContain(
            "SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}",
        );
        expect(workflow).toContain("dist/cyclecloud-mcp/SOURCE_COMMIT.json");
        expect(workflow).toContain("npm run verify:package");
        expect(workflow).toContain("include-hidden-files: true");
    });
});
