import { versionFromTag } from "./release-version.mjs";
import { githubApi, releaseRepository, requireSha } from "./release-github.mjs";
import {
    checkSourceTree,
    checkStableParent,
    releaseSource,
    stableSource,
} from "./release-commit.mjs";

function stableCommit(ref) {
    if (ref?.ref !== "refs/heads/stable" || ref.object?.type !== "commit")
        throw new Error("Invalid stable ref metadata");
    try {
        return requireSha(ref.object.sha);
    } catch {
        throw new Error("Invalid stable ref commit SHA");
    }
}

function readCommit(base, sha) {
    const snapshot = githubApi(`${base}/git/commits/${sha}`);
    if (snapshot?.sha !== sha)
        throw new Error("Invalid release commit metadata");
    requireSha(snapshot.tree?.sha);
    return snapshot;
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
    // Filter in gh before buffering: full commit diffs can exceed 1 MiB.
    const target = githubApi(
        `${base}/commits/${encodeURIComponent(`refs/tags/${tag}`)}`,
        {
            jq: "{sha: .sha, tree: .commit.tree.sha}",
        },
    );
    if (target?.sha !== commit)
        throw new Error(
            `Tag ${tag} points to a different commit; refusing to promote`,
        );
    const snapshot = readCommit(base, commit);
    if (requireSha(target.tree) !== snapshot.tree.sha)
        throw new Error("Release commit tree does not match the tag");
    const source = releaseSource(snapshot, tag);
    checkSourceTree(snapshot, readCommit(base, source));
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
        githubApi(`${base}/commits/${encodeURIComponent("refs/heads/main")}`, {
            jq: "{sha: .sha}",
        })?.sha,
    );
    const onMain = githubApi(`${base}/compare/${source}...${main}`, {
        jq: "{status: .status}",
    })?.status;
    if (onMain !== "ahead" && onMain !== "identical")
        throw new Error("Stable release source must belong to main");
    if (snapshot.parents.length === 2) {
        const previous = readCommit(base, snapshot.parents[0].sha);
        const previousSource = stableSource(previous);
        checkSourceTree(previous, readCommit(base, previousSource));
        const status = githubApi(
            `${base}/compare/${previousSource}...${source}`,
            {
                jq: "{status: .status}",
            },
        )?.status;
        if (status !== "ahead")
            throw new Error(
                "Stable source history does not advance to this release",
            );
    }

    // Only an exact missing ref permits creation; API failures propagate.
    const matches = githubApi(`${base}/git/matching-refs/heads/stable`);
    if (!Array.isArray(matches)) throw new Error("Invalid stable ref lookup");
    const refs = matches.filter((ref) => ref?.ref === "refs/heads/stable");
    if (refs.length > 1) throw new Error("Ambiguous stable ref lookup");
    const current = refs.length ? stableCommit(refs[0]) : undefined;
    let alreadyPromoted = current === commit;
    if (current && !alreadyPromoted && current !== snapshot.parents[0]?.sha) {
        // An older tagged release is a no-op only if stable actually includes it.
        const status = githubApi(`${base}/compare/${commit}...${current}`, {
            jq: "{status: .status}",
        })?.status;
        alreadyPromoted = status === "ahead" || status === "identical";
        if (!alreadyPromoted && status !== "behind" && status !== "diverged")
            throw new Error("Cannot determine stable release ancestry");
    }
    if (alreadyPromoted) {
        process.stdout.write(
            `Stable already includes ${tag} at ${current}; unchanged.\n`,
        );
        return;
    }
    checkStableParent(snapshot, current);
    // Publish exactly the verified tag commit; never manufacture or retag a release here.
    const updated = current
        ? githubApi(`${base}/git/refs/heads/stable`, {
              method: "PATCH",
              body: { sha: commit, force: false },
          })
        : githubApi(`${base}/git/refs`, {
              method: "POST",
              body: { ref: "refs/heads/stable", sha: commit },
          });
    if (stableCommit(updated) !== commit)
        throw new Error(
            "GitHub did not confirm stable at the requested commit",
        );
    process.stdout.write(
        `Promoted stable to ${tag} at ${commit} (source ${source}).\n`,
    );
}

try {
    promote();
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
