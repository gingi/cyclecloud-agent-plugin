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

async function expectNoTag(message: string, args = ["0.1.0"], effect = "") {
    const result = tag(args, effect);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(localTag()).toBe("");
    expect(remoteTag()).toBe("");
    if (!effect) expect(await readFile(log, "utf8").catch(() => "")).toBe("");
}

describe("Post-review release tag", () => {
    test("Verifies the selected commit and creates an annotated tag without pushing", async () => {
        const head = git("rev-parse", "HEAD");
        const result = tag();
        expect(result.status, result.stderr).toBe(0);
        expect(git("cat-file", "-t", "refs/tags/v0.1.0")).toBe("tag");
        expect(git("rev-parse", "v0.1.0^{commit}")).toBe(head);
        expect(await readFile(log, "utf8")).toBe("run verify\n");
        expect(remoteTag()).toBe("");
        expect(git("status", "--porcelain")).toBe("");
    });

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

    test("Tags the selected merge commit even if the default branch has advanced", () => {
        const selected = git("rev-parse", "HEAD");
        repository.commit("feat: later work");
        git("push", "origin", "main");
        git("checkout", "--detach", selected);
        const result = tag();
        expect(result.status, result.stderr).toBe(0);
        expect(git("rev-parse", "v0.1.0^{commit}")).toBe(selected);
    });

    test("Accepts a newer main release when stable is the default branch", () => {
        git("push", "origin", "HEAD:refs/heads/stable");
        git(
            "--git-dir",
            repository.remote,
            "symbolic-ref",
            "HEAD",
            "refs/heads/stable",
        );
        const head = repository.commit("feat: new main release");
        git("push", "origin", "main");
        const result = tag();
        expect(result.status, result.stderr).toBe(0);
        expect(git("rev-parse", "v0.1.0^{commit}")).toBe(head);
    });

    test("Rejects a stable release off main even when on the default branch", async () => {
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

    test("Rejects a stable release until its commit is merged", async () => {
        git("checkout", "-b", "release/prepare-0.1.0");
        repository.commit("chore: prepare v0.1.0");
        await expectNoTag("main");
        expect(await readFile(log, "utf8").catch(() => "")).toBe("");
    });

    test("Accepts a committed prerelease off the default branch", async () => {
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
        repository.commit("feat: reviewed work");
        git("push", "origin", "main");
        git("tag", "v0.1.0");
        const result = tag(["0.1.0", "--push"], "tag");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Tag v0.1.0 changed");
        expect(remoteTag()).toBe("");
    });

    test("Reuses a matching local tag without overwriting its annotation", async () => {
        git("tag", "-a", "v0.1.0", "-m", "Reviewed annotation");
        const object = git("rev-parse", "v0.1.0");
        const result = tag();
        expect(result.status, result.stderr).toBe(0);
        expect(git("rev-parse", "v0.1.0")).toBe(object);
        expect(await readFile(log, "utf8").catch(() => "")).toBe("");
    });

    test("Verifies and pushes a matching lightweight tag without changing it", async () => {
        const head = git("rev-parse", "HEAD");
        git("tag", "v0.1.0");
        const object = git("rev-parse", "refs/tags/v0.1.0");
        expect(object).toBe(head);
        expect(git("cat-file", "-t", "refs/tags/v0.1.0")).toBe("commit");

        const result = tag(["0.1.0", "--push"]);

        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(log, "utf8")).toBe("run verify\n");
        expect(git("rev-parse", "refs/tags/v0.1.0")).toBe(object);
        expect(git("cat-file", "-t", "refs/tags/v0.1.0")).toBe("commit");
        expect(remoteTag()).toBe(`${object}\trefs/tags/v0.1.0`);
        expect(
            git(
                "--git-dir",
                repository.remote,
                "cat-file",
                "-t",
                "refs/tags/v0.1.0",
            ),
        ).toBe("commit");
    });

    test("Treats a matching remote tag as a no-op", () => {
        git("tag", "-a", "v0.1.0", "-m", "Published annotation");
        git("push", "origin", "refs/tags/v0.1.0");
        const before = remoteTag();
        git("tag", "--delete", "v0.1.0");
        const result = tag(["0.1.0", "--push"]);
        expect(result.status, result.stderr).toBe(0);
        expect(remoteTag()).toBe(before);
        expect(result.stdout).toContain("already");
    });

    test.each(["local", "remote"])("Refuses a conflicting %s tag", (where) => {
        const selected = git("rev-parse", "HEAD");
        repository.commit("feat: different tagged commit");
        git("tag", "v0.1.0");
        const object = git("rev-parse", "v0.1.0");
        if (where === "remote") {
            git("push", "origin", "refs/tags/v0.1.0");
            git("tag", "--delete", "v0.1.0");
        }
        git("checkout", "--detach", selected);
        const result = tag(["0.1.0", "--push"]);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("different commit");
        if (where === "local") expect(git("rev-parse", "v0.1.0")).toBe(object);
        else expect(remoteTag()).toContain(object);
    });

    test("Leaves the local tag intact after push failure and supports retry", async () => {
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
