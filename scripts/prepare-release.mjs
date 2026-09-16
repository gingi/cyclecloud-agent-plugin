import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { releaseDocuments, versionFromTag } from "./release-version.mjs";

try {
    if (process.argv.length !== 3)
        throw new Error("Usage: npm run release:prepare -- <version>");
    const version = versionFromTag(`v${process.argv[2]}`);
    const root = process.cwd();
    const documents = await releaseDocuments(root);
    // Prepare all changes before writing; no commits, tags, or pushes are made.
    documents["package.json"].version = version;
    documents["package-lock.json"].version = version;
    documents["package-lock.json"].packages[""].version = version;
    documents["plugin.json"].version = version;
    documents[".github/plugin/marketplace.json"].metadata.version = version;
    documents[".github/plugin/marketplace.json"].plugins[0].version = version;
    const updates = await Promise.all(
        Object.entries(documents).map(async ([file, document]) => {
            const filepath = join(root, file);
            const contents =
                file === "package-lock.json"
                    ? `${JSON.stringify(document, null, 2)}\n`
                    : await format(JSON.stringify(document), {
                          ...(await resolveConfig(filepath)),
                          filepath,
                      });
            return [filepath, contents];
        }),
    );
    for (const [filepath, contents] of updates)
        await writeFile(filepath, contents);
    process.stdout.write(
        `Prepared ${version}; changes are not committed. Review, verify, and merge them before running the Release workflow.\n`,
    );
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
