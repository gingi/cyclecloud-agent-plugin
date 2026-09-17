import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { versionFromTag } from "./release-version.mjs";

function sections(text) {
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    const entries = [];
    let fence;
    let comment = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!fence && (comment || line.includes("<!--"))) {
            comment = !line.includes("-->");
            continue;
        }
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (marker) {
            if (!fence) fence = marker[1];
            else if (
                marker[1][0] === fence[0] &&
                marker[1].length >= fence.length &&
                !marker[2].trim()
            )
                fence = undefined;
            continue;
        }
        if (!fence && /^##\s/.test(line)) {
            const heading =
                /^## \[([^\]]+)\](?: - \d{4}-\d{2}-\d{2})?\s*$/.exec(line);
            entries.push({ label: heading?.[1], start: i });
        }
    }
    return entries.map((entry, i) => ({
        ...entry,
        end: entries[i + 1]?.start ?? lines.length,
        lines,
    }));
}

function section(text, label) {
    const matches = sections(text).filter((entry) => entry.label === label);
    if (matches.length > 1)
        throw new Error(`CHANGELOG.md has duplicate [${label}] entries`);
    return matches[0];
}

function body(entry) {
    return entry.lines
        .slice(entry.start + 1, entry.end)
        .join("\n")
        .trim();
}

function hasNotes(notes) {
    return notes.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
}

export function releaseNotes(text, tag) {
    const version = versionFromTag(tag);
    const entry = section(text, version);
    if (!entry || !hasNotes(body(entry)))
        throw new Error(
            `CHANGELOG.md needs nonempty notes under ## [${version}]`,
        );
    return `${body(entry)}\n`;
}

export function prepareChangelog(text, tag, generatedNotes = "") {
    const version = versionFromTag(tag);
    if (section(text, version)) {
        releaseNotes(text, tag);
        return text;
    }
    const pending = section(text, "Unreleased");
    const pendingNotes = pending ? body(pending) : "";
    // GitHub's generated headings belong below the version heading.
    const notes = hasNotes(pendingNotes)
        ? pendingNotes
        : generatedNotes.trim().replace(/^##(?=\s)/gm, "###");
    if (!hasNotes(notes))
        throw new Error(
            "Add release notes to CHANGELOG.md under ## [Unreleased] before preparing the version",
        );
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    const start = pending
        ? pending.start + 1
        : (sections(text)[0]?.start ?? lines.length);
    const end = pending?.end ?? start;
    const before = lines.slice(0, start).join("\n").trimEnd() || "# Changelog";
    const after = lines.slice(end).join("\n").trim();
    return (
        [
            before,
            ...(pending ? [] : ["## [Unreleased]"]),
            `## [${version}]\n\n${notes}`,
            after,
        ]
            .filter(Boolean)
            .join("\n\n") + "\n"
    );
}

export async function readChangelog(root) {
    const path = join(root, "CHANGELOG.md");
    if (!(await lstat(path)).isFile())
        throw new Error("CHANGELOG.md must be a regular file, not a symlink");
    return readFile(path, "utf8");
}

export async function readReleaseNotes(root, tag) {
    return releaseNotes(await readChangelog(root), tag);
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        if (process.argv.length !== 3)
            throw new Error("Usage: node scripts/release-changelog.mjs <tag>");
        process.stdout.write(
            await readReleaseNotes(process.cwd(), process.argv[2]),
        );
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
