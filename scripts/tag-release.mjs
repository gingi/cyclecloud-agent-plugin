import { versionFromTag } from "./release-version.mjs";
import { githubApi, releaseRepository, requireSha } from "./release-github.mjs";

try {
    if (process.argv.length !== 4)
        throw new Error("Usage: node scripts/tag-release.mjs <tag> <commit>");
    const [tag, commit] = process.argv.slice(2);
    versionFromTag(tag);
    requireSha(commit);
    const base = `repos/${releaseRepository()}`;
    const refs = githubApi(`${base}/git/matching-refs/tags/${tag}`, {
        paginate: true,
    });
    if (refs.some((ref) => ref.ref === `refs/tags/${tag}`)) {
        const target = githubApi(
            `${base}/commits/${encodeURIComponent(`refs/tags/${tag}`)}`,
        ).sha;
        if (target !== commit)
            throw new Error(
                `Tag ${tag} already points to a different commit; refusing to move it`,
            );
        process.stdout.write(`Tag ${tag} already identifies ${commit}\n`);
    } else {
        githubApi(`${base}/git/refs`, {
            body: { ref: `refs/tags/${tag}`, sha: commit },
        });
        process.stdout.write(`Created tag ${tag} at ${commit}\n`);
    }
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
