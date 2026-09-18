import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const moduleUrl = new URL("../scripts/release-changelog.mjs", import.meta.url)
    .href;
const root = fileURLToPath(new URL("../", import.meta.url));
function extract(text: string, tag: string) {
    return spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `import fs from 'node:fs'; const { releaseNotes } = await import(${JSON.stringify(moduleUrl)}); const [text, tag] = JSON.parse(fs.readFileSync(0, 'utf8')); process.stdout.write(releaseNotes(text, tag));`,
        ],
        {
            cwd: root,
            input: JSON.stringify([text, tag]),
            encoding: "utf8",
            timeout: 10_000,
        },
    );
}

describe("Release changelog", () => {
    test("Extracts only the selected release's notes", () => {
        const result = extract(
            "# Changelog\n\n## [0.2.0]\n\nNew release.\n\n## [0.1.0-rc.2]\n\n### Added\n\nPrevious release.\n",
            "v0.1.0-rc.2",
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe("### Added\n\nPrevious release.\n");
    });
    test("Does not treat headings inside code fences as releases", () => {
        const result = extract(
            "# Changelog\n\n## [0.1.0]\n\nExample:\n```md\n## [0.2.0]\n```\n\n## [0.0.1]\n\nOlder.\n",
            "v0.1.0",
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("## [0.2.0]");
        expect(result.stdout).not.toContain("Older.");
    });
    test.each([
        "# Changelog\n\n## [0.0.1]\n\nPrevious release.\n",
        "# Changelog\n\n## [0.1.0]\n\n<!-- TODO -->\n",
        "# Changelog\n\n## [0.1.0]\n\nFirst.\n\n## [0.1.0]\n\nDuplicate.\n",
    ])("Rejects missing, empty, or ambiguous release entries", (text) => {
        const result = extract(text, "v0.1.0");
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("CHANGELOG.md");
    });
});
