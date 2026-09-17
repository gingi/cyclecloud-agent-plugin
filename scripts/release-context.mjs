import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleaseVersions, versionFromTag } from "./release-version.mjs";
import { githubApi, releaseRepository, requireSha } from "./release-github.mjs";
import { readReleaseNotes } from "./release-changelog.mjs";

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
    };
}

export function previewReleaseContext(
    event,
    repository,
    requestedVersion,
    env = process.env,
) {
    const version = versionFromTag(`v${requestedVersion}`);
    if (!version.includes("-"))
        throw new Error("Preview mode only accepts prerelease versions");
    if (
        env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
        event.inputs?.mode !== "preview" ||
        event.inputs?.version !== version
    ) {
        throw new Error(
            "Preview releases require an explicit preview workflow dispatch",
        );
    }
    if (event.repository?.full_name !== repository)
        throw new Error("Preview source must belong to this repository");
    if (
        !env.GITHUB_REF?.startsWith("refs/heads/") ||
        env.GITHUB_REF === `refs/heads/${event.repository.default_branch}`
    ) {
        throw new Error(
            "Preview releases require a non-default branch, not a tag or the default branch",
        );
    }
    return {
        tag: `v${version}`,
        commit: requireSha(env.GITHUB_SHA),
        branch: env.GITHUB_REF.slice("refs/heads/".length),
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
        ) &&
        // A recorded merger had merge permission. Self-merge is deliberately
        // allowed, but GitHub bot identities must not satisfy this gate.
        !(
            pr.merged_by?.type === "User" &&
            typeof pr.merged_by.login === "string" &&
            pr.merged_by.login.length > 0 &&
            !pr.merged_by.login.endsWith("[bot]")
        )
    ) {
        throw new Error(
            "Release requires a current human owner/member/collaborator approval or a deliberate merge by a GitHub user with merge access",
        );
    }
}

async function checkReleaseFiles(tag) {
    await checkReleaseVersions(process.cwd(), tag);
    await readReleaseNotes(process.cwd(), tag);
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
    const preview =
        process.argv[2] === "--preview" && process.argv.length === 4;
    if (!preview && process.argv.length !== 2)
        throw new Error(
            "Usage: node scripts/release-context.mjs [--check-branch release/v<version> | --preview <version>]",
        );
    const repository = releaseRepository();
    const event = JSON.parse(
        await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    const context = preview
        ? previewReleaseContext(event, repository, process.argv[3])
        : releasePrContext(event, repository);
    if (!context) return;
    const actual = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
    }).trim();
    if (actual !== context.commit)
        throw new Error("Checkout must match the selected release commit");
    if (
        execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
        }).trim()
    )
        throw new Error(
            "Release verification requires a clean committed checkout",
        );
    await checkReleaseFiles(context.tag);
    if (!preview) {
        const reviews = githubApi(
            `repos/${repository}/pulls/${context.pr}/reviews?per_page=100`,
            { paginate: true },
        );
        requireApproval(event.pull_request, reviews);
    }
    await appendFile(
        process.env.GITHUB_OUTPUT,
        `tag=${context.tag}\ncommit=${context.commit}\n`,
    );
    process.stdout.write(
        `${preview ? "Preview" : "Approved PR"} release ${context.tag} at ${context.commit}\n`,
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
