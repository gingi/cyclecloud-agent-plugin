import { execFileSync } from "node:child_process";
import {
    chmod,
    copyFile,
    mkdir,
    mkdtemp,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    checkOutputDirectory,
    executableFile,
    packageName,
    requireRegularPath,
    sourceFiles,
} from "./package-layout.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const destination = join(dist, packageName);
await checkOutputDirectory(dist);
const files = await sourceFiles(root);
for (const file of files) await requireRegularPath(root, file);
await mkdir(dist, { recursive: true });
const staged = await mkdtemp(join(dist, ".package-"));
try {
    for (const file of files) {
        const target = join(staged, file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(root, file), target);
        await chmod(target, executableFile(file) ? 0o755 : 0o644);
    }
    let commit;
    try {
        commit = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        /* Extracted source does not have to contain Git metadata. */
    }
    if (commit && /^[a-f0-9]{40}$/.test(commit))
        await writeFile(
            join(staged, "SOURCE_COMMIT.json"),
            `${JSON.stringify({ sourceCommit: commit, checkoutCommit: commit, sourceRef: "working-tree", note: "Local source package; may include uncommitted changes." }, null, 2)}\n`,
        );
    await rm(destination, { recursive: true, force: true });
    await rename(staged, destination);
} finally {
    await rm(staged, { recursive: true, force: true });
}
process.stdout.write(
    `Source package: ${destination}\nUse native host installation from this persistent source directory.\n`,
);
