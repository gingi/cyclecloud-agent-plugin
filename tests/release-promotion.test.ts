import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "a".repeat(40);
const main = "b".repeat(40);
const previous = "c".repeat(40);
const base = "repos/example/plugin";
const lookup = `${base}/git/matching-refs/heads/stable`;
let workspace: string;

function stableRef(sha = previous, ref = "refs/heads/stable") {
    return { ref, object: { type: "commit", sha } };
}

interface GitHubCall {
    args: string[];
    input?: string;
}

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "release promotion "));
    const bin = join(workspace, "commands");
    await mkdir(bin);
    await writeFile(
        join(bin, "gh"),
        `#!/bin/sh\nexec '${process.execPath}' '${join(root, "tests/helpers/fake-release-github.mjs")}' "$@"\n`,
        { mode: 0o700 },
    );
    await writeFile(
        join(workspace, "state.json"),
        JSON.stringify({
            commit,
            main,
            release: {
                tag_name: "v0.3.0",
                draft: false,
                prerelease: false,
                published_at: "2026-09-23T00:00:00Z",
            },
            mainComparison: { status: "ahead" },
            stableComparison: { status: "ahead" },
            stableRefs: [],
        }),
    );
});

afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
});

async function promote(
    overrides: Record<string, unknown> = {},
    args = ["v0.3.0", commit],
) {
    const statePath = join(workspace, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<
        string,
        unknown
    >;
    await writeFile(statePath, JSON.stringify({ ...state, ...overrides }));
    const callsPath = join(workspace, "calls.jsonl");
    await writeFile(callsPath, "");
    const result = spawnSync(
        process.execPath,
        [join(root, "scripts/promote-stable.mjs"), ...args],
        {
            cwd: workspace,
            env: {
                ...process.env,
                PATH: join(workspace, "commands"),
                GH_REPO: "example/plugin",
                FAKE_RELEASE_STATE: statePath,
                FAKE_RELEASE_CALLS: callsPath,
            },
            encoding: "utf8",
            timeout: 10_000,
        },
    );
    const calls: GitHubCall[] = (await readFile(callsPath, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as GitHubCall);
    const writes = calls.filter((call) => call.args.includes("--method"));
    return { result, calls, writes };
}

async function expectRejected(
    overrides: Record<string, unknown>,
    message: string,
) {
    const { result, writes } = await promote(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(writes).toEqual([]);
}

describe("Stable release promotion", () => {
    test("Creates stable at the exact published tag commit after checking main", async () => {
        const { result, calls, writes } = await promote();
        expect(result.status, result.stderr).toBe(0);
        expect(calls.slice(0, 5).map((call) => call.args)).toEqual([
            [
                "api",
                `${base}/commits/refs%2Ftags%2Fv0.3.0`,
                "--jq",
                "{sha: .sha}",
            ],
            ["api", `${base}/releases/tags/v0.3.0`],
            [
                "api",
                `${base}/commits/refs%2Fheads%2Fmain`,
                "--jq",
                "{sha: .sha}",
            ],
            [
                "api",
                `${base}/compare/${commit}...${main}`,
                "--jq",
                "{status: .status}",
            ],
            ["api", lookup],
        ]);
        expect(writes).toHaveLength(1);
        expect(writes[0]?.args).toEqual([
            "api",
            `${base}/git/refs`,
            "--method",
            "POST",
            "--input",
            "-",
        ]);
        expect(JSON.parse(writes[0]?.input ?? "null")).toEqual({
            ref: "refs/heads/stable",
            sha: commit,
        });
    });

    test("Fast-forwards stable with typed force:false sent through stdin", async () => {
        const { result, calls, writes } = await promote({
            stableRefs: [stableRef()],
        });
        expect(result.status, result.stderr).toBe(0);
        expect(
            calls.some(
                (call) =>
                    call.args[1] === `${base}/compare/${previous}...${commit}`,
            ),
        ).toBe(true);
        expect(writes).toHaveLength(1);
        expect(writes[0]?.args).toEqual([
            "api",
            `${base}/git/refs/heads/stable`,
            "--method",
            "PATCH",
            "--input",
            "-",
        ]);
        expect(JSON.parse(writes[0]?.input ?? "null")).toEqual({
            sha: commit,
            force: false,
        });
    });

    test("Does nothing when stable already equals the release", async () => {
        const { result, calls, writes } = await promote({
            stableRefs: [stableRef(commit)],
        });
        expect(result.status, result.stderr).toBe(0);
        expect(writes).toEqual([]);
        expect(
            calls.filter((call) => call.args[1]?.includes("/compare/")),
        ).toHaveLength(1);
    });

    test.each(["behind", "identical"])(
        "Does not roll back stable when comparison is %s",
        async (status) => {
            const { result, writes } = await promote({
                stableRefs: [stableRef()],
                stableComparison: { status },
            });
            expect(result.status, result.stderr).toBe(0);
            expect(writes).toEqual([]);
        },
    );

    test.each(["diverged", "unknown", undefined])(
        "Fails closed on stable comparison %s",
        async (status) => {
            await expectRejected(
                { stableRefs: [stableRef()], stableComparison: { status } },
                "fast-forward",
            );
        },
    );

    test.each(["behind", "diverged", "unknown", undefined])(
        "Rejects off-main or unknown main comparison %s",
        async (status) => {
            await expectRejected({ mainComparison: { status } }, "main");
        },
    );

    test("Accepts the main tip itself", async () => {
        const { result } = await promote({
            main: commit,
            mainComparison: { status: "identical" },
        });
        expect(result.status, result.stderr).toBe(0);
    });

    test.each([
        `${base}/commits/refs%2Ftags%2Fv0.3.0`,
        `${base}/commits/refs%2Fheads%2Fmain`,
        `${base}/compare/${commit}...${main}`,
        `${base}/compare/${previous}...${commit}`,
    ])(
        "Handles oversized commit/diff responses from %s",
        async (largeResponse) => {
            const { result, writes } = await promote({
                stableRefs: [stableRef()],
                largeResponse,
            });
            expect(result.status, result.stderr).toBe(0);
            expect(writes).toHaveLength(1);
        },
    );

    test("Uses top-level compare status even when the commit list is truncated", async () => {
        const commits = Array.from({ length: 250 }, () => ({
            sha: "d".repeat(40),
        }));
        const { result, writes } = await promote({
            stableRefs: [stableRef()],
            mainComparison: { status: "ahead", total_commits: 400, commits },
            stableComparison: { status: "ahead", total_commits: 400, commits },
        });
        expect(result.status, result.stderr).toBe(0);
        expect(writes).toHaveLength(1);
    });

    test.each([
        { args: [] },
        { args: ["v0.3.0"] },
        { args: ["v0.3.0", commit, "extra"] },
        { args: ["invalid", commit] },
        { args: ["v0.3.0-rc.1", commit] },
        { args: ["v0.3.0", "main"] },
        { args: ["v0.3.0", "abc123"] },
    ])("Rejects invalid arguments before API access: %j", async ({ args }) => {
        const { result, calls } = await promote({}, args);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/Usage|SemVer|prerelease|SHA/);
        expect(calls).toEqual([]);
    });

    test("Rejects a remote tag with a different peeled SHA", async () => {
        await expectRejected({ commit: previous }, "different commit");
    });

    test.each([
        {
            tag_name: "v0.2.0",
            draft: false,
            prerelease: false,
            published_at: "date",
        },
        {
            tag_name: "v0.3.0",
            draft: true,
            prerelease: false,
            published_at: "date",
        },
        {
            tag_name: "v0.3.0",
            draft: false,
            prerelease: true,
            published_at: "date",
        },
        {
            tag_name: "v0.3.0",
            draft: false,
            prerelease: false,
            published_at: null,
        },
        { tag_name: "v0.3.0", published_at: "date" },
        null,
    ])(
        "Rejects unpublished or invalid release metadata: %j",
        async (release) => {
            await expectRejected({ release }, "published stable release");
        },
    );

    test.each([
        `${base}/commits/refs%2Ftags%2Fv0.3.0`,
        `${base}/releases/tags/v0.3.0`,
        `${base}/commits/refs%2Fheads%2Fmain`,
        `${base}/compare/${commit}...${main}`,
        lookup,
        `${base}/compare/${previous}...${commit}`,
    ])("Does not treat an API failure as a missing ref: %s", async (fail) => {
        await expectRejected(
            { fail, stableRefs: [stableRef()] },
            "Simulated GitHub failure",
        );
    });

    test("Ignores stable-extra when stable is missing", async () => {
        const { result, writes } = await promote({
            stableRefs: [stableRef(previous, "refs/heads/stable-extra")],
        });
        expect(result.status, result.stderr).toBe(0);
        expect(writes[0]?.args).toContain("POST");
    });

    test("Selects exact stable among prefix matches", async () => {
        const { result, writes } = await promote({
            stableRefs: [
                stableRef(previous, "refs/heads/stable-extra"),
                stableRef(commit),
            ],
        });
        expect(result.status, result.stderr).toBe(0);
        expect(writes).toEqual([]);
    });

    test.each([
        { stableRefs: null },
        { stableRefs: {} },
        { stableRefs: [stableRef(), stableRef()] },
        {
            stableRefs: [
                {
                    ref: "refs/heads/stable",
                    object: { type: "tag", sha: previous },
                },
            ],
        },
        {
            stableRefs: [
                {
                    ref: "refs/heads/stable",
                    object: { type: "commit", sha: "short" },
                },
            ],
        },
        { stableRefs: [{ ref: "refs/heads/stable" }] },
    ])("Rejects malformed stable ref metadata: %j", async ({ stableRefs }) => {
        await expectRejected({ stableRefs }, "stable");
    });

    test("Rejects an invalid main snapshot SHA", async () => {
        await expectRejected({ main: "main" }, "SHA");
    });

    test.each(["POST", "PATCH"])(
        "Fails safely on %s failure and supports a successful retry",
        async (method) => {
            const first = await promote({
                fail: method,
                stableRefs: method === "POST" ? [] : [stableRef()],
            });
            expect(first.result.status).not.toBe(0);
            expect(first.writes).toHaveLength(1);
            const retry = await promote({ fail: null });
            expect(retry.result.status, retry.result.stderr).toBe(0);
            expect(retry.writes).toHaveLength(1);
            const again = await promote();
            expect(again.result.status, again.result.stderr).toBe(0);
            expect(again.writes).toEqual([]);
        },
    );

    test.each(["POST", "PATCH"])(
        "A concurrent %s change fails once and retry cannot roll back stable",
        async (method) => {
            const first = await promote({
                stableRefs: method === "POST" ? [] : [stableRef()],
                raceStable: stableRef(main),
            });
            expect(first.result.status).not.toBe(0);
            expect(first.result.stderr).toContain("Concurrent ref change");
            expect(first.writes).toHaveLength(1);
            const retry = await promote();
            expect(retry.result.status, retry.result.stderr).toBe(0);
            expect(retry.writes).toEqual([]);
        },
    );

    test.each([
        stableRef(previous),
        stableRef(commit, "refs/heads/main"),
        { ref: "refs/heads/stable", object: { type: "tag", sha: commit } },
        {},
    ])(
        "Rejects malformed write confirmation without recovery writes: %j",
        async (writeResponse) => {
            const { result, writes } = await promote({ writeResponse });
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("stable");
            expect(writes).toHaveLength(1);
        },
    );
});
