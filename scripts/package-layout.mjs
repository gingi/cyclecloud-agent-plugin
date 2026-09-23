import { lstat, readdir } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";

export const packageName = "cyclecloud-agent-plugin";
// Reviewed source-only distribution boundary. Never recursively copy the checkout.
const files = [
    "plugin.json",
    "compatibility.json",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    ".github/plugin/marketplace.json",
    "scripts/cyclecloud-inspect",
    "scripts/inspect-bootstrap.py",
    "docs/agent-plugin-design.md",
    "docs/application-authoring.md",
    "docs/application-context.md",
    "docs/cli-contract.md",
    "docs/configuration.md",
    "docs/development.md",
    "docs/troubleshooting.md",
    "skills/inspect-cyclecloud/SKILL.md",
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

export async function requireRegularPath(root, name, directory = false) {
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
        const isDirectory = i < parts.length - 1 || directory;
        if (isDirectory ? !info.isDirectory() : !info.isFile())
            throw new Error(
                `Not a regular package ${isDirectory ? "directory" : "file"}: ${current}`,
            );
    }
}

export async function sourceFiles(root) {
    const moduleDirectory = "python/cyclecloud_agent_inspect";
    await requireRegularPath(root, moduleDirectory, true);
    const modules = [];
    for (const entry of await readdir(join(root, moduleDirectory), {
        withFileTypes: true,
    })) {
        if (!entry.name.endsWith(".py")) continue;
        const name = `${moduleDirectory}/${entry.name}`;
        await requireRegularPath(root, name);
        modules.push(name);
    }
    if (!modules.includes(`${moduleDirectory}/__init__.py`))
        throw new Error("Missing Python source package");
    return [...files, ...modules].sort();
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
    return (
        file === "scripts/cyclecloud-inspect" ||
        file.endsWith(".sh") ||
        file.endsWith("/validate-project.mjs")
    );
}
