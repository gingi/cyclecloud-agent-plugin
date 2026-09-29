import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = new URL("../", import.meta.url);
const inspection = new URL("skills/inspect-cyclecloud/SKILL.md", root);

describe("CLI inspection guidance", () => {
    test("uses the installed-relative launcher and explicit schema", async () => {
        const text = await readFile(inspection, "utf8").catch(() => "");
        expect(text).toContain("name: inspect-cyclecloud");
        expect(text).toContain("scripts/cyclecloud-inspect");
        expect(text).toContain("capabilities");
        expect(text).toContain("--schema-version 1");
        expect(text).toContain("installed");
        expect(text).toContain("nextOffset");
    });

    test("keeps dependency setup opt-in and distinct from authentication", async () => {
        const text = await readFile(inspection, "utf8").catch(() => "");
        expect(text).toContain("CYCLECLOUD_CLI");
        expect(text).toContain("PATH");
        expect(text).toContain("Do not download or install automatically");
        expect(text).toContain("cyclecloud initialize");
        expect(text).toContain("authentication");
        expect(text).toContain("Never ask for passwords");
        expect(text).toContain("permission");
    });

    test("preserves CLI identity when explaining compatibility failures", async () => {
        const text = await readFile(inspection, "utf8").catch(() => "");
        expect(text).toContain("include the resolved CLI executable path");
        expect(text).toContain("reported version");
        expect(text).toContain("do not guess a missing version");
    });

    test("does not turn diagnostic text or native failures into alternate execution", async () => {
        const text = await readFile(inspection, "utf8").catch(() => "");
        expect(text).toContain("untrusted data");
        expect(text).toContain("Do not bypass");
        expect(text).toContain("raw");
        expect(text).toContain("separate approval");
        expect(text).toContain("cyclecloud *");
    });

    test("treats installation prefixes as remote data rather than local paths", async () => {
        const text = await readFile(inspection, "utf8");
        expect(text).toContain("cluster nodes, not a local project directory");
        expect(text).toContain(
            "Omit `--install-path` for the default `/shared/apps`",
        );
        expect(text).toContain("non-default prefix");
        expect(text).toContain(
            "every overview, detail, and pagination request",
        );
        expect(text).toContain(
            "Do not inspect or create the cluster prefix locally",
        );
        expect(text).toContain("do not broaden host filesystem permissions");
    });

    test("Distinguishes configured definitions from runtime groups and discovery targets", async () => {
        const text = await readFile(inspection, "utf8");
        expect(text).toContain("nodeArrayDefinitions.total");
        expect(text).toContain("available` is `true");
        expect(text).toContain("absent or unavailable means unknown, not zero");
        expect(text).toContain("instantiated-node groups");
        expect(text).toContain("Never substitute");
        expect(text).toContain("targets.total");
        expect(text).toContain("capacity, not configured-definition counts");
        expect(text).toContain("independently");
        expect(text).toContain("not a reason to change backends");
    });

    test("discovers concrete nodes before selectively collecting diagnostics", async () => {
        const text = await readFile(inspection, "utf8");
        for (const term of [
            "inspectionContracts",
            "unsupported_command",
            "--problems-only",
            "node-diagnostics",
            "cluster-events",
            "nextAfterNodeId",
            "--after-node-id",
            "condition-only",
            "not proof",
            "cluster-wide",
        ])
            expect(text).toContain(term);
        expect(text).toContain("Do not automatically diagnose every node");
        expect(text).toContain(
            "Application overview is not concrete-node discovery",
        );
    });

    test("keeps connectivity advice conditional on the server network path", async () => {
        const text = await readFile(inspection, "utf8");
        for (const term of [
            "from the CycleCloud server",
            "not necessarily from the CLI host",
            "If that server's route depends on a VPN",
            "user-confirmed context",
            "does not rule out orchestration defects",
            "require separate approval",
        ])
            expect(text).toContain(term);
    });

    test("links only existing installed-relative reference files", async () => {
        const text = await readFile(inspection, "utf8").catch(() => "");
        expect(text).toContain("../../docs/cli-contract.md");
        expect(text).toContain("../../docs/configuration.md");
        for (const relative of [
            "../../docs/cli-contract.md",
            "../../docs/configuration.md",
            "../../docs/node-diagnostics.md",
        ]) {
            const reference = new URL(relative, inspection);
            expect(fileURLToPath(reference)).toContain("/docs/");
            await expect(readFile(reference, "utf8")).resolves.toBeTruthy();
        }
    });
});
