import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { packageName } from "./package-layout.mjs";
import { verifyPackage } from "./verify-package.mjs";
import { versionFromTag } from "./release-version.mjs";

const maxArchiveBytes = 32 * 1024 * 1024;

// Parse only the ustar regular files/directories emitted by package-release.
// Reject links, special files, extension headers, duplicate paths and traversal
// before any archive member is written. Do not ask system tar to trust input.
export async function extractSourceArchive(archive, destination) {
    const data = gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 });
    const entries = [];
    const seen = new Set();
    let offset = 0;
    let terminated = false;
    while (offset + 512 <= data.length) {
        const header = data.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) {
            if (
                data.length - offset < 1024 ||
                !data.subarray(offset).every((byte) => byte === 0)
            )
                throw new Error("Invalid archive terminator");
            terminated = true;
            break;
        }
        const text = (start, length) =>
            header
                .subarray(start, start + length)
                .toString("utf8")
                .split("\0")[0];
        const octal = (start, length) => {
            const value = text(start, length).trim();
            if (!/^[0-7]+$/.test(value))
                throw new Error("Unsupported archive numeric field");
            const number = Number.parseInt(value, 8);
            if (!Number.isSafeInteger(number))
                throw new Error("Invalid archive numeric field");
            return number;
        };
        const checksum = header.reduce(
            (sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte),
            0,
        );
        if (checksum !== octal(148, 8))
            throw new Error("Invalid archive header checksum");
        const prefix = text(345, 155);
        const name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`.replace(
            /\/$/,
            "",
        );
        if (
            !name ||
            name.includes("\\") ||
            /[\x00-\x1f\x7f]/.test(name) ||
            name.split("/").some((part) => ["", ".", ".."].includes(part)) ||
            (name !== packageName && !name.startsWith(`${packageName}/`)) ||
            seen.has(name)
        )
            throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
        seen.add(name);
        const type = header[156];
        if (![0, 48, 53].includes(type))
            throw new Error(`Unsupported archive entry type: ${type}`);
        const size = octal(124, 12);
        const mode = octal(100, 8);
        if (
            size > maxArchiveBytes ||
            (type === 53 && size !== 0) ||
            offset + 512 + size > data.length
        )
            throw new Error("Invalid archive entry size");
        entries.push({
            name,
            directory: type === 53,
            mode: mode & 0o111 ? 0o755 : 0o644,
            body: data.subarray(offset + 512, offset + 512 + size),
        });
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (!terminated || entries.length === 0)
        throw new Error("Truncated or empty source archive");
    const files = new Set(
        entries.filter((entry) => !entry.directory).map((entry) => entry.name),
    );
    for (const entry of entries) {
        let parent = dirname(entry.name);
        while (parent !== ".") {
            if (files.has(parent))
                throw new Error("Unsafe archive file/directory collision");
            parent = dirname(parent);
        }
    }
    for (const entry of entries) {
        const target = join(destination, entry.name);
        if (entry.directory) await mkdir(target, { recursive: true });
        else {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, entry.body, {
                flag: "wx",
                mode: entry.mode,
            });
        }
    }
}

function download(url, output, home) {
    const parsed = new URL(url);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
    if (
        parsed.username ||
        parsed.password ||
        (parsed.protocol !== "https:" &&
            !(local && parsed.protocol === "http:"))
    )
        throw new Error(
            "Public downloads require HTTPS (HTTP is permitted only for local test servers)",
        );
    // -q disables curlrc; a fresh HOME and explicit environment omit tokens,
    // netrc, proxy credentials and any real host configuration.
    const result = spawnSync(
        "curl",
        [
            "-q",
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--proto",
            local ? "=http,https" : "=https",
            "--proto-redir",
            "=https",
            "--retry",
            "2",
            "--retry-delay",
            "1",
            "--connect-timeout",
            "10",
            "--max-time",
            "45",
            "--max-filesize",
            String(maxArchiveBytes),
            "--output",
            output,
            url,
        ],
        {
            cwd: home,
            env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" },
            encoding: "utf8",
            timeout: 150_000,
        },
    );
    if (result.error || result.status !== 0)
        throw new Error(
            `Public source download failed: ${result.error?.message ?? result.stderr}`,
        );
}

function verifyChecksums(sums, files) {
    const entries = new Map();
    for (const line of sums.trimEnd().split("\n")) {
        const match = /^([a-f0-9]{64})  ([A-Za-z0-9.-]+)$/.exec(line);
        if (!match || entries.has(match[2]))
            throw new Error("Malformed or duplicate release checksum");
        entries.set(match[2], match[1]);
    }
    if (entries.size !== files.size)
        throw new Error("Unexpected release checksum inventory");
    for (const [name, content] of files)
        if (
            entries.get(name) !==
            createHash("sha256").update(content).digest("hex")
        )
            throw new Error(`Release checksum verification failed for ${name}`);
}

export async function verifyRelease(tag, commit, checksumsUrl) {
    const version = versionFromTag(tag);
    if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
        throw new Error("Expected the full released commit SHA");
    const url = new URL(checksumsUrl);
    if (!url.pathname.endsWith("/SHA256SUMS") || url.search || url.hash)
        throw new Error("Expected a public SHA256SUMS asset URL");
    const base = new URL(".", url);
    if (base.pathname.endsWith("/latest/download/"))
        base.pathname = `${base.pathname.slice(0, -"latest/download/".length)}download/${tag}/`;
    else if (!base.pathname.endsWith(`/download/${tag}/`))
        throw new Error("Release URL does not match the expected version");
    const home = await mkdtemp(join(tmpdir(), "cyclecloud-source-release-"));
    try {
        const sumsPath = join(home, "SHA256SUMS");
        download(url.href, sumsPath, home);
        const name = `${packageName}-${version}.tar.gz`;
        download(new URL(name, base).href, join(home, name), home);
        const archive = await readFile(join(home, name));
        verifyChecksums(
            await readFile(sumsPath, "utf8"),
            new Map([[name, archive]]),
        );
        const extracted = join(home, "extracted");
        await mkdir(extracted);
        await extractSourceArchive(archive, extracted);
        const directory = join(extracted, packageName);
        const plugin = await verifyPackage(directory);
        const metadata = JSON.parse(
            await readFile(join(directory, "SOURCE_COMMIT.json"), "utf8"),
        );
        if (
            plugin.version !== version ||
            metadata.version !== version ||
            metadata.sourceRef !== tag ||
            metadata.sourceCommit !== commit ||
            metadata.checkoutCommit !== commit
        )
            throw new Error(
                "Released source identity/commit does not match the published build",
            );
        process.stdout.write(
            `Verified anonymous source release ${tag} (${commit}): checksums, source identity, layout and isolated launcher smoke.\nNo native host installation was performed or validated.\n`,
        );
    } finally {
        await rm(home, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        const [tag, commit, option] = process.argv.slice(2);
        versionFromTag(tag);
        if (
            process.argv.length < 4 ||
            process.argv.length > 5 ||
            (option && option !== "--latest")
        )
            throw new Error(
                "Usage: npm run verify:release -- <tag> <commit> [--latest]",
            );
        const repository =
            process.env.GITHUB_REPOSITORY ?? "gingi/cyclecloud-agent-plugin";
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
            throw new Error("Invalid release repository");
        const ref =
            option === "--latest" ? "latest/download" : `download/${tag}`;
        await verifyRelease(
            tag,
            commit,
            `https://github.com/${repository}/releases/${ref}/SHA256SUMS`,
        );
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
