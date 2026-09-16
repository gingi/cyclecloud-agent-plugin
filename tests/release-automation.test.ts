import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "0123456789abcdef0123456789abcdef01234567";
let workspace: string;
const files = [
    "package.json",
    "package-lock.json",
    "plugin.json",
    ".github/plugin/marketplace.json",
];

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "release automation "));
    for (const file of files) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await cp(join(root, file), join(workspace, file));
    }
});
afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
});

function run(script: string, args: string[], env = {}) {
    return spawnSync(
        process.execPath,
        [join(root, "scripts", script), ...args],
        {
            cwd: workspace,
            encoding: "utf8",
            timeout: 10_000,
            env: { ...process.env, ...env },
        },
    );
}

describe("Release preparation", () => {
    test("Updates every release version without creating a commit or tag", async () => {
        const result = run("prepare-release.mjs", ["0.2.0-rc.1"]);
        expect(result.status, result.stderr).toBe(0);
        const checked = run("package-release.mjs", ["--check", "v0.2.0-rc.1"]);
        expect(checked.status, checked.stderr).toBe(0);
        const manifest = JSON.parse(
            await readFile(join(workspace, "package.json"), "utf8"),
        ) as { private: boolean };
        expect(manifest.private).toBe(true);
        expect(result.stdout).toContain("not committed");
    });
    test.each(["v0.2.0", "0.2", "0.2.0-01", "../bad"])(
        "Rejects invalid version %s without edits",
        async (version) => {
            const before = await Promise.all(
                files.map((file) => readFile(join(workspace, file), "utf8")),
            );
            const result = run("prepare-release.mjs", [version]);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("version");
            expect(
                await Promise.all(
                    files.map((file) =>
                        readFile(join(workspace, file), "utf8"),
                    ),
                ),
            ).toEqual(before);
        },
    );
});

describe("Release tag creation", () => {
    async function tag(
        state: { existing?: boolean; target?: string; fail?: boolean },
        args = ["v0.1.0", commit],
    ) {
        const bin = join(workspace, "commands");
        await mkdir(bin);
        const calls = join(workspace, "calls.jsonl");
        const fake = join(workspace, "gh.mjs");
        await writeFile(
            fake,
            `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const state = JSON.parse(process.env.STATE);
if (state.fail) process.exit(1);
if (args.some(a => a.includes('matching-refs'))) console.log(JSON.stringify(state.existing ? [{ref:'refs/tags/v0.1.0',object:{sha:'annotation'}}] : []));
else if (args.some(a => a.includes('/commits/'))) console.log(JSON.stringify({sha:state.target}));
else console.log('{}');
`,
        );
        await writeFile(
            join(bin, "gh"),
            `#!/bin/sh\nexec '${process.execPath}' '${fake}' "$@"\n`,
            { mode: 0o700 },
        );
        const result = run("tag-release.mjs", args, {
            PATH: bin,
            GH_REPO: "gingi/cyclecloud-mcp",
            CALLS: calls,
            STATE: JSON.stringify(state),
        });
        return {
            result,
            calls: (await readFile(calls, "utf8").catch(() => ""))
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line) as string[]),
        };
    }
    test("Creates a new tag at the verified commit", async () => {
        const value = await tag({});
        expect(value.result.status, value.result.stderr).toBe(0);
        expect(value.calls).toContainEqual([
            "api",
            "--method",
            "POST",
            "repos/gingi/cyclecloud-mcp/git/refs",
            "-f",
            "ref=refs/tags/v0.1.0",
            "-f",
            `sha=${commit}`,
        ]);
    });
    test("Reuses an existing tag only when its peeled commit matches", async () => {
        const value = await tag({ existing: true, target: commit });
        expect(value.result.status, value.result.stderr).toBe(0);
        expect(value.calls).toContainEqual([
            "api",
            "repos/gingi/cyclecloud-mcp/commits/refs%2Ftags%2Fv0.1.0",
        ]);
        expect(value.calls.some((args) => args.includes("POST"))).toBe(false);
    });
    test("Refuses to move an existing tag", async () => {
        const value = await tag({ existing: true, target: "f".repeat(40) });
        expect(value.result.status).not.toBe(0);
        expect(value.result.stderr).toContain("different commit");
        expect(value.calls.some((args) => args.includes("POST"))).toBe(false);
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
