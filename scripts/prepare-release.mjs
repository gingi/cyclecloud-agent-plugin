import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { releaseDocuments, versionFromTag } from "./release-version.mjs";
import { draftChangelog } from "./release-changelog.mjs";
import {
    fetchOrigin,
    refCommit,
    releaseGit,
    requireCleanCheckout,
} from "./release-git.mjs";

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
        const version = versionFromTag(`v${process.argv[2]}`);
        const tag = `v${version}`;
        const branch = `release/prepare-${version}`;
        const git = releaseGit(root);
        const currentBranch = git("branch", "--show-current");
        if (!currentBranch)
            throw new Error(
                "Start release preparation from an attached branch, not a detached HEAD",
            );
        const head = git("rev-parse", "HEAD");
        if (currentBranch !== branch) requireCleanCheckout(git);
        fetchOrigin(git, true);
        if (refCommit(git, `refs/tags/${tag}`))
            throw new Error(
                `Tag ${tag} already exists; choose a new release version`,
            );
        if (
            currentBranch !== branch &&
            (refCommit(git, `refs/heads/${branch}`) ||
                refCommit(git, `refs/remotes/origin/${branch}`))
        )
            throw new Error(
                `Preparation branch ${branch} already exists; inspect it and switch to it to resume`,
            );
        const changelog = await draftChangelog(root, tag);
        const updates = await prepareReleaseChanges(root, version);
        if (changelog !== undefined) updates.push(["CHANGELOG.md", changelog]);
        if (
            git("rev-parse", "HEAD") !== head ||
            git("branch", "--show-current") !== currentBranch
        )
            throw new Error(
                "Checkout changed during preparation; inspect it and retry",
            );
        if (currentBranch !== branch) {
            requireCleanCheckout(git);
            git("switch", "--create", branch, head);
        }
        for (const [file, contents] of updates)
            await writeFile(join(root, file), contents);
        process.stdout.write(
            `Prepared ${version} on ${branch}; ${changelog === undefined ? "preserved existing release notes" : "drafted release notes from commit subjects"}.\nReview and edit CHANGELOG.md and any other changes. ${version.includes("-") ? "Commit the reviewed changes" : "Commit the reviewed changes, merge a PR into main, and check out its merged commit"}, then run npm run release:tag -- ${version} (add --push to publish the tag). Nothing has been committed or published.\n`,
        );
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
