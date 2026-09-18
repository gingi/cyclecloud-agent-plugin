import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { versionFromTag } from "./release-version.mjs";
import { readReleaseNotes } from "./release-changelog.mjs";
import { githubApi, releaseRepository, requireSha } from "./release-github.mjs";

try {
    if (process.argv.length !== 5)
        throw new Error(
            "Usage: node scripts/publish-release.mjs <tag> <commit> <assets-directory>",
        );
    const [tag, commit, assets] = process.argv.slice(2);
    const version = versionFromTag(tag);
    requireSha(commit);
    const repository = releaseRepository();
    const base = `repos/${repository}`;
    const target = githubApi(
        `${base}/commits/${encodeURIComponent(`refs/tags/${tag}`)}`,
    ).sha;
    if (target !== commit)
        throw new Error(
            `Tag ${tag} points to a different commit; refusing to publish`,
        );
    const releases = githubApi(`${base}/releases?per_page=100`, {
        paginate: true,
    });
    if (releases.some((release) => release.tag_name === tag))
        throw new Error(
            `Release or draft ${tag} already exists; inspect it rather than overwriting`,
        );
    const notes = await readReleaseNotes(process.cwd(), tag);
    // With assets, gh creates a draft, uploads everything, then publishes it.
    execFileSync(
        "gh",
        [
            "release",
            "create",
            tag,
            join(assets, `cyclecloud-mcp-${version}.tar.gz`),
            join(assets, "install.sh"),
            join(assets, "SHA256SUMS"),
            "--verify-tag",
            "--title",
            tag,
            "--notes-file",
            "-",
            ...(version.includes("-")
                ? ["--prerelease", "--latest=false"]
                : []),
        ],
        {
            env: { ...process.env, GH_REPO: repository },
            input: notes,
            encoding: "utf8",
            stdio: ["pipe", "inherit", "inherit"],
            timeout: 120_000,
        },
    );
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
