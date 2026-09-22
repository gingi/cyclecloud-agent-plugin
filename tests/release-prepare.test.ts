import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    releaseManifests,
    releaseRepository,
} from "./helpers/release-repository.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const branch = "release/prepare-0.2.0";
let repository: Awaited<ReturnType<typeof releaseRepository>>;
let workspace: string;

beforeEach(async () => {
    repository = await releaseRepository();
    workspace = repository.checkout;
});
afterEach(async () => {
    await rm(repository.directory, { recursive: true, force: true });
});

function prepare(directory = workspace, version = "0.2.0", ...args: string[]) {
    return spawnSync(
        process.execPath,
        [join(root, "scripts/prepare-release.mjs"), version, ...args],
        {
            cwd: directory,
            encoding: "utf8",
            timeout: 15_000,
        },
    );
}
function git(...args: string[]) {
    return repository.git(...args);
}
function commit(subject: string) {
    return repository.commit(subject);
}
async function readManifests() {
    return Promise.all(
        releaseManifests.map((file) => readFile(join(workspace, file), "utf8")),
    );
}
async function changelog() {
    return readFile(join(workspace, "CHANGELOG.md"), "utf8");
}
async function expectUnchangedFailure(
    message: string,
    version = "0.2.0",
    ...args: string[]
) {
    const before = await readManifests();
    const notes = await changelog();
    const previousBranch = git("branch", "--show-current");
    const head = git("rev-parse", "HEAD");
    const result = prepare(workspace, version, ...args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(await readManifests()).toEqual(before);
    expect(await changelog()).toBe(notes);
    expect(git("branch", "--show-current")).toBe(previousBranch);
    expect(git("rev-parse", "HEAD")).toBe(head);
}

describe("Release preparation", () => {
    test("Creates a branch at the selected commit and leaves preparation uncommitted", () => {
        git("tag", "v0.1.0");
        const head = commit("feat: ready for release");
        const result = prepare();
        expect(result.status, result.stderr).toBe(0);
        expect(git("branch", "--show-current")).toBe(branch);
        expect(git("rev-parse", "HEAD")).toBe(head);
        expect(git("diff", "--cached", "--name-only")).toBe("");
        expect(git("diff", "--name-only").split("\n").sort()).toEqual(
            [...releaseManifests, "CHANGELOG.md"].sort(),
        );
        expect(
            git("ls-remote", "--heads", "origin", `refs/heads/${branch}`),
        ).toBe("");
        expect(git("tag", "--list", "v0.2.0")).toBe("");
        expect(result.stdout).toContain(branch);
    });

    test("Updates versions while preserving existing notes", async () => {
        const notes =
            "# Changelog\n\n## [0.2.0]\n\n-   Preserve this formatting.\n\n## [0.1.0]\n\nPrevious release.\n";
        await writeFile(join(workspace, "CHANGELOG.md"), notes);
        commit("docs: update release notes");
        const result = prepare();
        expect(result.status, result.stderr).toBe(0);
        expect(await changelog()).toBe(notes);
        const documents = (await readManifests()).map(
            (text) => JSON.parse(text) as unknown,
        );
        expect(documents[0]).toMatchObject({ version: "0.2.0" });
        expect(documents[1]).toMatchObject({
            version: "0.2.0",
            packages: { "": { version: "0.2.0" } },
        });
        expect(documents[2]).toMatchObject({ version: "0.2.0" });
        expect(documents[3]).toMatchObject({
            metadata: { version: "0.2.0" },
            plugins: [{ version: "0.2.0" }],
        });
    });

    test.each([false, true])(
        "Drafts since fetched release tags (annotated=%s)",
        async (annotated) => {
            git("tag", ...(annotated ? ["-a", "-m", "Release"] : []), "v0.1.0");
            git("push", "origin", "v0.1.0");
            git("tag", "--delete", "v0.1.0");
            commit("feat: add cluster search");
            commit("fix: preserve user settings");
            const result = prepare();
            expect(result.status, result.stderr).toBe(0);
            expect(await changelog()).toBe(
                "# Changelog\n\n## [0.2.0]\n\n- feat: add cluster search\n- fix: preserve user settings\n\n## [0.1.0]\n\nPrevious release.\n",
            );
            expect(result.stdout).toContain("Review");
        },
    );

    test("Uses all subjects when no release tag exists", async () => {
        await writeFile(join(workspace, "CHANGELOG.md"), "# Changelog\n");
        commit("docs: update changelog");
        commit("fix: handle unavailable servers");
        expect(prepare().status).toBe(0);
        expect(await changelog()).toContain(
            "- feat: initial implementation\n- fix: handle unavailable servers",
        );
    });

    test("Uses the nearest reachable prerelease, ignoring unrelated and invalid tags", async () => {
        git("tag", "v0.1.0");
        commit("feat: already previewed");
        git("tag", "v0.2.0-rc.1");
        git("checkout", "-b", "unrelated");
        commit("feat: unrelated branch change");
        git("tag", "v9.0.0");
        git("checkout", "main");
        commit("fix: polish the preview");
        git("tag", "v-next");
        git("tag", "v02.0.0");
        expect(prepare(workspace, "0.2.0-rc.2").status).toBe(0);
        const notes = await changelog();
        expect(notes).toContain("## [0.2.0-rc.2]\n\n- fix: polish the preview");
        expect(notes).not.toContain("already previewed");
        expect(notes).not.toContain("unrelated branch");
    });

    test("Filters release bookkeeping but retains tooling improvements", async () => {
        git("tag", "v0.1.0");
        const mechanical = [
            "chore: prepare v0.1.1 (#7)",
            "Release v0.1.1",
            "chore(release): 0.1.1",
            "chore: bump version to 0.1.1",
            "Bump version from 0.1.0 to 0.1.1",
            "1.2.3",
            "docs: update changelog",
            "docs: update release notes",
        ];
        for (const subject of mechanical) commit(subject);
        const changes = [
            "feat: automate plugin release distribution",
            "fix: preserve release notes",
            "docs: explain release approvals",
            "chore: update release dependencies",
        ];
        for (const subject of changes) commit(subject);
        expect(prepare().status).toBe(0);
        const notes = await changelog();
        for (const subject of mechanical)
            expect(notes).not.toContain(`- ${subject}\n`);
        for (const subject of changes)
            expect(notes).toContain(`- ${subject}\n`);
    });

    test("Includes feature subjects without duplicate merge messages", async () => {
        git("tag", "v0.1.0");
        git("checkout", "-b", "feature");
        commit("feat: add a useful tool");
        git("checkout", "main");
        git(
            "merge",
            "--no-ff",
            "feature",
            "-m",
            "Merge pull request #42 from example/feature",
        );
        expect(prepare().status).toBe(0);
        expect(await changelog()).toContain("- feat: add a useful tool");
        expect(await changelog()).not.toContain("Merge pull request");
    });

    test("Reruns on the preparation branch preserve dirty review edits and other fields", async () => {
        expect(prepare().status).toBe(0);
        const edited = (await changelog()).replace(
            "- feat: initial implementation",
            "Hand-edited release notes.",
        );
        await writeFile(join(workspace, "CHANGELOG.md"), edited);
        await writeFile(
            join(workspace, "other-change.txt"),
            "Additional reviewed work",
        );
        const packagePath = join(workspace, "package.json");
        await writeFile(
            packagePath,
            (await readFile(packagePath, "utf8")).replace(
                '"private": true',
                '"private": false',
            ),
        );
        git("add", "other-change.txt");
        const result = prepare();
        expect(result.status, result.stderr).toBe(0);
        expect(await changelog()).toBe(edited);
        expect(JSON.parse(await readFile(packagePath, "utf8"))).toMatchObject({
            private: false,
        });
        expect(git("diff", "--cached", "--name-only")).toBe("other-change.txt");
        expect(
            await readFile(join(workspace, "other-change.txt"), "utf8"),
        ).toBe("Additional reviewed work");
    });

    test("Refuses a dirty checkout before creating a new branch", async () => {
        await writeFile(join(workspace, "unrelated.txt"), "Keep this");
        await expectUnchangedFailure("clean");
        expect(git("branch", "--list", branch)).toBe("");
    });

    test.each(["local", "remote"])(
        "Does not overwrite an existing %s preparation branch",
        async (where) => {
            if (where === "local") git("branch", branch);
            else git("push", "origin", `HEAD:refs/heads/${branch}`);
            await expectUnchangedFailure("already exists");
        },
    );

    test.each(["local", "remote"])(
        "Rejects an already tagged version (%s)",
        async (where) => {
            git("tag", "v0.2.0");
            if (where === "remote") {
                git("push", "origin", "v0.2.0");
                git("tag", "--delete", "v0.2.0");
            }
            await expectUnchangedFailure("already exists");
        },
    );

    test("Requires an attached branch", async () => {
        git("checkout", "--detach");
        await expectUnchangedFailure("branch");
    });

    test("Refuses an unavailable origin without creating a branch or changing files", async () => {
        git(
            "remote",
            "set-url",
            "origin",
            join(repository.directory, "absent.git"),
        );
        await expectUnchangedFailure("git");
        expect(git("branch", "--list", branch)).toBe("");
    });

    test("Rejects invalid arguments before preparing files", async () => {
        await expectUnchangedFailure("SemVer", "v0.2.0");
        await expectUnchangedFailure("Usage", "0.2.0", "--unknown");
    });

    test("Refuses an empty draft before creating the preparation branch", async () => {
        git("tag", "v0.1.0");
        commit("chore: prepare v0.1.1");
        await expectUnchangedFailure("No changelog subjects");
        expect(git("branch", "--list", branch)).toBe("");
    });

    test("Requires complete history for automatic drafting", async () => {
        git("tag", "v0.1.0");
        commit("feat: more history");
        const shallow = join(repository.directory, "shallow");
        git("clone", "--quiet", "--depth=1", `file://${workspace}`, shallow);
        const before = await readFile(join(shallow, "package.json"), "utf8");
        const result = prepare(shallow);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("shallow");
        expect(await readFile(join(shallow, "package.json"), "utf8")).toBe(
            before,
        );
    });

    test.each([
        "## [0.2.0]\n\n<!-- TODO -->\n",
        "## [0.2.0]\n\nFirst.\n\n## [0.2.0]\n\nDuplicate.\n",
    ])(
        "Refuses invalid existing notes without overwriting: %s",
        async (notes) => {
            await writeFile(join(workspace, "CHANGELOG.md"), notes);
            commit("docs: update changelog");
            await expectUnchangedFailure("[0.2.0]");
        },
    );
});
