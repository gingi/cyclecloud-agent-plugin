import { requireSha } from "./release-github.mjs";
import { versionFromTag } from "./release-version.mjs";

export function releaseMessage(tag, source) {
    return `Release ${tag}\n\nSource-Commit: ${source}`;
}

export function releaseSource(snapshot, tag, allowSnapshot = false) {
    requireSha(snapshot?.sha);
    requireSha(snapshot.tree?.sha);
    const match = snapshot.message?.match(
        /^Release (v[^\n]+)\n\nSource-Commit: ([a-f0-9]{40})\n?$/,
    );
    if (
        !match ||
        (tag && match[1] !== tag) ||
        versionFromTag(match[1]).includes("-")
    )
        throw new Error(
            "Expected a stable release commit with matching tag and Source-Commit metadata",
        );
    const source = match[2];
    if (!Array.isArray(snapshot.parents))
        throw new Error("Invalid release commit parents");
    const parents = snapshot.parents.map((parent) => requireSha(parent?.sha));
    if (
        !(
            parents.length === 0 ||
            (allowSnapshot && parents.length === 1) ||
            (parents.length === 2 &&
                parents[1] === source &&
                parents[0] !== source)
        )
    )
        throw new Error(
            "Invalid release commit parents: expected stable first and source second",
        );
    return source;
}

export function stableSource(snapshot) {
    // Existing stable tips may be ordinary main commits or release snapshots.
    return snapshot.message?.startsWith("Release ") &&
        snapshot.message.includes("Source-Commit:")
        ? releaseSource(snapshot, undefined, true)
        : requireSha(snapshot.sha);
}

export function checkSourceTree(snapshot, source) {
    if (requireSha(snapshot.tree?.sha) !== requireSha(source.tree?.sha))
        throw new Error("Release commit tree must match its main source tree");
}

export function checkStableParent(snapshot, current) {
    const expected =
        snapshot.parents.length === 2 ? snapshot.parents[0].sha : undefined;
    if (current !== expected)
        throw new Error(
            "Stable changed since this release was prepared; refusing to replace its history",
        );
}

export function gitCommit(git, ref) {
    const [sha, tree, parents, ...message] = git(
        "show",
        "--no-patch",
        "--format=%H%n%T%n%P%n%B",
        `${ref}^{commit}`,
    ).split("\n");
    return {
        sha: requireSha(sha),
        tree: { sha: requireSha(tree) },
        parents: parents
            ? parents.split(" ").map((sha) => ({ sha: requireSha(sha) }))
            : [],
        message: message.join("\n"),
    };
}

export function requireMainSource(git, source) {
    try {
        git("merge-base", "--is-ancestor", source, "refs/remotes/origin/main");
    } catch {
        throw new Error(
            "Stable release source must belong to fetched origin/main",
        );
    }
}

export function requireForwardSource(git, previous, source) {
    const snapshot = gitCommit(git, previous);
    const previousSource = stableSource(snapshot);
    checkSourceTree(snapshot, gitCommit(git, previousSource));
    if (previousSource === source)
        throw new Error("Stable already contains this release source");
    try {
        git("merge-base", "--is-ancestor", previousSource, source);
    } catch {
        throw new Error(
            "Stable source history does not advance to this release",
        );
    }
}

export function validateLocalRelease(git, commit, tag) {
    const snapshot = gitCommit(git, commit);
    const source = releaseSource(snapshot, tag);
    checkSourceTree(snapshot, gitCommit(git, source));
    requireMainSource(git, source);
    if (snapshot.parents.length === 2)
        requireForwardSource(git, snapshot.parents[0].sha, source);
    return { snapshot, source };
}
