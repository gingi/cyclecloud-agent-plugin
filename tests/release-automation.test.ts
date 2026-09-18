import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "0123456789abcdef0123456789abcdef01234567";
const base = "repos/example/plugin";
let workspace: string;

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "release publication "));
    await writeFile(
        join(workspace, "CHANGELOG.md"),
        "## [0.1.0]\n\nStable notes.\n\n## [0.2.0-rc.1]\n\nPreview notes.\n",
    );
});
afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
});

interface GitHubCall {
    args: string[];
    input?: string;
}

async function publish(
    state: {
        commit?: string;
        releases?: { tag_name: string; draft: boolean }[];
        fail?: string;
    } = {},
    tag = "v0.1.0",
    sha = commit,
) {
    const bin = join(workspace, "commands");
    const assets = join(workspace, "assets");
    await mkdir(bin);
    await mkdir(assets);
    for (const name of [
        `cyclecloud-mcp-${tag.slice(1)}.tar.gz`,
        "install.sh",
        "SHA256SUMS",
    ])
        await writeFile(join(assets, name), "Verified asset");
    const calls = join(workspace, "calls.jsonl");
    const statePath = join(workspace, "state.json");
    await writeFile(statePath, JSON.stringify({ commit, ...state }));
    await writeFile(
        join(bin, "gh"),
        `#!/bin/sh\nexec '${process.execPath}' '${join(root, "tests/helpers/fake-release-github.mjs")}' "$@"\n`,
        { mode: 0o700 },
    );
    const result = spawnSync(
        process.execPath,
        [join(root, "scripts/publish-release.mjs"), tag, sha, assets],
        {
            cwd: workspace,
            env: {
                ...process.env,
                PATH: bin,
                GH_REPO: "example/plugin",
                FAKE_RELEASE_STATE: statePath,
                FAKE_RELEASE_CALLS: calls,
            },
            encoding: "utf8",
            timeout: 10_000,
        },
    );
    return {
        result,
        calls: (await readFile(calls, "utf8").catch(() => ""))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as GitHubCall),
        assets,
    };
}

describe("Release publication", () => {
    test("Delegates draft staging and publication of all assets to GitHub CLI", async () => {
        const { result, calls, assets } = await publish();
        expect(result.status, result.stderr).toBe(0);
        expect(calls[0]?.args).toEqual([
            "api",
            `${base}/commits/refs%2Ftags%2Fv0.1.0`,
        ]);
        const writes = calls.filter((call) => call.args[0] === "release");
        expect(writes).toHaveLength(1);
        expect(writes[0]?.args).toEqual([
            "release",
            "create",
            "v0.1.0",
            join(assets, "cyclecloud-mcp-0.1.0.tar.gz"),
            join(assets, "install.sh"),
            join(assets, "SHA256SUMS"),
            "--verify-tag",
            "--title",
            "v0.1.0",
            "--notes-file",
            "-",
        ]);
        expect(writes[0]?.input).toBe("Stable notes.\n");
    });

    test("Keeps prereleases out of latest at creation and publication", async () => {
        const { result, calls } = await publish({}, "v0.2.0-rc.1");
        expect(result.status, result.stderr).toBe(0);
        const writes = calls.filter((call) => call.args[0] === "release");
        expect(writes[0]?.args).toContain("--prerelease");
        expect(writes[0]?.input).toBe("Preview notes.\n");
        for (const call of writes)
            expect(call.args).toContain("--latest=false");
    });

    test.each([false, true])(
        "Refuses an existing release (draft=%s)",
        async (draft) => {
            const { result, calls } = await publish({
                releases: [{ tag_name: "v0.1.0", draft }],
            });
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("already exists");
            expect(calls.every((call) => call.args[0] === "api")).toBe(true);
        },
    );

    test("Does not confuse another version with an existing release", async () => {
        const { result } = await publish({
            releases: [{ tag_name: "v0.0.1", draft: false }],
        });
        expect(result.status, result.stderr).toBe(0);
    });

    test("Refuses a tag moved away from the built commit", async () => {
        const { result, calls } = await publish({ commit: "f".repeat(40) });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("different commit");
        expect(calls).toHaveLength(1);
    });

    test.each([
        `${base}/commits/refs%2Ftags%2Fv0.1.0`,
        `${base}/releases?per_page=100`,
    ])("Stops on missing tags or API failures: %s", async (fail) => {
        const { result, calls } = await publish({ fail });
        expect(result.status).not.toBe(0);
        expect(calls.every((call) => call.args[0] === "api")).toBe(true);
    });

    test("Reports CLI failure without attempting recovery writes", async () => {
        const { result, calls } = await publish({ fail: "create" });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Simulated GitHub failure");
        expect(calls.filter((call) => call.args[0] === "release")).toHaveLength(
            1,
        );
        expect(calls.at(-1)?.args).toContain("create");
    });

    test("Requires release notes before making any writes", async () => {
        await writeFile(join(workspace, "CHANGELOG.md"), "# Changelog\n");
        const { result, calls } = await publish();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("CHANGELOG.md");
        expect(calls.every((call) => call.args[0] === "api")).toBe(true);
    });

    test.each([
        ["invalid", commit],
        ["v0.1.0", "main"],
    ])(
        "Rejects invalid identity before calling GitHub: %s %s",
        async (tag, sha) => {
            const { result, calls } = await publish({}, tag, sha);
            expect(result.status).not.toBe(0);
            expect(calls).toEqual([]);
        },
    );
});
