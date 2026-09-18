import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setFixtureVersion } from "./helpers/release.js";

const root = fileURLToPath(new URL("../", import.meta.url));
let workspace: string;
let repo: string;
let commit: string;
let event: Record<string, unknown>;
let env: NodeJS.ProcessEnv;

function git(...args: string[]) {
    const result = spawnSync("git", ["-C", repo, ...args], {
        encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
}

function commitFiles() {
    git("add", ".");
    git("commit", "--quiet", "-m", "Fixture");
    return git("rev-parse", "HEAD");
}

function selectTag(tag: string, annotated = false) {
    git("tag", ...(annotated ? ["-a", "-m", "Release"] : []), tag);
    env.GITHUB_REF = `refs/tags/${tag}`;
    env.GITHUB_SHA = git("rev-parse", tag);
    event.ref = env.GITHUB_REF;
}

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "release context "));
    repo = join(workspace, "repo");
    for (const file of [
        "package.json",
        "package-lock.json",
        "plugin.json",
        ".github/plugin/marketplace.json",
    ]) {
        await mkdir(dirname(join(repo, file)), { recursive: true });
        await cp(join(root, file), join(repo, file));
    }
    await setFixtureVersion(repo, "0.1.0");
    await writeFile(
        join(repo, "CHANGELOG.md"),
        "# Changelog\n\n## [0.1.0]\n\nRelease notes.\n",
    );
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    git("config", "core.hooksPath", "/dev/null");
    commit = commitFiles();
    git("update-ref", "refs/remotes/origin/main", commit);
    event = {
        deleted: false,
        forced: false,
        repository: { full_name: "example/plugin", default_branch: "main" },
    };
    env = {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REPOSITORY: "example/plugin",
        GITHUB_EVENT_PATH: join(workspace, "event.json"),
        GITHUB_OUTPUT: join(workspace, "output"),
    };
});

afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
});

async function run() {
    await writeFile(join(workspace, "event.json"), JSON.stringify(event));
    return spawnSync(
        process.execPath,
        [join(root, "scripts/release-context.mjs")],
        {
            cwd: repo,
            env,
            encoding: "utf8",
            timeout: 10_000,
        },
    );
}

async function expectFailure(message: string) {
    const result = await run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(
        await readFile(join(workspace, "output"), "utf8").catch(() => ""),
    ).toBe("");
}

describe("Tag release source", () => {
    test.each([false, true])(
        "Pins the commit of a tag (annotated=%s)",
        async (annotated) => {
            selectTag("v0.1.0", annotated);
            const result = await run();
            expect(result.status, result.stderr).toBe(0);
            expect(await readFile(join(workspace, "output"), "utf8")).toBe(
                `tag=v0.1.0\ncommit=${commit}\nprerelease=false\n`,
            );
        },
    );

    test("Accepts an annotated tag event carrying the peeled commit", async () => {
        selectTag("v0.1.0", true);
        env.GITHUB_SHA = commit;
        expect((await run()).status).toBe(0);
    });

    test("Allows an older stable commit on the default branch", async () => {
        selectTag("v0.1.0");
        git("commit", "--allow-empty", "-m", "Later main commit");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
        git("checkout", "--detach", commit);
        expect((await run()).status).toBe(0);
    });

    test("Allows a prerelease from a feature branch", async () => {
        git("checkout", "-b", "feature");
        await setFixtureVersion(repo, "0.2.0-rc.1");
        await writeFile(
            join(repo, "CHANGELOG.md"),
            "## [0.2.0-rc.1]\n\nPreview notes.\n",
        );
        commit = commitFiles();
        selectTag("v0.2.0-rc.1");
        const result = await run();
        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(join(workspace, "output"), "utf8")).toContain(
            "prerelease=true\n",
        );
    });

    test("Rejects a stable release off the default branch", async () => {
        git("checkout", "-b", "feature");
        git("commit", "--allow-empty", "-m", "Unmerged work");
        selectTag("v0.1.0");
        await expectFailure("default branch");
    });

    test.each([
        "branch",
        "deleted",
        "forced",
        "dispatch",
        "other-repo",
        "wrong-ref",
    ])("Rejects an invalid release event: %s", async (kind) => {
        selectTag("v0.1.0");
        if (kind === "branch") env.GITHUB_REF = "refs/heads/main";
        if (kind === "deleted") event.deleted = true;
        if (kind === "forced") event.forced = true;
        if (kind === "dispatch") env.GITHUB_EVENT_NAME = "workflow_dispatch";
        if (kind === "other-repo") env.GITHUB_REPOSITORY = "other/plugin";
        if (kind === "wrong-ref") event.ref = "refs/tags/v0.2.0";
        await expectFailure("tag push");
    });

    test("Rejects an invalid version tag", async () => {
        selectTag("v01.0.0");
        await expectFailure("SemVer");
    });

    test("Rejects a checkout different from the event commit", async () => {
        selectTag("v0.1.0");
        git("commit", "--allow-empty", "-m", "Wrong checkout");
        await expectFailure("event commit");
    });

    test("Rejects a tag that no longer identifies the event commit", async () => {
        selectTag("v0.1.0");
        git("commit", "--allow-empty", "-m", "Moved tag");
        git("tag", "--force", "v0.1.0");
        git("checkout", "--detach", commit);
        await expectFailure("tag");
    });

    test("Rejects an uncommitted checkout", async () => {
        selectTag("v0.1.0");
        await writeFile(join(repo, "untracked"), "Not committed");
        await expectFailure("clean");
    });

    test("Rejects mismatched manifest versions", async () => {
        selectTag("v0.2.0");
        await expectFailure("version");
    });

    test("Requires committed release notes", async () => {
        await writeFile(join(repo, "CHANGELOG.md"), "# Changelog\n");
        commit = commitFiles();
        git("update-ref", "refs/remotes/origin/main", commit);
        selectTag("v0.1.0");
        await expectFailure("CHANGELOG.md");
    });
});
