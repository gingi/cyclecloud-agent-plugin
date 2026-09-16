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
    workspace = await mkdtemp(join(tmpdir(), "release tag "));
});
afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
});

interface GitHubCall {
    method: string;
    route: string;
    body?: { ref: string; sha: string };
}

async function tag(
    state: { existing?: boolean; target?: string; fail?: boolean },
    args = ["v0.1.0", commit],
) {
    const bin = join(workspace, "commands");
    await mkdir(bin);
    const calls = join(workspace, "calls.jsonl");
    const statePath = join(workspace, "state.json");
    await writeFile(
        statePath,
        JSON.stringify({
            tags: state.existing ? [{ ref: "refs/tags/v0.1.0" }] : [],
            tagCommit: state.target,
            failRoute: state.fail
                ? `${base}/git/matching-refs/tags/v0.1.0`
                : undefined,
        }),
    );
    await writeFile(
        join(bin, "gh"),
        `#!/bin/sh\nexec '${process.execPath}' '${join(root, "tests/helpers/fake-release-github.mjs")}' "$@"\n`,
        { mode: 0o700 },
    );
    const result = spawnSync(
        process.execPath,
        [join(root, "scripts/tag-release.mjs"), ...args],
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
    };
}

describe("Release tag creation", () => {
    test("Creates a new tag at the verified commit", async () => {
        const value = await tag({});
        expect(value.result.status, value.result.stderr).toBe(0);
        expect(value.calls).toContainEqual({
            method: "POST",
            route: `${base}/git/refs`,
            body: { ref: "refs/tags/v0.1.0", sha: commit },
        });
    });
    test("Reuses an existing tag only when its peeled commit matches", async () => {
        const value = await tag({ existing: true, target: commit });
        expect(value.result.status, value.result.stderr).toBe(0);
        expect(value.calls).toContainEqual({
            method: "GET",
            route: `${base}/commits/refs%2Ftags%2Fv0.1.0`,
        });
        expect(value.calls.some((call) => call.method === "POST")).toBe(false);
    });
    test("Refuses to move an existing tag", async () => {
        const value = await tag({ existing: true, target: "f".repeat(40) });
        expect(value.result.status).not.toBe(0);
        expect(value.result.stderr).toContain("different commit");
        expect(value.calls.some((call) => call.method === "POST")).toBe(false);
    });
    test("Stops on API failure instead of assuming the tag is absent", async () => {
        const value = await tag({ fail: true });
        expect(value.result.status).not.toBe(0);
        expect(value.calls).toHaveLength(1);
    });
    test("Rejects an unverified commit before calling GitHub", async () => {
        const value = await tag({}, ["v0.1.0", "main"]);
        expect(value.result.status).not.toBe(0);
        expect(value.calls).toEqual([]);
    });
});
