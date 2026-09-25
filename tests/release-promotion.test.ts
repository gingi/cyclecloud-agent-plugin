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
const tree = "d".repeat(40);
const previousTree = "e".repeat(40);
const source = "f".repeat(40);
const previousSource = "1".repeat(40);
const newer = "2".repeat(40);
const candidate = {
    sha: commit,
    message: `Release v0.3.0\n\nSource-Commit: ${source}`,
    tree: { sha: tree },
    parents: [{ sha: previous }, { sha: source }],
};
const previousSnapshot = {
    sha: previous,
    message: `Release v0.2.0\n\nSource-Commit: ${previousSource}`,
    tree: { sha: previousTree },
    parents: [],
};
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
            tree,
            source,
            previousSource,
            gitCommits: {
                [commit]: candidate,
                [source]: {
                    sha: source,
                    tree: { sha: tree },
                    message: "Prepare release",
                },
                [previous]: previousSnapshot,
                [previousSource]: {
                    sha: previousSource,
                    tree: { sha: previousTree },
                    message: "Previous source",
                },
            },
            release: {
                tag_name: "v0.3.0",
                draft: false,
                prerelease: false,
                published_at: "2026-09-23T00:00:00Z",
            },
            mainComparison: { status: "ahead" },
            sourceComparison: { status: "ahead" },
            stableComparison: { status: "diverged" },
            stableRefs: [stableRef()],
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
    await writeFile(
        statePath,
        JSON.stringify({
            ...state,
            ...overrides,
            gitCommits: {
                ...(state.gitCommits as Record<string, unknown>),
                ...(overrides.gitCommits as Record<string, unknown>),
            },
        }),
    );
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

