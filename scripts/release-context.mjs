import { appendFile, readFile } from "node:fs/promises";
import { checkReleaseVersions, versionFromTag } from "./release-version.mjs";
import { requireSha } from "./release-github.mjs";
import { readReleaseNotes } from "./release-changelog.mjs";

import { refCommit, releaseGit } from "./release-git.mjs";
import { checkStableParent, validateLocalRelease } from "./release-commit.mjs";

const git = releaseGit(process.cwd());

try {
    if (process.argv.length !== 2)
        throw new Error(
            "Usage: node scripts/release-context.mjs (in a tag push workflow)",
        );
    const event = JSON.parse(
        await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    const ref = process.env.GITHUB_REF;
    if (
        process.env.GITHUB_EVENT_NAME !== "push" ||
        !ref?.startsWith("refs/tags/") ||
        event.ref !== ref ||
        event.deleted !== false ||
        event.forced === true ||
        event.repository?.full_name !== process.env.GITHUB_REPOSITORY
    )
        throw new Error(
            "Release requires a non-deletion, non-forced tag push in this repository",
        );
    const tag = ref.slice("refs/tags/".length);
    const version = versionFromTag(tag);
    const prerelease = version.includes("-");
    const source = requireSha(process.env.GITHUB_SHA);
    // Annotated tag objects and lightweight tags both resolve to a commit.
    const commit = requireSha(git("rev-parse", `${source}^{commit}`));
    if (git("rev-parse", "HEAD") !== commit)
        throw new Error("Checkout must match the tag push event commit");
    if (git("rev-parse", `${ref}^{commit}`) !== commit)
        throw new Error("Release tag no longer matches the event commit");
    if (git("status", "--porcelain"))
        throw new Error(
            "Release verification requires a clean committed checkout",
        );
    await checkReleaseVersions(process.cwd(), tag);
    await readReleaseNotes(process.cwd(), tag);
    if (!prerelease) {
        const { snapshot } = validateLocalRelease(git, commit, tag);
        const stable = refCommit(git, "refs/remotes/origin/stable");
        let alreadyPromoted = stable === commit;
        if (stable && !alreadyPromoted) {
            try {
                git("merge-base", "--is-ancestor", commit, stable);
                alreadyPromoted = true;
            } catch {
                // A new candidate must still be based on the current stable tip.
            }
        }
        if (!alreadyPromoted) checkStableParent(snapshot, stable);
    }
    await appendFile(
        process.env.GITHUB_OUTPUT,
        `tag=${tag}\ncommit=${commit}\nprerelease=${prerelease}\n`,
    );
    process.stdout.write(`Release ${tag} at ${commit}\n`);
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
