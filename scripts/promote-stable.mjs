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

function taggedCommit(base, tag) {
    // Filter in gh before buffering: full commit diffs can exceed 1 MiB.
    return githubApi(
        `${base}/commits/${encodeURIComponent(`refs/tags/${tag}`)}`,
        {
            jq: "{sha: .sha, tree: .commit.tree.sha}",
        },
    );
}

function stableSource(base, current) {
    const snapshot = githubApi(`${base}/git/commits/${current}`);
    if (snapshot?.sha !== current || typeof snapshot.message !== "string")
        throw new Error("Invalid stable commit metadata");
    const source = snapshot.message.match(
        /^Release (v[^\n]+)\n\nSource-Commit: ([a-f0-9]{40})\n?$/,
    );
    // Accept an existing tag/main commit as the starting point, without rewriting it.
    if (!source) return current;
    const [, tag, commit] = source;
    if (versionFromTag(tag).includes("-"))
        throw new Error("Invalid prerelease in stable commit metadata");
    const tagged = taggedCommit(base, tag);
    if (
        tagged?.sha !== commit ||
        requireSha(tagged.tree) !== snapshot.tree?.sha ||
        !Array.isArray(snapshot.parents) ||
        snapshot.parents.length > 2 ||
        (snapshot.parents.length === 2 && snapshot.parents[1]?.sha !== commit)
    )
        throw new Error(
            "Invalid stable release commit: does not match its source tag",
        );
    return commit;
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
    const target = taggedCommit(base, tag);
    if (target?.sha !== commit)
        throw new Error(
            `Tag ${tag} points to a different commit; refusing to promote`,
        );
    const tree = requireSha(target.tree);
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
    const onMain = githubApi(`${base}/compare/${commit}...${main}`, {
        jq: "{status: .status}",
    })?.status;
    if (onMain !== "ahead" && onMain !== "identical")
        throw new Error("Stable release commit must belong to main");

    // Only an exact missing ref permits creation; API failures propagate.
    const matches = githubApi(`${base}/git/matching-refs/heads/stable`);
    if (!Array.isArray(matches)) throw new Error("Invalid stable ref lookup");
    const refs = matches.filter((ref) => ref?.ref === "refs/heads/stable");
    if (refs.length > 1) throw new Error("Ambiguous stable ref lookup");
    const current = refs.length ? stableCommit(refs[0]) : undefined;
    if (current) {
        const source = stableSource(base, current);
        if (source === commit) {
            process.stdout.write(
                `Stable already includes ${tag} at ${current}; unchanged.\n`,
            );
            return;
        }
        // Order releases by their tagged source commits.
        // GitHub's commits list can be truncated; status describes the full comparison.
        const status = githubApi(`${base}/compare/${source}...${commit}`, {
            jq: "{status: .status}",
        })?.status;
        if (status === "behind" || status === "identical") {
            process.stdout.write(
                `Stable already includes ${tag} at ${current}; unchanged.\n`,
            );
            return;
        }
        if (status !== "ahead")
            throw new Error("Stable source history diverges from this release");
    }
    const message = `Release ${tag}\n\nSource-Commit: ${commit}`;
    const parents = current ? [current, commit] : [];
    const created = githubApi(`${base}/git/commits`, {
        method: "POST",
        body: { message, tree, parents },
    });
    const sha = requireSha(created?.sha);
    if (
        created.message !== message ||
        created.tree?.sha !== tree ||
        !Array.isArray(created.parents) ||
        created.parents.length !== parents.length ||
        created.parents.some((parent, index) => parent?.sha !== parents[index])
    )
        throw new Error("GitHub did not confirm the requested release commit");
    // Stable's first parent preserves the release sequence; its second links main.
    // A concurrent promotion creates a sibling, which force:false rejects.
    const updated = current
        ? githubApi(`${base}/git/refs/heads/stable`, {
              method: "PATCH",
              body: { sha, force: false },
          })
        : githubApi(`${base}/git/refs`, {
              method: "POST",
              body: { ref: "refs/heads/stable", sha },
          });
    if (stableCommit(updated) !== sha)
        throw new Error(
            "GitHub did not confirm stable at the requested commit",
        );
    process.stdout.write(
        `Promoted stable to ${tag} at ${sha} (source ${commit}).\n`,
    );
}

try {
    promote();
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
