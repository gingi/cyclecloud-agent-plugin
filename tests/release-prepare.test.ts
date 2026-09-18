import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifests = [
    "package.json",
    "package-lock.json",
    "plugin.json",
    ".github/plugin/marketplace.json",
];
let workspace: string;

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "release preparation "));
    for (const file of [...manifests, ".prettierrc.json"]) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await cp(join(root, file), join(workspace, file));
    }
});

afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
});

function prepare(directory = workspace, version = "0.2.0") {
    return spawnSync(
        process.execPath,
        [join(root, "scripts/prepare-release.mjs"), version],
        { cwd: directory, encoding: "utf8", timeout: 10_000 },
    );
}

function git(...args: string[]) {
    const result = spawnSync("git", ["-C", workspace, ...args], {
        encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
}

async function history() {
    await writeFile(
        join(workspace, "CHANGELOG.md"),
        "# Changelog\n\n## [0.1.0]\n\nPrevious release.\n",
    );
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    git("config", "core.hooksPath", "/dev/null");
    git("add", ".");
    git("commit", "--quiet", "-m", "feat: initial implementation");
}

function commit(subject: string) {
    git("commit", "--quiet", "--allow-empty", "-m", subject);
}

async function readManifests() {
    return Promise.all(
        manifests.map((file) => readFile(join(workspace, file), "utf8")),
    );
}

async function changelog() {
    return readFile(join(workspace, "CHANGELOG.md"), "utf8");
}

async function expectUnchangedFailure(message: string, directory = workspace) {
    const before = await readManifests();
    const notes = await changelog();
    const result = prepare(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(await readManifests()).toEqual(before);
    expect(await changelog()).toBe(notes);
}

describe("Release preparation", () => {
    test("Updates manifest versions without rewriting an existing entry or requiring Git", async () => {
        const notes =
            "# Changelog\n\n## [0.2.0]\n\n-   Preserve this formatting.\n\n## [0.1.0]\n\nPrevious release.\n";
        await writeFile(join(workspace, "CHANGELOG.md"), notes);
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
        "Drafts subjects since the nearest release (annotated=%s)",
        async (annotated) => {
            await history();
            git("tag", ...(annotated ? ["-a", "-m", "Release"] : []), "v0.1.0");
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

    test("Uses all committed subjects when no release tag exists", async () => {
        await history();
        await writeFile(join(workspace, "CHANGELOG.md"), "# Changelog\n");
        commit("fix: handle unavailable servers");
        expect(prepare().status).toBe(0);
        expect(await changelog()).toContain(
            "- feat: initial implementation\n- fix: handle unavailable servers",
        );
    });

    test("Uses the nearest reachable prerelease, ignoring unrelated and invalid tags", async () => {
        await history();
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

    test("Filters mechanical release subjects but retains release-tooling improvements", async () => {
        await history();
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

    test("Includes merged feature subjects without duplicate merge messages", async () => {
        await history();
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

    test("Preserves reviewer edits on subsequent preparation", async () => {
        await history();
        git("tag", "v0.1.0");
        commit("feat: draft this subject");
        expect(prepare().status).toBe(0);
        const edited = (await changelog()).replace(
            "- feat: draft this subject",
            "Hand-edited release notes.",
        );
        await writeFile(join(workspace, "CHANGELOG.md"), edited);
        commit("fix: subsequent change");
        expect(prepare().status).toBe(0);
        expect(await changelog()).toBe(edited);
    });

    test("Refuses an empty draft without changing files", async () => {
        await history();
        git("tag", "v0.1.0");
        commit("chore: prepare v0.1.1");
        await expectUnchangedFailure("No changelog subjects");
    });

    test("Fails on missing Git history rather than inventing notes", async () => {
        await writeFile(join(workspace, "CHANGELOG.md"), "# Changelog\n");
        await expectUnchangedFailure("git");
    });

    test("Requires complete history for automatic drafting", async () => {
        await history();
        git("tag", "v0.1.0");
        commit("feat: more history");
        const shallow = join(workspace, "shallow");
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
        "Refuses empty or duplicate existing entries without overwriting: %s",
        async (notes) => {
            await writeFile(join(workspace, "CHANGELOG.md"), notes);
            await expectUnchangedFailure("[0.2.0]");
        },
    );
});
