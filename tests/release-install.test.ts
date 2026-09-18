import { execFile } from "node:child_process";
import {
    cp,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "0123456789abcdef0123456789abcdef01234567";
let workspace: string;
let tag: string;
let assets: string;
let server: Server;
let base: string;
let mode: "normal" | "corrupt" | "missing" | "bad-sums";
let requests: string[];

beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "release curl fixture "));
    for (const file of [
        "package.json",
        "package-lock.json",
        "plugin.json",
        ".github/plugin/marketplace.json",
    ]) {
        await mkdir(dirname(join(workspace, file)), { recursive: true });
        await cp(join(root, file), join(workspace, file));
    }
    await writeFile(
        join(workspace, "CHANGELOG.md"),
        "# Changelog\n\n## [9.8.7-rc.1]\n\nRelease installation test.\n",
    );
    // Prepare a different version and build it, so a hardcoded runtime version cannot pass.
    tag = "v9.8.7-rc.1";
    await cp(
        join(root, ".prettierrc.json"),
        join(workspace, ".prettierrc.json"),
    );
    await execute(
        process.execPath,
        [join(root, "scripts/prepare-release.mjs"), tag.slice(1)],
        { cwd: workspace },
    );
    await cp(join(root, "src"), join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "scripts"));
    await cp(
        join(root, "scripts/build.mjs"),
        join(workspace, "scripts/build.mjs"),
    );
    await symlink(join(root, "node_modules"), join(workspace, "node_modules"));
    await execute(process.execPath, [join(workspace, "scripts/build.mjs")], {
        cwd: workspace,
    });
    for (const file of [
        "plugin.json",
        "bin/cyclecloud-mcp.mjs",
        "cyclecloud.example.json",
        "LICENSE",
        "install.sh",
        ".github/plugin/marketplace.json",
        "skills",
    ]) {
        const destination = join(workspace, "dist/cyclecloud-mcp", file);
        await mkdir(dirname(destination), { recursive: true });
        const source = [
            "plugin.json",
            "bin/cyclecloud-mcp.mjs",
            ".github/plugin/marketplace.json",
        ].includes(file)
            ? workspace
            : root;
        await cp(join(source, file), destination, { recursive: true });
    }
    await execute(
        process.execPath,
        [join(root, "scripts/package-release.mjs"), tag],
        {
            cwd: workspace,
            env: {
                ...process.env,
                GITHUB_SHA: commit,
                GITHUB_REPOSITORY: "gingi/cyclecloud-mcp",
            },
        },
    );
    assets = join(workspace, "dist/releases");
    server = createServer((request, response) => {
        const file = request.url?.split("/").at(-1) ?? "";
        requests.push(request.url ?? "");
        void (async () => {
            if (mode === "missing" && file.endsWith(".tar.gz")) {
                response.writeHead(404).end("missing");
                return;
            }
            let content = await readFile(join(assets, file));
            if (file === "install.sh")
                content = Buffer.from(
                    content
                        .toString()
                        .replaceAll(
                            `https://github.com/gingi/cyclecloud-mcp/releases/download/${tag}`,
                            `${base}/download/${tag}`,
                        ),
                );
            if (file.endsWith(".tar.gz") && mode === "corrupt")
                content = Buffer.from("damaged archive");
            if (file === "SHA256SUMS" && mode === "bad-sums")
                content = Buffer.from("malformed checksum file\n");
            response.end(content);
        })().catch(() => {
            response.writeHead(404).end("not found");
        });
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
});
afterAll(async () => {
    if (server)
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function verify(expectedCommit = commit, latest = false) {
    const url = `${base}/${latest ? "latest/download" : `download/${tag}`}/install.sh`;
    const moduleUrl = new URL("../scripts/verify-release.mjs", import.meta.url)
        .href;
    return execute(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `const {verifyRelease} = await import(${JSON.stringify(moduleUrl)}); await verifyRelease(process.argv[1], process.argv[2], process.argv[3]);`,
            tag,
            expectedCommit,
            url,
        ],
        { timeout: 30_000 },
    );
}

describe("Published curl installation", () => {
    test("Downloads, verifies, installs, and initializes the actual packaged runtime", async () => {
        const result = await verify();
        expect(result.stdout).toContain("Verified curl installation");
        expect(result.stdout).toContain(commit);
        expect(requests).toContain(`/download/${tag}/SHA256SUMS`);
        expect(requests).toContain(
            `/download/${tag}/cyclecloud-mcp-${tag.slice(1)}.tar.gz`,
        );
    }, 30_000);
    test("Latest bootstrap pins all subsequent downloads to its embedded version", async () => {
        await verify(commit, true);
        expect(requests[0]).toBe("/latest/download/install.sh");
        expect(
            requests.filter((path) => path.startsWith("/latest/")),
        ).toHaveLength(1);
    }, 30_000);
    test("Rejects an installed build from the wrong commit", async () => {
        await expect(verify("f".repeat(40))).rejects.toThrow(/commit|identity/);
    }, 30_000);
    test.each(["corrupt", "bad-sums"] as const)(
        "Rejects %s downloads before installation",
        async (value) => {
            mode = value;
            await expect(verify()).rejects.toThrow(/checksum/);
        },
        30_000,
    );
    test("Fails on unavailable published assets rather than claiming installation succeeded", async () => {
        mode = "missing";
        await expect(verify()).rejects.toThrow(/404|download/);
    }, 30_000);
});
