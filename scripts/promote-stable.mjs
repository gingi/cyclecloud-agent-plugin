import { versionFromTag } from "./release-version.mjs";
import { githubApi, releaseRepository, requireSha } from "./release-github.mjs";

function stableCommit(ref) {
    if (ref?.ref !== "refs/heads/stable" || ref.object?.type !== "commit")
        throw new Error("Invalid stable ref metadata");
    try {
        return requireSha(ref.object.sha);
    } catch {
        throw new Error("Invalid stable ref commit SHA");
    }
}

function promote() {
    if (process.argv.length !== 4)
        throw new Error(
            "Usage: node scripts/promote-stable.mjs <tag> <commit>",
        );
    const [tag, commit] = process.argv.slice(2);
    if (versionFromTag(tag).includes("-"))
        throw new Error("Cannot promote a prerelease to stable");
    requireSha(commit);
    const base = `repos/${releaseRepository()}`;
    const target = githubApi(
        `${base}/commits/${encodeURIComponent(`refs/tags/${tag}`)}`,
    );
    if (target?.sha !== commit)
        throw new Error(
            `Tag ${tag} points to a different commit; refusing to promote`,
        );
    const release = githubApi(
        `${base}/releases/tags/${encodeURIComponent(tag)}`,
    );
    if (
        release?.tag_name !== tag ||
        release.draft !== false ||
        release.prerelease !== false ||
        typeof release.published_at !== "string" ||
        !release.published_at
    )
        throw new Error(
            `Expected an exact published stable release for ${tag}`,
        );
    const main = requireSha(
        githubApi(`${base}/commits/${encodeURIComponent("refs/heads/main")}`)
            ?.sha,
    );
    const onMain = githubApi(`${base}/compare/${commit}...${main}`)?.status;
    if (onMain !== "ahead" && onMain !== "identical")
        throw new Error("Stable release commit must belong to main");

    // Only an exact missing ref permits creation; API failures propagate.
    const matches = githubApi(`${base}/git/matching-refs/heads/stable`);
    if (!Array.isArray(matches)) throw new Error("Invalid stable ref lookup");
    const refs = matches.filter((ref) => ref?.ref === "refs/heads/stable");
    if (refs.length > 1) throw new Error("Ambiguous stable ref lookup");
    let updated;
    if (refs.length === 0) {
        updated = githubApi(`${base}/git/refs`, {
            method: "POST",
            body: { ref: "refs/heads/stable", sha: commit },
        });
    } else {
        const current = stableCommit(refs[0]);
        if (current === commit) {
            process.stdout.write(
                `Stable already points to ${tag} at ${commit}; unchanged.\n`,
            );
            return;
        }
        // GitHub's commits list can be truncated; status describes the full comparison.
        const status = githubApi(
            `${base}/compare/${current}...${commit}`,
        )?.status;
        if (status === "behind" || status === "identical") {
            process.stdout.write(
                `Stable already includes ${tag} at ${commit}; unchanged.\n`,
            );
            return;
        }
        if (status !== "ahead")
            throw new Error("Cannot fast-forward stable to this release");
        updated = githubApi(`${base}/git/refs/heads/stable`, {
            method: "PATCH",
            body: { sha: commit, force: false },
        });
    }
    if (stableCommit(updated) !== commit)
        throw new Error(
            "GitHub did not confirm stable at the requested commit",
        );
    process.stdout.write(`Promoted stable to ${tag} at ${commit}.\n`);
}

try {
    promote();
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
