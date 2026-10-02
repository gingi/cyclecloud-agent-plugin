import { lstat, readdir } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";

export const packageName = "cyclecloud-agent-plugin";
// Only these reviewed source files belong in the package. Never copy the whole checkout.
const files = [
    "plugin.json",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    ".github/plugin/marketplace.json",
    "docs/agent-plugin-design.md",
    "docs/application-authoring.md",
    "docs/application-context.md",
    "docs/cli-contract.md",
    "docs/configuration.md",
    "docs/development.md",
    "docs/node-diagnostics.md",
    "docs/troubleshooting.md",
    "skills/use-cyclecloud/SKILL.md",
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

export async function requireRegularPath(root, name) {
    const target = resolve(root, name);
    const parts = relative(resolve(root), target).split(sep);
    if (parts.some((part) => part === ".."))
        throw new Error(`Unsafe package path: ${name}`);
    let current = resolve(root);
    if (!(await lstat(current)).isDirectory())
        throw new Error(`Not a regular directory: ${current}`);
    for (let i = 0; i < parts.length; i++) {
        current = join(current, parts[i]);
        const info = await lstat(current);
        const isDirectory = i < parts.length - 1;
        if (isDirectory ? !info.isDirectory() : !info.isFile())
            throw new Error(
                `Not a regular package ${isDirectory ? "directory" : "file"}: ${current}`,
            );
    }
}

export async function sourceFiles(root) {
    for (const file of files) await requireRegularPath(root, file);
    return [...files].sort();
}

export async function checkOutputDirectory(directory) {
    const info = await lstat(directory).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
    });
    if (!info) return;
    if (!info.isDirectory())
        throw new Error(`Not a regular directory: ${directory}`);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory())
            await checkOutputDirectory(join(directory, entry.name));
        else if (!entry.isFile())
            throw new Error(
                `Non-regular file in package output: ${entry.name}`,
            );
    }
}

export function executableFile(file) {
    return file.endsWith(".sh") || file.endsWith("/validate-project.mjs");
}
