import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { releaseDocuments, versionFromTag } from "./release-version.mjs";
import { draftChangelog } from "./release-changelog.mjs";

export async function prepareReleaseChanges(root, requestedVersion) {
    const version = versionFromTag(`v${requestedVersion}`);
    const documents = await releaseDocuments(root);
    documents["package.json"].version = version;
    documents["package-lock.json"].version = version;
    documents["package-lock.json"].packages[""].version = version;
    documents["plugin.json"].version = version;
    documents[".github/plugin/marketplace.json"].metadata.version = version;
    documents[".github/plugin/marketplace.json"].plugins[0].version = version;
    return Promise.all(
        Object.entries(documents).map(async ([file, document]) => {
            const filepath = join(root, file);
            const contents =
                file === "package-lock.json"
                    ? `${JSON.stringify(document, null, 2)}\n`
                    : await format(JSON.stringify(document), {
                          ...(await resolveConfig(filepath)),
                          filepath,
                      });
            return [file, contents];
        }),
    );
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        if (process.argv.length !== 3)
            throw new Error("Usage: npm run release:prepare -- <version>");
        const root = process.cwd();
        const version = process.argv[2];
        const changelog = await draftChangelog(root, `v${version}`);
        const updates = await prepareReleaseChanges(root, version);
        if (changelog !== undefined) updates.push(["CHANGELOG.md", changelog]);
        for (const [file, contents] of updates)
            await writeFile(join(root, file), contents);
        process.stdout.write(
            `Prepared ${version}; ${changelog === undefined ? "preserved existing release notes" : "drafted release notes from commit subjects"}. Review and edit CHANGELOG.md, then commit the version and notes before pushing tag v${version}. Nothing has been committed or published.\n`,
        );
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
