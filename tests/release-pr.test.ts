import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setFixtureVersion } from "./helpers/release.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const head = "e".repeat(40);
let workspace: string;
let bin: string;
let base: string;
let state: Record<string, unknown>;
let event: Record<string, unknown>;
let env: NodeJS.ProcessEnv;

function git(...args: string[]) {
    const result = spawnSync("git", ["-C", workspace, ...args], {
        encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
}

function commitFixture() {
    git("add", ".");
    git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "Fixture",
    );
    return git("rev-parse", "HEAD");
}

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "release PR "));
    for (const file of [
        "package.json",
        "package-lock.json",
        "plugin.json",
        ".github/plugin/marketplace.json",
        ".prettierrc.json",
    ]) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await cp(join(root, file), join(workspace, file));
    }
    await setFixtureVersion(workspace, "0.1.0");
    await writeFile(
        join(workspace, "CHANGELOG.md"),
        "# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n\nReviewed release notes.\n",
    );
    git("init", "--quiet");
    base = commitFixture();
    bin = await mkdtemp(join(tmpdir(), "release PR commands "));
    await writeFile(
        join(bin, "gh"),
        `#!/bin/sh\nexec '${process.execPath}' '${join(root, "tests/helpers/fake-release-github.mjs")}' "$@"\n`,
        { mode: 0o700 },
    );
    state = {
        base,
        reviews: [
            {
                user: { login: "reviewer", type: "User" },
                author_association: "OWNER",
                state: "APPROVED",
                commit_id: head,
            },
        ],
    };
    event = {
        action: "closed",
        number: 12,
        repository: { full_name: "example/plugin", default_branch: "main" },
        pull_request: {
            number: 12,
            merged: true,
            merge_commit_sha: base,
            user: { login: "release-bot[bot]" },
            head: {
                ref: "release/v0.1.0",
                sha: head,
                repo: { full_name: "example/plugin" },
            },
            base: { ref: "main", repo: { full_name: "example/plugin" } },
        },
    };
    env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_REPO: "example/plugin",
        GITHUB_REPOSITORY: "example/plugin",
        GITHUB_EVENT_PATH: join(bin, "event.json"),
        GITHUB_OUTPUT: join(bin, "output"),
        FAKE_RELEASE_STATE: join(bin, "state.json"),
        FAKE_RELEASE_CALLS: join(bin, "calls.jsonl"),
    };
});
afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
});

