import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith("--")) {
    process.stderr.write(
        "Usage: node validate-project.mjs <project-directory>\n",
    );
    process.exit(2);
}

const directory = resolve(args[0]);
const files = [
    "project.ini",
    "README.md",
    "ATTACHMENT.md",
    "specs/install/cluster-init/scripts/10-install.sh",
    "specs/runtime/cluster-init/scripts/10-runtime.sh",
    "examples/openfoam.sbatch",
];
let errors = 0;
function error(message) {
    errors += 1;
    process.stdout.write(`ERROR: ${message}\n`);
}

for (const file of files) {
    let contents;
    try {
        contents = await readFile(join(directory, file), "utf8");
    } catch {
        error(`Missing or unreadable file: ${file}`);
        continue;
    }
    if (contents.includes("TODO(")) error(`Unresolved TODO marker: ${file}`);
    if (file.endsWith(".sh") || file.endsWith(".sbatch")) {
        // Parse only; never execute or source application scripts.
        const result = spawnSync("bash", ["--noprofile", "--norc", "-n"], {
            input: contents,
            encoding: "utf8",
            timeout: 5000,
            env: { PATH: process.env.PATH },
        });
        if (result.error)
            error(`Bash syntax checker unavailable or timed out: ${file}`);
        else if (result.status !== 0)
            error(`Shell syntax check failed: ${file}`);
    }
}

process.stdout.write(
    "NOT CHECKED: metadata semantics, permissions, extra files, installation, MPI compatibility, live cluster or job execution.\n",
);
process.stdout.write(
    errors
        ? `Local skeleton checks failed: ${errors} error(s).\n`
        : "Local skeleton checks passed; this is not deployment or runtime validation.\n",
);
process.exitCode = errors ? 1 : 0;
