import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";
import { copySourceFixture, setFixtureVersion } from "./helpers/release.js";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "0123456789abcdef0123456789abcdef01234567";
const tag = "v9.8.7-rc.1";
const archive = `cyclecloud-agent-plugin-${tag.slice(1)}.tar.gz`;
let workspace: string;
let assets: string;
let server: Server;
let base: string;
let mode:
    | "normal"
    | "corrupt"
    | "missing"
    | "bad-sums"
    | "wrong-latest"
    | "duplicate-sums"
    | "extra-sums"
    | "traversal"
    | "symlink"
    | "hardlink";
let requests: string[];
let auth: (string | undefined)[];

function unsafeArchive(kind: string) {
    const header = Buffer.alloc(512);
    const name =
        kind === "traversal"
            ? "cyclecloud-agent-plugin/../../escaped"
            : "cyclecloud-agent-plugin/link";
    header.write(name, 0, 100, "ascii");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("00000000000\0", 124, 12, "ascii");
    header.fill(32, 148, 156);
    header[156] = (
        kind === "symlink" ? "2" : kind === "hardlink" ? "1" : "0"
    ).charCodeAt(0);
    header.write("../../escaped", 157, 100, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(
        `${checksum.toString(8).padStart(6, "0")}\0 `,
        148,
        8,
        "ascii",
    );
    return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
}

beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "release source fixture "));
    await copySourceFixture(root, workspace);
    await setFixtureVersion(workspace, tag.slice(1));
    await execute(
        process.execPath,
        [join(workspace, "scripts/package-local.mjs")],
        { cwd: workspace },
    );
    await execute(
        process.execPath,
        [join(root, "scripts/package-release.mjs"), tag],
        {
            cwd: workspace,
            env: {
                ...process.env,
                RELEASE_SOURCE_COMMIT: commit,
                GITHUB_REPOSITORY: "gingi/cyclecloud-agent-plugin",
            },
        },
    );
    assets = join(workspace, "dist/releases");
    server = createServer((request, response) => {
        const file = request.url?.split("/").at(-1) ?? "";
        requests.push(request.url ?? "");
        auth.push(request.headers.authorization);
        void (async () => {
            if (mode === "missing" && file === archive) {
                response.writeHead(404).end("missing");
                return;
            }
            let content = await readFile(join(assets, file));
            if (file === archive && mode === "corrupt")
                content = Buffer.from("damaged archive");
            if (file === "SHA256SUMS" && mode === "bad-sums")
                content = Buffer.from("malformed checksum file\n");
            if (file === "SHA256SUMS") {
                if (mode === "wrong-latest")
                    content = Buffer.from(
                        content.toString().replace(tag.slice(1), "9.8.8"),
                    );
                if (mode === "duplicate-sums")
                    content = Buffer.concat([content, content]);
                if (mode === "extra-sums")
                    content = Buffer.from(
                        content.toString() +
                            "0".repeat(64) +
                            "  unexpected.tar.gz\n",
                    );
            }
            if (["traversal", "symlink", "hardlink"].includes(mode)) {
                const malicious = unsafeArchive(mode);
                if (file === archive) content = malicious;
                if (file === "SHA256SUMS")
                    content = Buffer.from(
                        content
                            .toString()
                            .replace(
                                /^[a-f0-9]{64}(?=  cyclecloud-agent-plugin-)/m,
                                createHash("sha256")
                                    .update(malicious)
                                    .digest("hex"),
                            ),
                    );
            }
            response.end(content);
        })().catch(() => response.writeHead(404).end("not found"));
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing fixture address");
    base = `http://127.0.0.1:${address.port}`;
}, 30_000);

beforeEach(() => {
    mode = "normal";
    requests = [];
    auth = [];
});
afterAll(async () => {
    if (server)
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    if (workspace) await rm(workspace, { recursive: true, force: true });
});
async function verify(
    expectedCommit = commit,
    latest = false,
    expectedTag = tag,
) {
    const url = `${base}/${latest ? "latest/download" : `download/${tag}`}/SHA256SUMS`;
    const moduleUrl = new URL("../scripts/verify-release.mjs", import.meta.url)
        .href;
    const poisonedHome = join(workspace, "poisoned-home");
    await mkdir(poisonedHome, { recursive: true });
    await writeFile(
        join(poisonedHome, ".curlrc"),
        'header = "Authorization: poison"\n',
    );
    return execute(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `const {verifyRelease} = await import(${JSON.stringify(moduleUrl)}); await verifyRelease(process.argv[1], process.argv[2], process.argv[3]);`,
            expectedTag,
            expectedCommit,
            url,
        ],
        {
            timeout: 30_000,
            env: {
                ...process.env,
                HOME: poisonedHome,
                GH_TOKEN: "not-for-public-download",
                GITHUB_TOKEN: "not-for-public-download",
            },
        },
    );
}

describe("Anonymous published source verification", () => {
    test("downloads checksums and source, verifies identity, and smokes relative launcher without installation", async () => {
        const result = await verify();
        expect(result.stdout).toContain("Verified anonymous source release");
        expect(result.stdout).toContain(commit);
        expect(result.stdout).toContain("No native host installation");
        expect(requests).toContain(`/download/${tag}/SHA256SUMS`);
        expect(requests).toContain(`/download/${tag}/${archive}`);
        expect(auth.every((value) => value === undefined)).toBe(true);
    }, 30_000);
    test("latest checksums use a version-pinned archive", async () => {
        await verify(commit, true);
        expect(requests).toContain(`/download/${tag}/${archive}`);
        expect(requests[0]).toBe("/latest/download/SHA256SUMS");
        expect(
            requests.filter((path) => path.startsWith("/latest/")),
        ).toHaveLength(1);
    }, 30_000);
    test("rejects the wrong source commit", async () => {
        await expect(verify("f".repeat(40))).rejects.toThrow(/commit|identity/);
    }, 30_000);
    test.each(["0123456", `${commit}\n`])(
        "rejects non-exact full commits before downloading: %j",
        async (value) => {
            await expect(verify(value)).rejects.toThrow(/full.*commit/i);
            expect(requests).toEqual([]);
        },
    );
    test("rejects latest checksums for another release", async () => {
        mode = "wrong-latest";
        await expect(verify(commit, true)).rejects.toThrow(/checksum/);
    });
    test.each(["corrupt", "bad-sums", "duplicate-sums", "extra-sums"] as const)(
        "rejects %s downloads",
        async (value) => {
            mode = value;
            await expect(verify()).rejects.toThrow(/checksum/);
        },
        30_000,
    );
    test.each(["traversal", "symlink", "hardlink"] as const)(
        "rejects checksummed archive %s before extraction",
        async (value) => {
            mode = value;
            await expect(verify()).rejects.toThrow(
                /Unsafe|Unsupported|archive/,
            );
        },
        30_000,
    );
    test("fails when a published source archive is unavailable", async () => {
        mode = "missing";
        await expect(verify()).rejects.toThrow(/404|download/);
    }, 30_000);
});