async function run(script: string, ...args: string[]) {
    await writeFile(join(bin, "state.json"), JSON.stringify(state));
    await writeFile(join(bin, "event.json"), JSON.stringify(event));
    return spawnSync(
        process.execPath,
        [join(root, "scripts", script), ...args],
        { cwd: workspace, env, encoding: "utf8", timeout: 15_000 },
    );
}
interface Call {
    method: string;
    route: string;
    body?: {
        tree?: Array<{ path: string; content: string }>;
        parents?: string[];
        ref?: string;
        base?: string;
        head?: string;
    };
}
async function calls(): Promise<Call[]> {
    return (await readFile(join(bin, "calls.jsonl"), "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call);
}
function pr() {
    return event.pull_request as {
        merged: boolean;
        merge_commit_sha: string;
        head: { ref: string; sha: string; repo: { full_name: string } };
        base: { ref: string };
        user: { login: string };
        merged_by?: { login: string; type: string };
    };
}

describe("Release preparation PR", () => {
    test("Rejects an invalid requested version before making GitHub requests", async () => {
        const result = await run("open-release-pr.mjs", "v0.2.0");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("version");
        expect(await calls()).toEqual([]);
        expect(git("status", "--porcelain")).toBe("");
    });
    test("Creates a version/notes commit and PR without changing the checkout or publishing", async () => {
        const result = await run("open-release-pr.mjs", "0.2.0-rc.1");
        expect(result.status, result.stderr).toBe(0);
        const writes = (await calls()).filter((call) => call.method === "POST");
        const tree = writes.find((call) => call.route.endsWith("/git/trees"))
            ?.body?.tree;
        expect(tree?.map((entry) => entry.path).sort()).toEqual(
            [
                "package.json",
                "package-lock.json",
                "plugin.json",
                ".github/plugin/marketplace.json",
                "CHANGELOG.md",
            ].sort(),
        );
        expect(
            JSON.parse(
                tree?.find((entry) => entry.path === "plugin.json")?.content ??
                    "{}",
            ),
        ).toMatchObject({ version: "0.2.0-rc.1" });
        expect(
            writes.find((call) => call.route.endsWith("/git/commits"))?.body
                ?.parents,
        ).toEqual([base]);
        expect(
            writes.find((call) => call.route.endsWith("/git/refs"))?.body?.ref,
        ).toBe("refs/heads/release/v0.2.0-rc.1");
        expect(
            writes.find((call) => call.route.endsWith("/pulls"))?.body,
        ).toMatchObject({ base: "main", head: "release/v0.2.0-rc.1" });
        expect(writes.some((call) => call.route.endsWith("/releases"))).toBe(
            false,
        );
        const changelog = tree?.find(
            (entry) => entry.path === "CHANGELOG.md",
        )?.content;
        expect(changelog).toContain("## [0.2.0-rc.1]");
        expect(changelog).toContain("Reviewed release notes.");
        expect(git("status", "--porcelain")).toBe("");
    });
    test("Reuses an open PR without overwriting reviewer edits", async () => {
        state.prs = [
            {
                state: "open",
                number: 12,
                html_url: "https://github.com/example/plugin/pull/12",
                head: pr().head,
                base: pr().base,
            },
        ];
        const result = await run("open-release-pr.mjs", "0.1.0");
        expect(result.status, result.stderr).toBe(0);
        expect((await calls()).every((call) => call.method === "GET")).toBe(
            true,
        );
    });
    test("Refuses an orphan branch instead of overwriting it", async () => {
        state.branches = [
            { ref: "refs/heads/release/v0.1.0", object: { sha: head } },
        ];
        const result = await run("open-release-pr.mjs", "0.1.0");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("already exists");
        expect((await calls()).every((call) => call.method === "GET")).toBe(
            true,
        );
    });
    test("Refuses an already tagged version", async () => {
        state.tags = [{ ref: "refs/tags/v0.1.0" }];
        const result = await run("open-release-pr.mjs", "0.1.0");
        expect(result.status).not.toBe(0);
        expect((await calls()).every((call) => call.method === "GET")).toBe(
            true,
        );
    });
    test("Refuses a closed release PR rather than reopening it automatically", async () => {
        state.prs = [
            { state: "closed", number: 12, head: pr().head, base: pr().base },
        ];
        expect((await run("open-release-pr.mjs", "0.1.0")).status).not.toBe(0);
        expect((await calls()).every((call) => call.method === "GET")).toBe(
            true,
        );
    });
    test("Rejects a dirty source checkout before making remote changes", async () => {
        await writeFile(join(workspace, "local-note"), "keep me");
        const result = await run("open-release-pr.mjs", "0.1.0");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("clean");
        expect((await calls()).every((call) => call.method === "GET")).toBe(
            true,
        );
    });
    test("Rejects a checkout that no longer matches the default branch", async () => {
        state.base = "f".repeat(40);
        const result = await run("open-release-pr.mjs", "0.1.0");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("default branch");
        expect((await calls()).every((call) => call.method === "GET")).toBe(
            true,
        );
    });
    test("Stops on API failure instead of assuming a branch is absent", async () => {
        state.failRoute =
            "repos/example/plugin/git/matching-refs/heads/release/v0.1.0";
        expect((await run("open-release-pr.mjs", "0.1.0")).status).not.toBe(0);
        expect((await calls()).every((call) => call.method === "GET")).toBe(
            true,
        );
    });
});

describe("Release PR contents before merge", () => {
    test("Checks versions and notes without approval or GitHub requests", async () => {
        event.action = "opened";
        pr().merged = false;
        state.reviews = [];
        const result = await run(
            "release-context.mjs",
            "--check-branch",
            "release/v0.1.0",
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("Release PR contents match v0.1.0");
        expect(await calls()).toEqual([]);
    });
    test("Rejects a branch version different from its manifests", async () => {
        const result = await run(
            "release-context.mjs",
            "--check-branch",
            "release/v0.2.0",
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("version");
        expect(await calls()).toEqual([]);
    });
    test("Rejects missing notes before a PR can merge", async () => {
        event.action = "opened";
        pr().merged = false;
        await rm(join(workspace, "CHANGELOG.md"));
        const result = await run(
            "release-context.mjs",
            "--check-branch",
            "release/v0.1.0",
        );
        expect(result.status).not.toBe(0);
        expect(await calls()).toEqual([]);
    });
});

describe("Merged release PR gate", () => {
    test("Selects the recorded merge commit and reviewed notes", async () => {
        const result = await run("release-context.mjs");
        expect(result.status, result.stderr).toBe(0);
        const output = await readFile(join(bin, "output"), "utf8");
        expect(output).toContain(`commit=${base}\n`);
        expect(output).toContain("tag=v0.1.0\n");
        expect(output).not.toContain(`commit=${head}\n`);
    });
    test.each(["unmerged", "fork", "other-base", "feature"])(
        "Ignores %s PRs",
        async (kind) => {
            if (kind === "unmerged") pr().merged = false;
            if (kind === "fork") pr().head.repo.full_name = "other/plugin";
            if (kind === "other-base") pr().base.ref = "maintenance";
            if (kind === "feature") pr().head.ref = "feat/example";
            const result = await run("release-context.mjs");
            expect(result.status, result.stderr).toBe(0);
            await expect(readFile(join(bin, "output"))).rejects.toMatchObject({
                code: "ENOENT",
            });
            expect(await calls()).toEqual([]);
        },
    );
    test.each([
        "missing",
        "bot",
        "author",
        "stale",
        "outsider",
        "changes-requested",
    ])("Requires a current human approval: %s", async (kind) => {
        state.reviews =
            kind === "missing"
                ? []
                : [
                      {
                          user: {
                              login:
                                  kind === "author"
                                      ? "release-bot[bot]"
                                      : "reviewer",
                              type: kind === "bot" ? "Bot" : "User",
                          },
                          author_association:
                              kind === "outsider" ? "NONE" : "OWNER",
                          state:
                              kind === "changes-requested"
                                  ? "CHANGES_REQUESTED"
                                  : "APPROVED",
                          commit_id: kind === "stale" ? base : head,
                      },
                  ];
        const result = await run("release-context.mjs");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/approval|changes requested/);
    });
    test("Accepts a deliberate human merge, including by the PR author", async () => {
        state.reviews = [];
        pr().user.login = "maintainer";
        pr().merged_by = { login: "maintainer", type: "User" };
        const result = await run("release-context.mjs");
        expect(result.status, result.stderr).toBe(0);
    });
    test.each([
        ["Bot type", { login: "automation", type: "Bot" }],
        ["bot login", { login: "release-bot[bot]", type: "User" }],
    ])(
        "Does not treat an automated merge as human approval: %s",
        async (_kind, merger) => {
            state.reviews = [];
            pr().merged_by = merger;
            const result = await run("release-context.mjs");
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain(
                "owner/member/collaborator approval",
            );
        },
    );
    test("A human merge does not override requested changes", async () => {
        state.reviews = [
            {
                user: { login: "reviewer", type: "User" },
                author_association: "OWNER",
                state: "CHANGES_REQUESTED",
                commit_id: head,
            },
        ];
        pr().merged_by = { login: "maintainer", type: "User" };
        const result = await run("release-context.mjs");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("changes requested");
    });
    test("Rejects a checkout different from the merged commit", async () => {
        pr().merge_commit_sha = "f".repeat(40);
        expect((await run("release-context.mjs")).status).not.toBe(0);
    });
    test("Requires reviewed release notes", async () => {
        await rm(join(workspace, "CHANGELOG.md"));
        expect((await run("release-context.mjs")).status).not.toBe(0);
    });
});

describe("Preview release gate", () => {
    beforeEach(async () => {
        await setFixtureVersion(workspace, "0.1.0-rc.3");
        await writeFile(
            join(workspace, "CHANGELOG.md"),
            "# Changelog\n\n## [0.1.0-rc.3]\n\nPreview changes.\n",
        );
        base = commitFixture();
        event = {
            repository: { full_name: "example/plugin", default_branch: "main" },
            inputs: { mode: "preview", version: "0.1.0-rc.3" },
        };
        env.GITHUB_EVENT_NAME = "workflow_dispatch";
        env.GITHUB_REF = "refs/heads/feat/preview-test";
        env.GITHUB_SHA = base;
    });
    test("Pins a clean branch commit without creating a PR or requesting approval", async () => {
        state.reviews = [];
        const result = await run(
            "release-context.mjs",
            "--preview",
            "0.1.0-rc.3",
        );
        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(join(bin, "output"), "utf8")).toBe(
            `tag=v0.1.0-rc.3\ncommit=${base}\n`,
        );
        expect(await calls()).toEqual([]);
    });
    test("Refuses a stable release in preview mode", async () => {
        const result = await run("release-context.mjs", "--preview", "0.1.0");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("prerelease");
        expect(await calls()).toEqual([]);
    });
    test.each(["default-branch", "tag", "push", "wrong-mode", "other-repo"])(
        "Rejects an invalid preview source: %s",
        async (kind) => {
            if (kind === "default-branch") env.GITHUB_REF = "refs/heads/main";
            if (kind === "tag") env.GITHUB_REF = "refs/tags/v0.1.0-rc.3";
            if (kind === "push") env.GITHUB_EVENT_NAME = "push";
            if (kind === "wrong-mode")
                event.inputs = { mode: "request", version: "0.1.0-rc.3" };
            if (kind === "other-repo")
                event.repository = {
                    full_name: "other/plugin",
                    default_branch: "main",
                };
            const result = await run(
                "release-context.mjs",
                "--preview",
                "0.1.0-rc.3",
            );
            expect(result.status).not.toBe(0);
            expect(await calls()).toEqual([]);
        },
    );
    test("Rejects a checkout different from the dispatched commit", async () => {
        env.GITHUB_SHA = "f".repeat(40);
        const result = await run(
            "release-context.mjs",
            "--preview",
            "0.1.0-rc.3",
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("commit");
    });
    test("Requires committed version and changelog changes", async () => {
        await writeFile(
            join(workspace, "CHANGELOG.md"),
            "uncommitted changes\n",
        );
        const result = await run(
            "release-context.mjs",
            "--preview",
            "0.1.0-rc.3",
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("clean");
    });
});

describe("Release branch cleanup", () => {
    beforeEach(async () => {
        const fakeGit = join(bin, "git.mjs");
        await writeFile(
            fakeGit,
            `import fs from 'node:fs'; fs.writeFileSync(process.env.FAKE_GIT_CALL, JSON.stringify(process.argv.slice(2)));`,
        );
        await writeFile(
            join(bin, "git"),
            `#!/bin/sh\nexec '${process.execPath}' '${fakeGit}' "$@"\n`,
            { mode: 0o700 },
        );
        env.FAKE_GIT_CALL = join(bin, "git-call.json");
    });
    test("Never deletes the source branch of a preview dispatch", async () => {
        event = {
            repository: { full_name: "example/plugin", default_branch: "main" },
            inputs: { mode: "preview" },
        };
        const result = await run("cleanup-release-branch.mjs");
        expect(result.status).not.toBe(0);
        expect(await calls()).toEqual([]);
        await expect(
            readFile(join(bin, "git-call.json")),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });
    test("Deletes only the merged head with a force-with-lease check", async () => {
        state.branches = [
            { ref: "refs/heads/release/v0.1.0", object: { sha: head } },
        ];
        const result = await run("cleanup-release-branch.mjs");
        expect(result.status, result.stderr).toBe(0);
        const args = JSON.parse(
            await readFile(join(bin, "git-call.json"), "utf8"),
        ) as string[];
        expect(args).toContain(
            `--force-with-lease=refs/heads/release/v0.1.0:${head}`,
        );
        expect(args).toContain(":refs/heads/release/v0.1.0");
    });
    test.each(["absent", "advanced", "open-pr"])(
        "Preserves the branch when %s",
        async (kind) => {
            state.branches =
                kind === "absent"
                    ? []
                    : [
                          {
                              ref: "refs/heads/release/v0.1.0",
                              object: {
                                  sha: kind === "advanced" ? base : head,
                              },
                          },
                      ];
            if (kind === "open-pr") state.openPrs = [{ number: 99 }];
            const result = await run("cleanup-release-branch.mjs");
            expect(result.status, result.stderr).toBe(0);
            await expect(
                readFile(join(bin, "git-call.json")),
            ).rejects.toMatchObject({ code: "ENOENT" });
        },
    );
});
