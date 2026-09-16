import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setFixtureVersion } from "./helpers/release.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/package-release.mjs");
const commit = "0123456789abcdef0123456789abcdef01234567";
let workspace: string;

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "cyclecloud release "));
    for (const file of [
        "package.json",
        "package-lock.json",
        "plugin.json",
        ".github/plugin/marketplace.json",
    ]) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await cp(join(root, file), join(workspace, file));
    }
    await setFixtureVersion(workspace, "0.1.0");
});

afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
});

function run(...args: string[]) {
    return spawnSync(process.execPath, [script, ...args], {
        cwd: workspace,
        env: {
            ...process.env,
            GITHUB_SHA: "f".repeat(40),
            RELEASE_SOURCE_COMMIT: commit,
            GITHUB_REPOSITORY: "gingi/cyclecloud-mcp",
        },
        encoding: "utf8",
        timeout: 15_000,
    });
}

describe("Release packaging", () => {
    test.each([
        "main",
        "0.1.0",
        "v0.1.1",
        "v01.1.0",
        "v0.1.0/other",
        "v0.1.0-01",
    ])("Rejects an invalid or mismatched tag: %s", (tag) => {
        const result = run(tag);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/tag|version/i);
    });

    test.each([
        "plugin.json",
        ".github/plugin/marketplace.json",
        "package-lock.json",
    ])("Rejects version drift in %s", async (file) => {
        const path = join(workspace, file);
        await writeFile(
            path,
            (await readFile(path, "utf8")).replaceAll('"0.1.0"', '"0.2.0"'),
        );
        const result = run("v0.1.0");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("version");
    });

    test("Produces a checksummed archive that installs after extraction", async () => {
        const packageDirectory = join(workspace, "dist/cyclecloud-mcp");
        for (const file of [
            "plugin.json",
            "bin/cyclecloud-mcp.mjs",
            "cyclecloud.example.json",
            "LICENSE",
            "install.sh",
            ".github/plugin/marketplace.json",
            "skills",
        ]) {
            await mkdir(dirname(join(packageDirectory, file)), {
                recursive: true,
            });
            const source =
                file === "plugin.json" ||
                file === ".github/plugin/marketplace.json"
                    ? workspace
                    : root;
            await cp(join(source, file), join(packageDirectory, file), {
                recursive: true,
            });
        }
        const result = run("v0.1.0");
        expect(result.status, result.stderr).toBe(0);
        const assets = join(workspace, "dist/releases");
        const name = "cyclecloud-mcp-0.1.0.tar.gz";
        const archive = await readFile(join(assets, name));
        const bootstrap = await readFile(join(assets, "install.sh"), "utf8");
        expect(bootstrap).toContain(
            "https://github.com/gingi/cyclecloud-mcp/releases/download/v0.1.0",
        );
        expect(bootstrap).not.toContain("@RELEASE_BASE_URL@");
        const checksums = await readFile(join(assets, "SHA256SUMS"), "utf8");
        expect(checksums).toContain(
            `${createHash("sha256").update(archive).digest("hex")}  ${name}\n`,
        );
        expect(checksums).toContain(
            `${createHash("sha256").update(bootstrap).digest("hex")}  install.sh\n`,
        );
        const extracted = join(workspace, "extracted");
        await mkdir(extracted);
        const unpack = spawnSync(
            "tar",
            ["-xzf", join(assets, name), "-C", extracted],
            { encoding: "utf8" },
        );
        expect(unpack.status, unpack.stderr).toBe(0);
        const metadata = JSON.parse(
            await readFile(
                join(extracted, "cyclecloud-mcp/SOURCE_COMMIT.json"),
                "utf8",
            ),
        ) as Record<string, unknown>;
        expect(metadata).toMatchObject({
            sourceCommit: commit,
            checkoutCommit: commit,
            sourceRef: "v0.1.0",
            version: "0.1.0",
        });
        await rm(packageDirectory, { recursive: true });
        const verify = spawnSync(
            process.execPath,
            [
                join(root, "scripts/verify-package.mjs"),
                join(extracted, "cyclecloud-mcp"),
            ],
            { encoding: "utf8", timeout: 30_000 },
        );
        expect(verify.status, verify.stderr).toBe(0);
    }, 30_000);
});
