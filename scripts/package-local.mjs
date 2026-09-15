import {
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    readdir,
    rename,
    rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
    "plugin.json",
    "bin/cyclecloud-mcp.mjs",
    "cyclecloud.example.json",
    "LICENSE",
    "install.sh",
    ".github/plugin/marketplace.json",
    "skills/author-cyclecloud-application/SKILL.md",
    "skills/author-cyclecloud-application/references/authoring.md",
    "skills/author-cyclecloud-application/scripts/validate-project.mjs",
    "skills/author-cyclecloud-application/assets/project/project.ini",
    "skills/author-cyclecloud-application/assets/project/README.md",
    "skills/author-cyclecloud-application/assets/project/ATTACHMENT.md",
    "skills/author-cyclecloud-application/assets/project/specs/install/cluster-init/scripts/10-install.sh",
    "skills/author-cyclecloud-application/assets/project/specs/runtime/cluster-init/scripts/10-runtime.sh",
    "skills/author-cyclecloud-application/assets/project/examples/openfoam.sbatch",
];
const dist = join(root, "dist");
const destination = join(dist, "cyclecloud-mcp");

async function checkDirectory(directory) {
    const info = await lstat(directory).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
    });
    if (!info) return;
    if (!info.isDirectory())
        throw new Error(`Not a regular directory: ${directory}`);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
            throw new Error(`Symlink in package output: ${entry.name}`);
        if (entry.isDirectory())
            await checkDirectory(join(directory, entry.name));
    }
}

await checkDirectory(dist);
await mkdir(dist, { recursive: true });
const staged = await mkdtemp(join(dist, ".package-"));
try {
    for (const file of files) {
        const source = join(root, file);
        if (!(await lstat(source)).isFile())
            throw new Error(`Not a regular package file: ${source}`);
        const target = join(staged, file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
    }
    await rm(destination, { recursive: true, force: true });
    await rename(staged, destination);
} finally {
    await rm(staged, { recursive: true, force: true });
}
process.stdout.write(
    `Self-contained package: ${destination}\nInstall anywhere with: sh install.sh --local\n`,
);
