import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { releaseDocuments, versionFromTag } from "./release-version.mjs";
import { prepareChangelog, readChangelog } from "./release-changelog.mjs";

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
        const updates = await prepareReleaseChanges(root, version);
        const filepath = join(root, "CHANGELOG.md");
        const changelog = prepareChangelog(
            await readChangelog(root),
            `v${version}`,
        );
        updates.push([
            "CHANGELOG.md",
            await format(changelog, {
                ...(await resolveConfig(filepath)),
                filepath,
            }),
        ]);
        for (const [file, contents] of updates)
            await writeFile(join(root, file), contents);
        process.stdout.write(
            `Prepared ${version} and CHANGELOG.md; changes are not committed. Commit them on your branch before previewing, or use a release PR for a reviewed release.\n`,
        );
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
