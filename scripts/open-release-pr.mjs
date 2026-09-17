import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { prepareReleaseChanges } from "./prepare-release.mjs";
import { versionFromTag } from "./release-version.mjs";
import { prepareChangelog, readChangelog } from "./release-changelog.mjs";
import { githubApi, releaseRepository, requireSha } from "./release-github.mjs";

function git(...args) {
    return execFileSync("git", args, {
        encoding: "utf8",
        timeout: 30_000,
    }).trim();
}

async function report(pr) {
    if (!Number.isSafeInteger(pr.number) || pr.number < 1)
        throw new Error("GitHub returned an invalid PR number");
    const url = `https://github.com/${releaseRepository()}/pull/${pr.number}`;
    process.stdout.write(`Release PR: ${url}\n`);
    if (process.env.GITHUB_OUTPUT)
        await appendFile(process.env.GITHUB_OUTPUT, `url=${url}\n`);
}

async function main() {
    if (process.argv.length !== 3)
        throw new Error(
            "Usage: npm run release:request -- <version> (creates a remote branch and PR)",
        );
    const version = versionFromTag(`v${process.argv[2]}`);
    const tag = `v${version}`;
    const branch = `release/${tag}`;
    const repository = releaseRepository();
    const base = `repos/${repository}`;
    if (git("status", "--porcelain"))
        throw new Error(
            "Release preparation requires a clean checkout of the default branch",
        );
    const commit = requireSha(git("rev-parse", "HEAD"));
    const defaultBranch = githubApi(base).default_branch;
    if (typeof defaultBranch !== "string" || !defaultBranch)
        throw new Error("Missing repository default branch");
    const remote = githubApi(
        `${base}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
    );
    if (remote.object?.sha !== commit)
        throw new Error(
            "Checkout does not match the current default branch; update it and retry",
        );
    const tags = githubApi(`${base}/git/matching-refs/tags/${tag}`, {
        paginate: true,
    });
    if (tags.some((ref) => ref.ref === `refs/tags/${tag}`))
        throw new Error(
            `Tag ${tag} already exists; choose a new release version`,
        );
    const head = encodeURIComponent(`${repository.split("/")[0]}:${branch}`);
    const prs = githubApi(
        `${base}/pulls?state=all&head=${head}&base=${encodeURIComponent(defaultBranch)}&per_page=100`,
        { paginate: true },
    );
    const matching = prs.filter(
        (pr) =>
            pr.head?.repo?.full_name === repository &&
            pr.head?.ref === branch &&
            pr.base?.ref === defaultBranch,
    );
    const open = matching.find((pr) => pr.state === "open");
    if (open) {
        await report(open);
        process.stdout.write(
            "Keeping the existing PR and reviewer edits unchanged.\n",
        );
        return;
    }
    if (matching.length)
        throw new Error(
            "A closed release PR already exists for this version; inspect it rather than reopening automatically",
        );
    const branches = githubApi(`${base}/git/matching-refs/heads/${branch}`, {
        paginate: true,
    });
    if (branches.some((ref) => ref.ref === `refs/heads/${branch}`))
        throw new Error(
            `Branch ${branch} already exists without an open release PR; inspect it and open the PR manually. It will not be overwritten.`,
        );

    const changes = await prepareReleaseChanges(process.cwd(), version);
    const notes = githubApi(`${base}/releases/generate-notes`, {
        body: { tag_name: tag, target_commitish: commit },
    });
    if (typeof notes.body !== "string")
        throw new Error("GitHub did not return release notes");
    const filepath = join(process.cwd(), "CHANGELOG.md");
    const changelog = prepareChangelog(
        await readChangelog(process.cwd()),
        tag,
        notes.body,
    );
    changes.push([
        "CHANGELOG.md",
        await format(changelog, {
            ...(await resolveConfig(filepath)),
            filepath,
        }),
    ]);
    const sourceTree = requireSha(
        githubApi(`${base}/git/commits/${commit}`).tree?.sha,
    );
    const tree = githubApi(`${base}/git/trees`, {
        body: {
            base_tree: sourceTree,
            tree: changes.map(([path, content]) => ({
                path,
                mode: "100644",
                type: "blob",
                content,
            })),
        },
    });
    const prepared = githubApi(`${base}/git/commits`, {
        body: {
            message: `chore: prepare ${tag}`,
            tree: requireSha(tree.sha),
            parents: [commit],
        },
    });
    githubApi(`${base}/git/refs`, {
        body: { ref: `refs/heads/${branch}`, sha: requireSha(prepared.sha) },
    });
    const pr = githubApi(`${base}/pulls`, {
        body: {
            title: `Release ${tag}`,
            head: branch,
            base: defaultBranch,
            body: `Prepare ${tag} for release.\n\nReview the version changes and the ${version} entry in CHANGELOG.md, and wait for the Development build checks and package artifact. A current human approval is required before merging.\n\nMerging this PR triggers the Release workflow on the recorded merge commit: build, tag, publish, public curl verification, and safe branch cleanup. No tag or release has been created yet.`,
        },
    });
    await report(pr);
}

try {
    await main();
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
