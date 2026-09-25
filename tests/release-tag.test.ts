import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { releaseRepository } from "./helpers/release-repository.js";
import { setFixtureVersion } from "./helpers/release.js";

const root = fileURLToPath(new URL("../", import.meta.url));
let repository: Awaited<ReturnType<typeof releaseRepository>>;
let verification: string;
let log: string;

beforeEach(async () => {
    repository = await releaseRepository();
    verification = join(repository.directory, "verify.mjs");
    log = join(repository.directory, "verify.log");
    await writeFile(
        verification,
        `
import { appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
appendFileSync(process.env.VERIFY_LOG, process.argv.slice(2).join(' ') + '\\n');
if (process.env.VERIFY_EFFECT === 'fail') process.exit(1);
if (process.env.VERIFY_EFFECT === 'dirty') writeFileSync('new-change.txt', 'Concurrent edit');
if (process.env.VERIFY_EFFECT === 'head') execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'Concurrent commit']);
if (process.env.VERIFY_EFFECT === 'tag') execFileSync('git', ['tag', '--force', 'v0.1.0', 'HEAD^']);
if (process.env.VERIFY_EFFECT === 'stable') execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/stable']);
`,
    );
});
afterEach(async () => {
    await rm(repository.directory, { recursive: true, force: true });
});

function git(...args: string[]) {
    return repository.git(...args);
}
function tag(args = ["0.1.0"], effect = "") {
    return spawnSync(
        process.execPath,
        [join(root, "scripts/tag-release.mjs"), ...args],
        {
            cwd: repository.checkout,
            env: {
                ...process.env,
                npm_execpath: verification,
                VERIFY_LOG: log,
                VERIFY_EFFECT: effect,
            },
            encoding: "utf8",
            timeout: 15_000,
        },
    );
}
function localTag() {
    return git("tag", "--list", "v0.1.0");
}
function remoteTag() {
    return git("ls-remote", "--tags", "origin", "refs/tags/v0.1.0");
}
function expectRelease(source: string, previous?: string) {
    const release = git("rev-parse", "v0.1.0^{commit}");
    expect(release).not.toBe(source);
    expect(git("show", "-s", "--format=%B", release)).toBe(
        `Release v0.1.0\n\nSource-Commit: ${source}`,
    );
    expect(git("rev-parse", `${release}^{tree}`)).toBe(
        git("rev-parse", `${source}^{tree}`),
    );
    expect(git("show", "-s", "--format=%P", release)).toBe(
        previous ? `${previous} ${source}` : "",
    );
    expect(git("rev-parse", "HEAD")).toBe(source);
    expect(git("ls-remote", "--heads", "origin", "refs/heads/stable")).toBe(
        previous ? `${previous}\trefs/heads/stable` : "",
    );
    return release;
}
async function expectNoTag(message: string, args = ["0.1.0"], effect = "") {
    const result = tag(args, effect);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(localTag()).toBe("");
    expect(remoteTag()).toBe("");
    if (!effect) expect(await readFile(log, "utf8").catch(() => "")).toBe("");
}
function advanceMain() {
    const source = repository.commit("feat: reviewed work");
    git("push", "origin", "main");
    return source;
}

