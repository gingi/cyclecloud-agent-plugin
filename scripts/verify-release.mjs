import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHarness } from "./verify-package.mjs";
import { versionFromTag } from "./release-version.mjs";

export async function verifyRelease(tag, commit, installerUrl) {
    const version = versionFromTag(tag);
    if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
        throw new Error("Expected the full released commit SHA");
    const { home, env } = await createHarness();
    try {
        // Intentionally omit GH_TOKEN and other credentials: public curl downloads must work.
        const result = spawnSync(
            "/bin/bash",
            [
                "-c",
                'set -o pipefail; curl -fsSL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 10 --max-time 60 "$INSTALLER_URL" | sh -s -- --skip-config',
            ],
            {
                cwd: home,
                env: {
                    ...env,
                    PATH: `${env.PATH}:${process.env.PATH}`,
                    INSTALLER_URL: installerUrl,
                },
                encoding: "utf8",
                timeout: 300_000,
            },
        );
        if (result.error || result.status !== 0)
            throw new Error(
                `Curl installation failed: ${result.error?.message ?? result.status}\n${result.stderr}\n${result.stdout}`,
            );
        const managed = join(home, ".local/share/cyclecloud-mcp/marketplace");
        const visible = join(
            home,
            ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
        );
        for (const directory of [managed, visible]) {
            const plugin = JSON.parse(
                await readFile(join(directory, "plugin.json"), "utf8"),
            );
            const metadata = JSON.parse(
                await readFile(join(directory, "SOURCE_COMMIT.json"), "utf8"),
            );
            if (
                plugin.version !== version ||
                metadata.version !== version ||
                metadata.sourceRef !== tag ||
                metadata.sourceCommit !== commit ||
                metadata.checkoutCommit !== commit
            ) {
                throw new Error(
                    "Installed release identity/commit does not match the published build",
                );
            }
        }
        const names = await readdir(managed, { recursive: true });
        const visibleNames = await readdir(visible, { recursive: true });
        if (
            JSON.stringify(names.sort()) !== JSON.stringify(visibleNames.sort())
        )
            throw new Error("Managed and VS Code package layouts differ");
        for (const name of names) {
            if (
                (await lstat(join(managed, name))).isFile() &&
                !(await readFile(join(managed, name))).equals(
                    await readFile(join(visible, name)),
                )
            )
                throw new Error(`Runtime copies differ: ${name}`);
        }
        const config = join(
            home,
            ".copilot/plugin-data/cyclecloud-mcp/cyclecloud-mcp/cyclecloud.json",
        );
        if (((await lstat(config)).mode & 0o777) !== 0o600)
            throw new Error("Installed configuration is not private");
        const configuration = JSON.parse(await readFile(config, "utf8"));
        if (
            configuration.password !== "" ||
            configuration.enableMutations !== false
        )
            throw new Error(
                "Installer did not preserve safe template defaults",
            );
        // Initialize/list tools only. No request is sent to CycleCloud and no real credential is needed.
        await writeFile(
            config,
            JSON.stringify({
                ...configuration,
                url: "https://release-verification.invalid",
                username: "release-test",
                password: "test-only",
            }),
        );
        const client = new Client({
            name: "release-verifier",
            version: "1.0.0",
        });
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [join(visible, "bin/cyclecloud-mcp.mjs")],
            cwd: home,
            env: { ...env, PLUGIN_ROOT: visible },
            stderr: "pipe",
        });
        transport.stderr?.resume();
        try {
            await client.connect(transport, { timeout: 10_000 });
            if (client.getServerVersion()?.version !== version)
                throw new Error(
                    "Installed MCP runtime version does not match the release",
                );
            const tools = await client.listTools({}, { timeout: 10_000 });
            const actual = tools.tools.map((tool) => tool.name).sort();
            const expected = [
                "get_cluster",
                "get_cluster_application_context",
                "get_cluster_status",
                "list_clusters",
            ];
            if (JSON.stringify(actual) !== JSON.stringify(expected))
                throw new Error(
                    "Installed MCP read-only tool inventory is incorrect",
                );
        } finally {
            await client.close();
        }
        process.stdout.write(
            `Verified curl installation of ${tag} (${commit}), both runtime copies, and MCP initialization/tools.\n`,
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
            process.env.GITHUB_REPOSITORY ?? "gingi/cyclecloud-mcp";
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
            throw new Error("Invalid release repository");
        const ref =
            option === "--latest" ? "latest/download" : `download/${tag}`;
        await verifyRelease(
            tag,
            commit,
            `https://github.com/${repository}/releases/${ref}/install.sh`,
        );
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