// Retry cases run up to three CLI processes, each bounded at 10 seconds.
describe("Stable release promotion", { timeout: 35_000 }, () => {
    test.each(["POST", "PATCH"])(
        "Promotes the exact verified tag with %s and never creates a commit",
        async (method) => {
            const { result, calls, writes } = await promote(
                method === "POST"
                    ? {
                          stableRefs: [],
                          gitCommits: {
                              [commit]: { ...candidate, parents: [] },
                          },
                      }
                    : {},
            );
            expect(result.status, result.stderr).toBe(0);
            expect(writes).toHaveLength(1);
            expect(writes[0]?.args).toEqual([
                "api",
                `${base}/${method === "POST" ? "git/refs" : "git/refs/heads/stable"}`,
                "--method",
                method,
                "--input",
                "-",
            ]);
            expect(JSON.parse(writes[0]?.input ?? "null")).toEqual(
                method === "POST"
                    ? { ref: "refs/heads/stable", sha: commit }
                    : { sha: commit, force: false },
            );
            expect(
                calls.some(
                    (call) =>
                        call.args[1] === `${base}/compare/${source}...${main}`,
                ),
            ).toBe(true);
            expect(
                calls.some(
                    (call) =>
                        call.args[1] === `${base}/compare/${commit}...${main}`,
                ),
            ).toBe(false);
            expect(result.stdout).toContain(`at ${commit} (source ${source})`);
            const again = await promote();
            expect(again.result.status, again.result.stderr).toBe(0);
            expect(again.writes).toEqual([]);
        },
    );

    test.each([0, 1, 2])(
        "Accepts the existing stable release with %s parents",
        async (count) => {
            const parents =
                count === 0
                    ? []
                    : count === 1
                      ? [{ sha: newer }]
                      : [{ sha: newer }, { sha: previousSource }];
            const { result } = await promote({
                gitCommits: { [previous]: { ...previousSnapshot, parents } },
            });
            expect(result.status, result.stderr).toBe(0);
        },
    );

    test("Accepts an ordinary main source as the current stable base", async () => {
        const { result } = await promote({
            previousSource: previous,
            gitCommits: {
                [previous]: {
                    ...previousSnapshot,
                    message: "Prepare previous release",
                },
            },
        });
        expect(result.status, result.stderr).toBe(0);
    });

    test("Does nothing when stable already points at the tagged release", async () => {
        const { result, writes } = await promote({
            stableRefs: [stableRef(commit)],
        });
        expect(result.status, result.stderr).toBe(0);
        expect(writes).toEqual([]);
    });

    test.each(["ahead", "identical"])(
        "Does not roll back stable when it includes the tagged commit (%s)",
        async (status) => {
            const { result, writes } = await promote({
                stableRefs: [stableRef(newer)],
                stableComparison: { status },
            });
            expect(result.status, result.stderr).toBe(0);
            expect(writes).toEqual([]);
        },
    );

    test.each(["behind", "diverged"])(
        "Rejects a candidate based on a different stable tip (%s)",
        async (status) => {
            await expectRejected(
                {
                    stableRefs: [stableRef(newer)],
                    stableComparison: { status },
                },
                "Stable changed",
            );
        },
    );
    test.each(["unknown", undefined])(
        "Fails closed on unknown stable ancestry %s",
        async (status) => {
            await expectRejected(
                {
                    stableRefs: [stableRef(newer)],
                    stableComparison: { status },
                },
                "ancestry",
            );
        },
    );
    test("Does not recreate a missing stable branch from a merge with an existing base", async () => {
        await expectRejected({ stableRefs: [] }, "Stable changed");
    });
    test("Does not replace an existing stable branch with a parentless candidate", async () => {
        await expectRejected(
            { gitCommits: { [commit]: { ...candidate, parents: [] } } },
            "Stable changed",
        );
    });

    test.each(["behind", "diverged", "unknown", undefined])(
        "Rejects source off main or unknown main comparison %s",
        async (status) => {
            await expectRejected({ mainComparison: { status } }, "main");
        },
    );
    test("Accepts source at the main tip", async () => {
        const { result } = await promote({
            main: source,
            mainComparison: { status: "identical" },
        });
        expect(result.status, result.stderr).toBe(0);
    });
    test.each(["behind", "diverged", "identical", "unknown", undefined])(
        "Rejects a candidate that does not advance its previous source (%s)",
        async (status) => {
            await expectRejected(
                { sourceComparison: { status } },
                "does not advance",
            );
        },
    );

    test.each([
        `${base}/commits/refs%2Ftags%2Fv0.3.0`,
        `${base}/commits/refs%2Fheads%2Fmain`,
        `${base}/compare/${source}...${main}`,
        `${base}/compare/${previousSource}...${source}`,
        `${base}/compare/${commit}...${newer}`,
    ])(
        "Filters oversized commit/diff responses from %s",
        async (largeResponse) => {
            const { result } = await promote({
                largeResponse,
                ...(largeResponse.endsWith(`...${newer}`)
                    ? {
                          stableRefs: [stableRef(newer)],
                          stableComparison: { status: "ahead" },
                      }
                    : {}),
            });
            expect(result.status, result.stderr).toBe(0);
        },
    );
    test("Uses comparison status even when the returned commit list is truncated", async () => {
        const comparison = {
            status: "ahead",
            total_commits: 400,
            commits: Array.from({ length: 250 }, () => ({ sha: tree })),
        };
        const { result } = await promote({
            mainComparison: comparison,
            sourceComparison: comparison,
        });
        expect(result.status, result.stderr).toBe(0);
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
    test("Rejects a tag with a different peeled SHA", async () => {
        await expectRejected({ commit: previous }, "different commit");
    });
    test.each([null, "short", undefined])(
        "Rejects invalid tag tree %j",
        async (tree) => {
            await expectRejected({ tree }, "SHA");
        },
    );
    test("Rejects a tag tree that differs from the release snapshot", async () => {
        await expectRejected({ tree: previousTree }, "does not match the tag");
    });

    test.each([
        { ...candidate, sha: source },
        { ...candidate, message: "Prepare for release 0.3.0" },
        { ...candidate, message: `Release v0.2.0\n\nSource-Commit: ${source}` },
        { ...candidate, message: `Release v0.3.0\n\nSource-Commit: short` },
        { ...candidate, parents: null },
        { ...candidate, parents: [{}] },
        { ...candidate, parents: [{ sha: previous }] },
        { ...candidate, parents: [{ sha: source }, { sha: previous }] },
        {
            ...candidate,
            parents: [{ sha: previous }, { sha: source }, { sha: newer }],
        },
    ])("Rejects invalid candidate metadata: %j", async (snapshot) => {
        const { result, writes } = await promote({
            gitCommits: { [commit]: snapshot },
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/release commit|SHA/);
        expect(writes).toEqual([]);
    });
    test("Rejects source tree that differs from the candidate", async () => {
        await expectRejected(
            {
                gitCommits: {
                    [source]: { sha: source, tree: { sha: previousTree } },
                },
            },
            "tree must match",
        );
    });
    test("Rejects invalid source commit confirmation", async () => {
        await expectRejected(
            {
                gitCommits: {
                    [source]: { sha: previousSource, tree: { sha: tree } },
                },
            },
            "metadata",
        );
    });
    test.each([
        { ...previousSnapshot, tree: { sha: tree } },
        {
            ...previousSnapshot,
            parents: [{ sha: previousSource }, { sha: newer }],
        },
        {
            ...previousSnapshot,
            message: `Release v0.2.0-rc.1\n\nSource-Commit: ${previousSource}`,
        },
    ])("Rejects invalid stable base provenance: %j", async (snapshot) => {
        const { result, writes } = await promote({
            gitCommits: { [previous]: snapshot },
        });
        expect(result.status).not.toBe(0);
        expect(writes).toEqual([]);
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
        `${base}/git/commits/${commit}`,
        `${base}/git/commits/${source}`,
        `${base}/git/commits/${previous}`,
        `${base}/git/commits/${previousSource}`,
        `${base}/releases/tags/v0.3.0`,
        `${base}/commits/refs%2Fheads%2Fmain`,
        `${base}/compare/${source}...${main}`,
        `${base}/compare/${previousSource}...${source}`,
        lookup,
    ])("Does not treat an API failure as a missing ref: %s", async (fail) => {
        await expectRejected({ fail }, "Simulated GitHub failure");
    });
    test("Propagates stable ancestry lookup failure without writing", async () => {
        await expectRejected(
            {
                stableRefs: [stableRef(newer)],
                fail: `${base}/compare/${commit}...${newer}`,
            },
            "Simulated GitHub failure",
        );
    });
    test("Ignores stable-extra when stable is missing", async () => {
        const { result, writes } = await promote({
            stableRefs: [stableRef(previous, "refs/heads/stable-extra")],
            gitCommits: { [commit]: { ...candidate, parents: [] } },
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
        "Fails safely on %s and retries the same tag commit",
        async (method) => {
            const first = await promote({
                fail: method,
                ...(method === "POST"
                    ? {
                          stableRefs: [],
                          gitCommits: {
                              [commit]: { ...candidate, parents: [] },
                          },
                      }
                    : {}),
            });
            expect(first.result.status).not.toBe(0);
            expect(first.writes).toHaveLength(1);
            const retry = await promote({ fail: null });
            expect(retry.result.status, retry.result.stderr).toBe(0);
            expect(JSON.parse(retry.writes[0]?.input ?? "null")).toMatchObject({
                sha: commit,
            });
            const again = await promote();
            expect(again.result.status, again.result.stderr).toBe(0);
            expect(again.writes).toEqual([]);
        },
    );
    test.each(["POST", "PATCH"])(
        "Concurrent %s promotion cannot roll back stable on retry",
        async (method) => {
            const first = await promote({
                raceStable: stableRef(newer),
                ...(method === "POST"
                    ? {
                          stableRefs: [],
                          gitCommits: {
                              [commit]: { ...candidate, parents: [] },
                          },
                      }
                    : {}),
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
