// Check package contents and authoring assets after relocation, not host installation.
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    checkOutputDirectory,
    executableFile,
    packageName,
    requireRegularPath,
    sourceFiles,
} from "./package-layout.mjs";
import { versionFromTag } from "./release-version.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function verifyPackage(
    packageDirectory,
    { sourceRoot = root } = {},
) {
    packageDirectory = resolve(packageDirectory);
    await checkOutputDirectory(packageDirectory);
    const expected = await sourceFiles(sourceRoot);
    const names = [];
    for (const entry of await readdir(packageDirectory, {
        recursive: true,
        withFileTypes: true,
    })) {
        const name = join(entry.parentPath, entry.name).slice(
            packageDirectory.length + 1,
        );
        if (entry.isFile()) names.push(name);
        else if (!expected.some((file) => file.startsWith(`${name}/`)))
            throw new Error(`Unexpected package directory: ${name}`);
    }
    if (
        JSON.stringify(
            names.filter((name) => name !== "SOURCE_COMMIT.json").sort(),
        ) !== JSON.stringify(expected)
    )
        throw new Error(
            "Source package layout differs from the explicit allowlist (missing or unexpected files)",
        );
    for (const name of expected) {
        await requireRegularPath(packageDirectory, name);
        const mode = (await lstat(join(packageDirectory, name))).mode;
        if (executableFile(name) && !(mode & 0o111))
            throw new Error(`Package script is not executable: ${name}`);
        // Manifest versions vary by release; their complete schemas are checked below.
        if (["plugin.json", ".github/plugin/marketplace.json"].includes(name))
            continue;
        if (
            !(await readFile(join(packageDirectory, name))).equals(
                await readFile(join(sourceRoot, name)),
            )
        )
            throw new Error(
                `Package content differs from reviewed source: ${name}`,
            );
    }
    const json = async (name) =>
        JSON.parse(await readFile(join(packageDirectory, name), "utf8"));
    const plugin = await json("plugin.json");
    const catalog = await json(".github/plugin/marketplace.json");
    versionFromTag(`v${plugin.version}`);
    const expectedPlugin = JSON.parse(
        await readFile(join(sourceRoot, "plugin.json"), "utf8"),
    );
    const expectedCatalog = JSON.parse(
        await readFile(
            join(sourceRoot, ".github/plugin/marketplace.json"),
            "utf8",
        ),
    );
    expectedPlugin.version = plugin.version;
    expectedCatalog.metadata.version = plugin.version;
    expectedCatalog.plugins[0].version = plugin.version;
    if (
        plugin.name !== "cyclecloud" ||
        "mcpServers" in plugin ||
        !equalJson(plugin, expectedPlugin) ||
        !equalJson(catalog, expectedCatalog)
    )
        throw new Error(
            "Source package plugin/marketplace identity or schema is invalid",
        );
    if (names.includes("SOURCE_COMMIT.json")) {
        const metadata = await json("SOURCE_COMMIT.json");
        const fields = new Set([
            "repository",
            "version",
            "sourceCommit",
            "checkoutCommit",
            "sourceRef",
            "workflowRef",
            "eventName",
            "runId",
            "runAttempt",
            "builtAt",
            "note",
        ]);
        if (
            !metadata ||
            Array.isArray(metadata) ||
            Object.entries(metadata).some(
                ([key, value]) => !fields.has(key) || typeof value !== "string",
            )
        )
            throw new Error("Unexpected source commit metadata fields");
        for (const field of ["sourceCommit", "checkoutCommit"])
            if (!/^[a-f0-9]{40}$/.test(metadata[field] ?? ""))
                throw new Error(`Invalid source commit metadata: ${field}`);
        if (
            metadata.version !== undefined &&
            metadata.version !== plugin.version
        )
            throw new Error(
                "Source metadata version differs from plugin version",
            );
    }
    await smokeAuthoringChecker(packageDirectory);
    return plugin;
}

function equalJson(actual, expected) {
    if (
        actual === null ||
        expected === null ||
        typeof actual !== "object" ||
        typeof expected !== "object"
    )
        return actual === expected;
    if (Array.isArray(actual) !== Array.isArray(expected)) return false;
    const keys = Object.keys(actual).sort();
    return (
        JSON.stringify(keys) === JSON.stringify(Object.keys(expected).sort()) &&
        keys.every((key) => equalJson(actual[key], expected[key]))
    );
}

async function smokeAuthoringChecker(directory) {
    const home = await mkdtemp(join(tmpdir(), "cyclecloud-source-verify-"));
    try {
        const skill = join(directory, "skills/author-cyclecloud-application");
        const result = spawnSync(
            process.execPath,
            [
                join(skill, "scripts/validate-project.mjs"),
                join(skill, "assets/project"),
            ],
            {
                cwd: home,
                env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" },
                encoding: "utf8",
                timeout: 20_000,
            },
        );
        // The shipped skeleton is intentionally incomplete; scripts are parsed, never run.
        if (
            result.status !== 1 ||
            !result.stdout.includes("Unresolved TODO marker") ||
            !result.stdout.includes("NOT CHECKED:") ||
            result.stdout.includes("Missing or unreadable") ||
            result.stdout.includes("Bash syntax checker unavailable") ||
            result.stdout.includes("Shell syntax check failed")
        )
            throw new Error("Packaged authoring checker smoke failed");
    } finally {
        await rm(home, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        const directory = resolve(process.argv[2] ?? `dist/${packageName}`);
        await verifyPackage(directory);
        process.stdout.write(
            `Verified source package layout, contents, identity, and authoring checker smoke: ${directory}\nNo native host installation was performed or validated.\n`,
        );
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