describe("Post-review release tag", () => {
    test("Verifies source and tags a parentless initial release without advancing stable", async () => {
        const source = git("rev-parse", "HEAD");
        const result = tag();
        expect(result.status, result.stderr).toBe(0);
        expect(git("cat-file", "-t", "refs/tags/v0.1.0")).toBe("tag");
        expectRelease(source);
        expect(await readFile(log, "utf8")).toBe("run verify\n");
        expect(remoteTag()).toBe("");
        expect(git("status", "--porcelain")).toBe("");
    });

    test("Keeps one release identity from tagging through CI validation and stable promotion", async () => {
        const previous = git("rev-parse", "HEAD");
        git("push", "origin", "HEAD:refs/heads/stable");
        const source = advanceMain();
        const result = tag(["0.1.0", "--push"]);
        expect(result.status, result.stderr).toBe(0);
        const release = expectRelease(source, previous);
        expect(
            git("ls-remote", "--tags", "origin", "refs/tags/v0.1.0^{}"),
        ).toBe(`${release}\trefs/tags/v0.1.0^{}`);
        expect(git("ls-remote", "--heads", "origin", "refs/heads/main")).toBe(
            `${source}\trefs/heads/main`,
        );
        expect(
            git(
                "log",
                "--first-parent",
                "--format=%s",
                `${previous}..${release}`,
            ),
        ).toBe("Release v0.1.0");

        const event = join(repository.directory, "event.json");
        const output = join(repository.directory, "context-output");
        await writeFile(
            event,
            JSON.stringify({
                ref: "refs/tags/v0.1.0",
                deleted: false,
                forced: false,
                repository: { full_name: "example/plugin" },
            }),
        );
        git("checkout", "--detach", release);
        const context = spawnSync(
            process.execPath,
            [join(root, "scripts/release-context.mjs")],
            {
                cwd: repository.checkout,
                env: {
                    ...process.env,
                    GITHUB_EVENT_NAME: "push",
                    GITHUB_REPOSITORY: "example/plugin",
                    GITHUB_REF: "refs/tags/v0.1.0",
                    GITHUB_SHA: release,
                    GITHUB_EVENT_PATH: event,
                    GITHUB_OUTPUT: output,
                },
                encoding: "utf8",
                timeout: 10_000,
            },
        );
        expect(context.status, context.stderr).toBe(0);
        expect(await readFile(output, "utf8")).toContain(`commit=${release}\n`);

        const bin = join(repository.directory, "commands");
        await mkdir(bin);
        await writeFile(
            join(bin, "gh"),
            `#!/bin/sh\nexec '${process.execPath}' '${join(root, "tests/helpers/fake-release-github.mjs")}' "$@"\n`,
            { mode: 0o700 },
        );
        const state = join(repository.directory, "github-state.json");
        const calls = join(repository.directory, "github-calls.jsonl");
        const tree = git("rev-parse", `${release}^{tree}`);
        await writeFile(
            state,
            JSON.stringify({
                commit: release,
                source,
                main: source,
                previousSource: previous,
                tree,
                gitCommits: {
                    [release]: {
                        sha: release,
                        tree: { sha: tree },
                        message: git("show", "-s", "--format=%B", release),
                        parents: [{ sha: previous }, { sha: source }],
                    },
                    [source]: { sha: source, tree: { sha: tree } },
                    [previous]: {
                        sha: previous,
                        tree: { sha: git("rev-parse", `${previous}^{tree}`) },
                        message: "Previous main source",
                    },
                },
                release: {
                    tag_name: "v0.1.0",
                    draft: false,
                    prerelease: false,
                    published_at: "date",
                },
                mainComparison: { status: "identical" },
                sourceComparison: { status: "ahead" },
                stableRefs: [
                    {
                        ref: "refs/heads/stable",
                        object: { type: "commit", sha: previous },
                    },
                ],
            }),
        );
        const promotion = spawnSync(
            process.execPath,
            [join(root, "scripts/promote-stable.mjs"), "v0.1.0", release],
            {
                cwd: repository.checkout,
                env: {
                    ...process.env,
                    PATH: bin,
                    GH_REPO: "example/plugin",
                    FAKE_RELEASE_STATE: state,
                    FAKE_RELEASE_CALLS: calls,
                },
                encoding: "utf8",
                timeout: 10_000,
            },
        );
        expect(promotion.status, promotion.stderr).toBe(0);
        const apiCalls = (await readFile(calls, "utf8"))
            .trim()
            .split("\n")
            .map(
                (line) =>
                    JSON.parse(line) as { args: string[]; input?: string },
            );
        const writes = apiCalls.filter((call) =>
            call.args.includes("--method"),
        );
        expect(writes).toHaveLength(1);
        expect(writes[0]?.args).toContain("PATCH");
        const update = JSON.parse(writes[0]?.input ?? "null") as {
            sha: string;
            force: boolean;
        };
        expect(update).toEqual({ sha: release, force: false });
        expect(git("merge-base", "--is-ancestor", previous, update.sha)).toBe(
            "",
        );
        git(
            "--git-dir",
            repository.remote,
            "update-ref",
            "refs/heads/stable",
            update.sha,
            previous,
        );
        expect(git("--git-dir", repository.remote, "rev-parse", "stable")).toBe(
            git("--git-dir", repository.remote, "rev-parse", "v0.1.0^{commit}"),
        );
    });

    test.each(["snapshot", "merge"])(
        "Supports an existing %s release with source-tagged history",
        (kind) => {
            const source = git("rev-parse", "HEAD");
            const tree = git("rev-parse", "HEAD^{tree}");
            const initial = git(
                "commit-tree",
                tree,
                "-m",
                "Initial stable release",
            );
            const previous = git(
                "commit-tree",
                tree,
                "-p",
                initial,
                ...(kind === "merge" ? ["-p", source] : []),
                "-m",
                `Release v0.0.9\n\nSource-Commit: ${source}`,
            );
            git("tag", "v0.0.9", source);
            git(
                "push",
                "origin",
                `${previous}:refs/heads/stable`,
                "refs/tags/v0.0.9",
            );
            const next = advanceMain();
            const result = tag();
            expect(result.status, result.stderr).toBe(0);
            expectRelease(next, previous);
        },
    );

    test("Pushes only the chosen tag when explicitly requested", () => {
        git("tag", "-a", "v9.0.0", "-m", "Unrelated tag");
        git("config", "push.followTags", "true");
        const result = tag(["0.1.0", "--push"]);
        expect(result.status, result.stderr).toBe(0);
        expect(remoteTag()).toContain("refs/tags/v0.1.0");
        expect(git("ls-remote", "--tags", "origin", "refs/tags/v9.0.0")).toBe(
            "",
        );
    });

    test("Uses the selected source even if main has advanced", () => {
        const selected = git("rev-parse", "HEAD");
        advanceMain();
        git("checkout", "--detach", selected);
        const result = tag();
        expect(result.status, result.stderr).toBe(0);
        expectRelease(selected);
    });

    test("Uses main as source when stable is the default branch", () => {
        const previous = git("rev-parse", "HEAD");
        git("push", "origin", "HEAD:refs/heads/stable");
        git(
            "--git-dir",
            repository.remote,
            "symbolic-ref",
            "HEAD",
            "refs/heads/stable",
        );
        const source = advanceMain();
        const result = tag();
        expect(result.status, result.stderr).toBe(0);
        expectRelease(source, previous);
    });

    test("Rejects stable source off main even when on the default branch", async () => {
        git("checkout", "-b", "stable");
        repository.commit("feat: off-main work");
        git("push", "origin", "stable");
        git(
            "--git-dir",
            repository.remote,
            "symbolic-ref",
            "HEAD",
            "refs/heads/stable",
        );
        await expectNoTag("main");
    });

    test("Rejects a stable release until its source is merged", async () => {
        git("checkout", "-b", "release/prepare-0.1.0");
        repository.commit("chore: prepare v0.1.0");
        await expectNoTag("main");
    });

    test("Keeps prerelease tags on the selected feature source", async () => {
        git("checkout", "-b", "feature");
        await setFixtureVersion(repository.checkout, "0.2.0-rc.1");
        await writeFile(
            join(repository.checkout, "CHANGELOG.md"),
            "## [0.2.0-rc.1]\n\nPreview notes.\n",
        );
        const head = repository.commit("feat: preview work");
        const result = tag(["0.2.0-rc.1"]);
        expect(result.status, result.stderr).toBe(0);
        expect(git("rev-parse", "v0.2.0-rc.1^{commit}")).toBe(head);
        expect(git("ls-remote", "--tags", "origin")).toBe("");
    });

    test("Rejects uncommitted edits", async () => {
        await writeFile(
            join(repository.checkout, "review.txt"),
            "Uncommitted edit",
        );
        await expectNoTag("clean");
    });
    test("Rejects mismatched versions", async () => {
        await setFixtureVersion(repository.checkout, "0.2.0");
        repository.commit("chore: version change");
        await expectNoTag("version");
    });
    test("Requires valid committed release notes", async () => {
        await writeFile(
            join(repository.checkout, "CHANGELOG.md"),
            "# Changelog\n",
        );
        repository.commit("docs: update changelog");
        await expectNoTag("CHANGELOG.md");
    });
    test("Stops when verification fails", async () => {
        await expectNoTag("verify", ["0.1.0"], "fail");
    });
    test.each(["head", "dirty"])(
        "Rechecks source after verification changes %s",
        async (effect) => {
            await expectNoTag(
                effect === "head" ? "commit changed" : "clean",
                ["0.1.0"],
                effect,
            );
        },
    );

    test("Does not push a local tag changed during verification", () => {
        advanceMain();
        expect(tag().status).toBe(0);
        const result = tag(["0.1.0", "--push"], "tag");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Tag v0.1.0 changed");
        expect(remoteTag()).toBe("");
    });

    test("Reuses a matching local candidate and preserves its annotation", async () => {
        expect(tag().status).toBe(0);
        const release = git("rev-parse", "v0.1.0^{commit}");
        git("tag", "-f", "-a", "v0.1.0", "-m", "Reviewed annotation", release);
        const object = git("rev-parse", "v0.1.0");
        await writeFile(log, "");
        const result = tag();
        expect(result.status, result.stderr).toBe(0);
        expect(git("rev-parse", "v0.1.0")).toBe(object);
        expect(await readFile(log, "utf8")).toBe("");
    });

    test("Verifies and pushes a matching lightweight release tag unchanged", async () => {
        expect(tag().status).toBe(0);
        const release = git("rev-parse", "v0.1.0^{commit}");
        git("tag", "--delete", "v0.1.0");
        git("tag", "v0.1.0", release);
        await writeFile(log, "");
        const result = tag(["0.1.0", "--push"]);
        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(log, "utf8")).toBe("run verify\n");
        expect(git("cat-file", "-t", "refs/tags/v0.1.0")).toBe("commit");
        expect(remoteTag()).toBe(`${release}\trefs/tags/v0.1.0`);
    });

    test("Treats a matching remote release tag as a no-op", () => {
        expect(tag(["0.1.0", "--push"]).status).toBe(0);
        const before = remoteTag();
        git("tag", "--delete", "v0.1.0");
        const result = tag(["0.1.0", "--push"]);
        expect(result.status, result.stderr).toBe(0);
        expect(remoteTag()).toBe(before);
        expect(result.stdout).toContain("already");
    });

    test("Leaves historical published source tags unchanged", () => {
        git("tag", "-a", "v0.1.0", "-m", "Published source tag");
        git("push", "origin", "refs/tags/v0.1.0");
        const before = remoteTag();
        git("tag", "--delete", "v0.1.0");
        const result = tag(["0.1.0", "--push"]);
        expect(result.status, result.stderr).toBe(0);
        expect(remoteTag()).toBe(before);
        expect(git("rev-parse", "v0.1.0^{commit}")).toBe(
            git("rev-parse", "HEAD"),
        );
    });

    test.each(["local", "remote"])("Refuses a conflicting %s tag", (where) => {
        const selected = git("rev-parse", "HEAD");
        advanceMain();
        expect(
            tag(where === "remote" ? ["0.1.0", "--push"] : ["0.1.0"]).status,
        ).toBe(0);
        const object = git("rev-parse", "v0.1.0");
        if (where === "remote") git("tag", "--delete", "v0.1.0");
        git("checkout", "--detach", selected);
        const result = tag(["0.1.0", "--push"]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("different commit");
        if (where === "local") expect(git("rev-parse", "v0.1.0")).toBe(object);
        else expect(remoteTag()).toContain(object);
    });

    test("Refuses a new stable tag directly on source", () => {
        git("tag", "v0.1.0");
        const result = tag(["0.1.0", "--push"]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("release commit");
        expect(remoteTag()).toBe("");
    });

    test("Leaves the local candidate intact after push failure and retries the same commit", async () => {
        const hooks = join(repository.directory, "hooks");
        await mkdir(hooks);
        git("--git-dir", repository.remote, "config", "core.hooksPath", hooks);
        await writeFile(join(hooks, "pre-receive"), "#!/bin/sh\nexit 1\n", {
            mode: 0o700,
        });
        const result = tag(["0.1.0", "--push"]);
        expect(result.status).not.toBe(0);
        expect(localTag()).toBe("v0.1.0");
        expect(remoteTag()).toBe("");
        const object = git("rev-parse", "v0.1.0");
        await writeFile(join(hooks, "pre-receive"), "#!/bin/sh\nexit 0\n");
        const retry = tag(["0.1.0", "--push"]);
        expect(retry.status, retry.stderr).toBe(0);
        expect(remoteTag()).toContain(object);
    });

    test("Rejects a pending candidate when stable changes during verification", () => {
        advanceMain();
        expect(tag().status).toBe(0);
        const object = git("rev-parse", "v0.1.0");
        const result = tag(["0.1.0", "--push"], "stable");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Stable changed");
        expect(git("rev-parse", "v0.1.0")).toBe(object);
        expect(remoteTag()).toBe("");
    });

    test.each(["equal", "older"])(
        "Rejects source that is %s to the current stable source",
        (kind) => {
            const selected = git("rev-parse", "HEAD");
            if (kind === "older") advanceMain();
            git("push", "origin", "HEAD:refs/heads/stable");
            git("checkout", "--detach", selected);
            const result = tag();
            expect(result.status).not.toBe(0);
            expect(result.stderr).toMatch(/already contains|does not advance/);
            expect(localTag()).toBe("");
        },
    );

    test("Does not create a tag when origin is unavailable", async () => {
        git(
            "remote",
            "set-url",
            "origin",
            join(repository.directory, "absent.git"),
        );
        const result = tag();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("git");
        expect(localTag()).toBe("");
        expect(await readFile(log, "utf8").catch(() => "")).toBe("");
    });
    test.each([
        { args: ["v0.1.0"] },
        { args: ["0.1.0", "--unknown"] },
        { args: ["0.1.0", "--push", "--push"] },
    ])("Rejects invalid arguments: %j", async ({ args }) => {
        const result = tag(args);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/Usage|SemVer/);
        expect(localTag()).toBe("");
        expect(await readFile(log, "utf8").catch(() => "")).toBe("");
    });
});
