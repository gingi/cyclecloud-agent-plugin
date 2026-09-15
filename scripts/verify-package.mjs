// Proves that a packaged directory (the local `dist/cyclecloud-mcp/` output,
// or a directory extracted from a downloaded CI artifact) has the expected
// installable layout and can actually be installed with
// `install.sh --local --skip-config`, using the same fake Copilot CLI as the
// installer test suite. Usage: node scripts/verify-package.mjs [package-directory]
import { spawnSync } from "node:child_process";
import {
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageDirectory = resolve(
    process.cwd(),
    process.argv[2] ?? "dist/cyclecloud-mcp",
);
const expectedFiles = [
    "plugin.json",
    "bin/cyclecloud-mcp.mjs",
    "cyclecloud.example.json",
    "LICENSE",
    "install.sh",
    ".github/plugin/marketplace.json",
];

async function requirePackageLayout() {
    const entries = (
        await readdir(packageDirectory, {
            recursive: true,
            withFileTypes: true,
        })
    ).filter((entry) => entry.isFile());
    const names = new Set(
        entries.map((entry) =>
            join(entry.parentPath, entry.name).slice(
                packageDirectory.length + 1,
            ),
        ),
    );
    const missing = expectedFiles.filter((file) => !names.has(file));
    if (missing.length > 0) {
        throw new Error(
            `Package at ${packageDirectory} is missing expected files: ${missing.join(", ")}`,
        );
    }
}

async function createHarness() {
    const home = await mktempHome();
    const bin = join(home, "commands");
    await mkdir(bin, { recursive: true });
    await symlink(process.execPath, join(bin, "node"));
    await symlink("/usr/bin/uname", join(bin, "uname"));
    await symlink("/usr/bin/dirname", join(bin, "dirname"));
    const fakeCopilot = join(root, "tests/helpers/fake-copilot.mjs");
    await writeFile(
        join(bin, "copilot"),
        `#!/bin/sh\nexec '${process.execPath}' '${fakeCopilot}' "$@"\n`,
        { mode: 0o700 },
    );
    const statePath = join(home, "state.json");
    const callsPath = join(home, "calls.jsonl");
    await writeFile(
        statePath,
        JSON.stringify({
            plugins: [],
            marketplaces: [],
            flatPluginJson: true,
            liveLocal: true,
        }),
    );
    await writeFile(callsPath, "");
    return {
        home,
        env: {
            HOME: home,
            PATH: bin,
            FAKE_COPILOT_STATE: statePath,
            FAKE_COPILOT_CALLS: callsPath,
            FAKE_COPILOT_TEMPLATE: join(root, "cyclecloud.example.json"),
        },
    };
}

async function mktempHome() {
    return mkdtemp(join(tmpdir(), "cyclecloud-mcp-verify-package-"));
}

async function requireFile(path) {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
}

async function main() {
    await requirePackageLayout();
    const { home, env } = await createHarness();
    try {
        const result = spawnSync(
            "/bin/sh",
            [join(packageDirectory, "install.sh"), "--local", "--skip-config"],
            { cwd: home, env, encoding: "utf8", timeout: 30_000 },
        );
        if (result.status !== 0) {
            process.stderr.write(result.stdout ?? "");
            process.stderr.write(result.stderr ?? "");
            throw new Error(
                `install.sh --local --skip-config exited with status ${result.status}`,
            );
        }
        const managed = join(home, ".local/share/cyclecloud-mcp/marketplace");
        const visible = join(
            home,
            ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
        );
        for (const file of expectedFiles) {
            await requireFile(join(managed, file));
            await requireFile(join(visible, file));
            const [packaged, installedManaged, installedVisible] =
                await Promise.all([
                    readFile(join(packageDirectory, file)),
                    readFile(join(managed, file)),
                    readFile(join(visible, file)),
                ]);
            if (
                !packaged.equals(installedManaged) ||
                !packaged.equals(installedVisible)
            ) {
                throw new Error(
                    `Installed copy does not match packaged file: ${file}`,
                );
            }
        }
        const config = join(
            home,
            ".copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json",
        );
        await requireFile(config);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
    process.stdout.write(
        `Verified installable layout and --local --skip-config installation for ${packageDirectory}\n`,
    );
}

try {
    await main();
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
