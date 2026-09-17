import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const moduleUrl = new URL("../scripts/release-changelog.mjs", import.meta.url)
    .href;
const root = fileURLToPath(new URL("../", import.meta.url));
function invoke(
    method: "releaseNotes" | "prepareChangelog",
    ...args: string[]
) {
    return spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `import fs from 'node:fs'; const mod = await import(${JSON.stringify(moduleUrl)}); const [method, ...args] = JSON.parse(fs.readFileSync(0, 'utf8')); process.stdout.write(mod[method](...args));`,
        ],
        {
            cwd: root,
            input: JSON.stringify([method, ...args]),
            encoding: "utf8",
            timeout: 10_000,
        },
    );
}

const history =
    "# Changelog\n\n## [Unreleased]\n\nPending changes.\n\n## [0.1.0-rc.2]\n\n### Added\n\nPrevious release.\n";

describe("Release changelog", () => {
    test("Extracts only the selected release's notes", () => {
        const result = invoke("releaseNotes", history, "v0.1.0-rc.2");
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe("### Added\n\nPrevious release.\n");
    });
    test("Does not treat headings inside code fences as releases", () => {
        const result = invoke(
            "releaseNotes",
            "# Changelog\n\n## [0.1.0]\n\nExample:\n```md\n## [0.2.0]\n```\n\n## [0.0.1]\n\nOlder.\n",
            "v0.1.0",
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("## [0.2.0]");
        expect(result.stdout).not.toContain("Older.");
    });
    test.each([
        "# Changelog\n\n## [Unreleased]\n\nOnly pending notes.\n",
        "# Changelog\n\n## [0.1.0]\n\n<!-- TODO -->\n",
        "# Changelog\n\n## [0.1.0]\n\nFirst.\n\n## [0.1.0]\n\nDuplicate.\n",
    ])("Rejects missing, empty, or ambiguous release entries", (text) => {
        const result = invoke("releaseNotes", text, "v0.1.0");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("CHANGELOG.md");
    });
    test("Promotes Unreleased while preserving older releases", () => {
        const result = invoke(
            "prepareChangelog",
            history,
            "v0.1.0-rc.3",
            "Generated fallback.",
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(
            "## [Unreleased]\n\n## [0.1.0-rc.3]\n\nPending changes.",
        );
        expect(result.stdout).toContain(
            "## [0.1.0-rc.2]\n\n### Added\n\nPrevious release.",
        );
        expect(result.stdout).not.toContain("Generated fallback.");
    });
    test("Preserves an existing entry instead of overwriting edits", () => {
        const result = invoke(
            "prepareChangelog",
            history,
            "v0.1.0-rc.2",
            "Do not overwrite.",
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe(history);
    });
    test("Adds generated notes below a release heading", () => {
        const result = invoke(
            "prepareChangelog",
            "# Changelog\n\n## [Unreleased]\n",
            "v0.2.0",
            "## What's Changed\n\n- A change.\n",
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("## [0.2.0]\n\n### What's Changed");
    });
    test("Does not prepare a release with no notes", () => {
        const result = invoke(
            "prepareChangelog",
            "# Changelog\n\n## [Unreleased]\n",
            "v0.2.0",
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("CHANGELOG.md");
    });
});
