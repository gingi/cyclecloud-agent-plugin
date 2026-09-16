import { execFileSync } from "node:child_process";
import { appendFile, lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleaseVersions, versionFromTag } from "./release-version.mjs";
import { githubApi, releaseRepository, requireSha } from "./release-github.mjs";

export function releasePrContext(event, repository) {
    const pr = event.pull_request;
    if (
        event.action !== "closed" ||
        pr?.merged !== true ||
        event.repository?.full_name !== repository ||
        pr.base?.repo?.full_name !== repository ||
        pr.head?.repo?.full_name !== repository ||
        pr.base?.ref !== event.repository?.default_branch ||
        !pr.head?.ref?.startsWith("release/v")
    )
        return undefined;
    const tag = pr.head.ref.slice("release/".length);
    versionFromTag(tag);
    if (!Number.isSafeInteger(pr.number) || pr.number < 1)
        throw new Error("Invalid release PR number");
    return {
        tag,
        commit: requireSha(pr.merge_commit_sha),
        head: requireSha(pr.head.sha),
        branch: pr.head.ref,
        pr: pr.number,
        notes: `docs/releases/${tag}.md`,
    };
}

export function requireApproval(pr, reviews) {
    const latest = new Map();
    // GitHub returns reviews chronologically. Comments do not revoke an approval.
    for (const review of reviews) {
        if (
            review.user?.type !== "User" ||
            review.user.login === pr.user?.login ||
            !["OWNER", "MEMBER", "COLLABORATOR"].includes(
                review.author_association,
            )
        )
            continue;
        if (
            ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(
                review.state,
            )
        )
            latest.set(review.user.login, review);
    }
    if (
        [...latest.values()].some(
            (review) => review.state === "CHANGES_REQUESTED",
        )
    )
        throw new Error("Release PR still has changes requested");
    if (
        ![...latest.values()].some(
            (review) =>
                review.state === "APPROVED" && review.commit_id === pr.head.sha,
        )
    ) {
        throw new Error(
            "Release requires a current, non-author human approval from a repository owner/member/collaborator",
        );
    }
}

async function checkReleaseFiles(tag) {
    await checkReleaseVersions(process.cwd(), tag);
    let path = process.cwd();
    for (const component of `docs/releases/${tag}.md`.split("/")) {
        path = join(path, component);
        const info = await lstat(path);
        if (
            info.isSymbolicLink() ||
            (component.endsWith(".md") ? !info.isFile() : !info.isDirectory())
        ) {
            throw new Error(
                "Release notes must be a regular file in the checkout",
            );
        }
    }
    if (!(await readFile(path, "utf8")).trim())
        throw new Error("Reviewed release notes are empty");
}

async function main() {
    if (process.argv[2] === "--check-branch" && process.argv.length === 4) {
        const branch = process.argv[3];
        if (!branch.startsWith("release/v"))
            throw new Error("Expected a release/v<version> branch");
        const tag = branch.slice("release/".length);
        await checkReleaseFiles(tag);
        process.stdout.write(`Release PR contents match ${tag}\n`);
        return;
    }
    if (process.argv.length !== 2)
        throw new Error(
            "Usage: node scripts/release-pr-context.mjs [--check-branch release/v<version>]",
        );
    const repository = releaseRepository();
    const event = JSON.parse(
        await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    const context = releasePrContext(event, repository);
    if (!context) return;
    const actual = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
    }).trim();
    if (actual !== context.commit)
        throw new Error(
            "Checkout must be the recorded release PR merge commit",
        );
    if (
        execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
        }).trim()
    )
        throw new Error(
            "Release verification requires a clean merged checkout",
        );
    await checkReleaseFiles(context.tag);
    const reviews = githubApi(
        `repos/${repository}/pulls/${context.pr}/reviews?per_page=100`,
        { paginate: true },
    );
    requireApproval(event.pull_request, reviews);
    await appendFile(
        process.env.GITHUB_OUTPUT,
        `tag=${context.tag}\ncommit=${context.commit}\nnotes=${context.notes}\n`,
    );
    process.stdout.write(
        `Approved release PR #${context.pr}: ${context.tag} at merge commit ${context.commit}\n`,
    );
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        await main();
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
