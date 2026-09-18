import { execFileSync } from "node:child_process";
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

function isVersionTag(tag) {
    try {
        versionFromTag(tag);
        return true;
    } catch {
        return false;
    }
}

function isReleaseBookkeeping(subject) {
    const title = subject
        .replace(/\s+\(#\d+\)$/, "")
        .replace(/^(?:chore|build|docs)(?:\([^)]+\))?:\s*/i, "");
    if (/^update (?:the )?(?:changelog|release notes)$/i.test(title))
        return true;
    const version = title.replace(
        /^(?:(?:prepare|publish|release)(?: release)?|bump(?: (?:package )?version)?(?: from \S+)?(?: to)?|version)\s+/i,
        "",
    );
    return isVersionTag(version.startsWith("v") ? version : `v${version}`);
}

function commitSubjects(root) {
    const git = (...args) =>
        execFileSync("git", args, {
            cwd: root,
            encoding: "utf8",
            timeout: 30_000,
        }).trim();
    if (git("rev-parse", "--is-shallow-repository") === "true")
        throw new Error(
            "Cannot draft from shallow history; fetch full history and tags first",
        );
    const head = git("rev-parse", "HEAD");
    const tags = git("tag", "--list", "--merged", head, "v*")
        .split("\n")
        .filter(isVersionTag);
    const base = tags.length
        ? git(
              "describe",
              "--tags",
              "--abbrev=0",
              `--candidates=${tags.length}`,
              ...tags.flatMap((tag) => ["--match", tag]),
              head,
          )
        : undefined;
    return git(
        "log",
        "--reverse",
        "--no-merges",
        "--format=%s",
        base ? `${base}..${head}` : head,
    )
        .split("\n")
        .filter((subject) => subject && !isReleaseBookkeeping(subject));
}

export async function draftChangelog(root, tag) {
    const version = versionFromTag(tag);
    const text = await readChangelog(root);
    if (section(text, version)) {
        releaseNotes(text, tag);
        return undefined;
    }
    const subjects = commitSubjects(root);
    if (!subjects.length)
        throw new Error(
            `No changelog subjects to draft; add notes under ## [${version}] in CHANGELOG.md`,
        );
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    const start = sections(text)[0]?.start ?? lines.length;
    const before = lines.slice(0, start).join("\n").trimEnd() || "# Changelog";
    const after = lines.slice(start).join("\n").trim();
    return (
        [
            before,
            `## [${version}]\n\n${subjects.map((subject) => `- ${subject}`).join("\n")}`,
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
