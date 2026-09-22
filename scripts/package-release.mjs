import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkReleaseVersions } from "./release-version.mjs";
import { checkOutputDirectory } from "./package-layout.mjs";
import { verifyPackage } from "./verify-package.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const tag = args[0];

async function main() {
    if (args.length !== 1)
        throw new Error("Usage: node scripts/package-release.mjs v<version>");
    const version = await checkReleaseVersions(root, tag);
    const packageDirectory = join(root, "dist/cyclecloud-agent-plugin");
    await checkOutputDirectory(join(root, "dist"));
    const packaged = await verifyPackage(packageDirectory, {
        sourceRoot: root,
    });
    if (packaged.version !== version)
        throw new Error(
            "Packaged plugin version does not match the release; run npm run package:release",
        );
    const commit =
        process.env.RELEASE_SOURCE_COMMIT ??
        process.env.GITHUB_SHA ??
        execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).trim();
    if (!/^[a-f0-9]{40}$/.test(commit))
        throw new Error("Expected a full source commit SHA");
    const repository =
        process.env.GITHUB_REPOSITORY ?? "gingi/cyclecloud-agent-plugin";
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
        throw new Error("Invalid release repository");
    await writeFile(
        join(packageDirectory, "SOURCE_COMMIT.json"),
        `${JSON.stringify(
            {
                repository,
                version,
                sourceCommit: commit,
                checkoutCommit: commit,
                sourceRef: tag,
                workflowRef: process.env.GITHUB_REF ?? `refs/tags/${tag}`,
                eventName: process.env.GITHUB_EVENT_NAME ?? "local",
                runId: process.env.GITHUB_RUN_ID,
                runAttempt: process.env.GITHUB_RUN_ATTEMPT,
                builtAt: new Date().toISOString(),
            },
            null,
            2,
        )}\n`,
    );
    const assets = join(root, "dist/releases");
    await mkdir(assets, { recursive: true });
    const name = `cyclecloud-agent-plugin-${version}.tar.gz`;
    execFileSync(
        "tar",
        [
            "--format=ustar",
            "-czf",
            join(assets, name),
            "-C",
            join(root, "dist"),
            "cyclecloud-agent-plugin",
        ],
        { stdio: "inherit" },
    );
    const digest = createHash("sha256")
        .update(await readFile(join(assets, name)))
        .digest("hex");
    await writeFile(join(assets, "SHA256SUMS"), `${digest}  ${name}\n`);
    process.stdout.write(
        `Release assets: ${join(assets, name)} and SHA256SUMS\n`,
    );
}

try {
    await main();
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
