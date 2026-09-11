import { constants } from "node:fs";
import { copyFile, lstat, mkdtemp, rename, rm, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const bundle = join(
    homedir(),
    ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp/bin/cyclecloud-mcp.mjs",
);
const backup = `${bundle}.before-local-test`;
const localBundle = new URL("../bin/cyclecloud-mcp.mjs", import.meta.url);

async function requireFile(path, label) {
    let stats;
    try {
        stats = await lstat(path);
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(`Missing ${label}: ${path}`);
        }
        throw error;
    }
    if (!stats.isFile()) {
        throw new Error(`The ${label} must be a regular file: ${path}`);
    }
}

async function replaceBundle(source) {
    const temporary = await mkdtemp(join(dirname(bundle), ".deploy-"));
    try {
        const staged = join(temporary, "cyclecloud-mcp.mjs");
        await copyFile(source, staged);
        await rename(staged, bundle);
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

async function main() {
    const command = process.argv[2];
    if (process.argv.length !== 3 || !["deploy", "restore"].includes(command)) {
        throw new Error("Usage: node scripts/deploy.mjs deploy|restore");
    }
    await requireFile(bundle, "installed plugin bundle");
    if (command === "deploy") {
        await requireFile(
            localBundle,
            "local bundle (run npm run build first)",
        );
        try {
            await copyFile(bundle, backup, constants.COPYFILE_EXCL);
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            await requireFile(backup, "backup");
        }
        await replaceBundle(localBundle);
        process.stdout.write(`Deployed local bundle to ${bundle}\n`);
        process.stdout.write(`Original backup preserved at ${backup}\n`);
        process.stdout.write("Run npm run restore to undo the deployment.\n");
    } else {
        await requireFile(backup, "backup");
        await replaceBundle(backup);
        await unlink(backup);
        process.stdout.write(`Restored original bundle to ${bundle}\n`);
    }
    process.stdout.write(
        "Reload VS Code and start a fresh Copilot session " +
            "(or restart your locally registered MCP server).\n",
    );
}

try {
    await main();
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
