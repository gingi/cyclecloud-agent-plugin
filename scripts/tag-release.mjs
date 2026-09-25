import { execFileSync } from "node:child_process";
import { checkReleaseVersions, versionFromTag } from "./release-version.mjs";
import { readReleaseNotes } from "./release-changelog.mjs";
import { requireSha } from "./release-github.mjs";
import {
    fetchOrigin,
    refCommit,
    releaseGit,
    requireCleanCheckout,
} from "./release-git.mjs";
import {
    checkStableParent,
    gitCommit,
    releaseMessage,
    requireForwardSource,
    requireMainSource,
    validateLocalRelease,
} from "./release-commit.mjs";

function currentStable(git) {
    const ref = git("ls-remote", "--heads", "origin", "refs/heads/stable");
    if (!ref) return undefined;
    const sha = requireSha(ref.split("\t")[0]);
    // The branch can advance between fetching origin and reading its current ref.
    try {
        git("cat-file", "-e", `${sha}^{commit}`);
    } catch {
        git("fetch", "--no-tags", "--no-prune", "origin", sha);
    }
    return sha;
}

try {
    const args = process.argv.slice(2);
    if (
        args.length < 1 ||
        args.length > 2 ||
        (args.length === 2 && args[1] !== "--push")
    )
        throw new Error("Usage: npm run release:tag -- <version> [--push]");
    const version = versionFromTag(`v${args[0]}`);
    const tag = `v${version}`;
    const ref = `refs/tags/${tag}`;
    const prerelease = version.includes("-");
    const push = args[1] === "--push";
    const root = process.cwd();
    const git = releaseGit(root);
    requireCleanCheckout(git);
    const head = requireSha(git("rev-parse", "HEAD"));
    fetchOrigin(git);
    await checkReleaseVersions(root, tag);
    await readReleaseNotes(root, tag);
    if (!prerelease) requireMainSource(git, head);
    const local = refCommit(git, ref);
    const localObject = local ? git("rev-parse", ref) : undefined;
    const remoteRefs = new Map(
        git("ls-remote", "--tags", "origin", ref, `${ref}^{}`)
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [sha, name] = line.split("\t");
                return [name, requireSha(sha)];
            }),
    );
    const remote = remoteRefs.get(`${ref}^{}`) ?? remoteRefs.get(ref);
    if (local && remote && local !== remote)
        throw new Error(
            `Tag ${tag} already identifies a different commit; refusing to move it`,
        );
    if (remote && !local) {
        git("fetch", "--no-tags", "--no-prune", "origin", ref);
        if (git("rev-parse", "FETCH_HEAD^{commit}") !== remote)
            throw new Error(
                `Remote tag ${tag} changed during fetch; inspect it before continuing`,
            );
    }
    let commit = local ?? remote;
    if (commit) {
        // Published source tags remain immutable; only new stable tags need release topology.
        const source =
            prerelease || (remote === head && commit === head)
                ? commit
                : validateLocalRelease(git, commit, tag).source;
        if (source !== head)
            throw new Error(
                `Tag ${tag} already identifies a different commit; refusing to move it`,
            );
    }
    if ((!local && !remote) || (push && !remote)) {
        const npm = process.env.npm_execpath;
        if (!npm)
            throw new Error(
                "Run this command through npm run release:tag so verification can run",
            );
        execFileSync(process.execPath, [npm, "run", "verify"], {
            cwd: root,
            stdio: "inherit",
            timeout: 600_000,
        });
    }
    if (git("rev-parse", "HEAD") !== head)
        throw new Error(
            "The selected commit changed during verification; inspect the checkout and retry",
        );
    requireCleanCheckout(git);
    if (
        refCommit(git, ref) !== local ||
        (local && git("rev-parse", ref) !== localObject)
    )
        throw new Error(
            `Tag ${tag} changed during verification; inspect it before continuing`,
        );

    if (!prerelease && !remote) {
        const stable = currentStable(git);
        if (commit) {
            checkStableParent(
                validateLocalRelease(git, commit, tag).snapshot,
                stable,
            );
        } else {
            if (stable) requireForwardSource(git, stable, head);
            commit = requireSha(
                git(
                    "commit-tree",
                    gitCommit(git, head).tree.sha,
                    ...(stable ? ["-p", stable, "-p", head] : []),
                    "-m",
                    releaseMessage(tag, head),
                ),
            );
            validateLocalRelease(git, commit, tag);
        }
    }
    commit ??= head;
    if (!local) {
        if (remote) {
            git("fetch", "--no-tags", "--no-prune", "origin", `${ref}:${ref}`);
            if (refCommit(git, ref) !== commit)
                throw new Error(
                    `Remote tag ${tag} changed during fetch; inspect it before continuing`,
                );
        } else {
            git(
                "tag",
                "--annotate",
                tag,
                "--message",
                `Release ${tag}`,
                commit,
            );
        }
    }
    const object = requireSha(git("rev-parse", ref));
    if (git("rev-parse", `${object}^{commit}`) !== commit)
        throw new Error(
            `Tag ${tag} changed during verification; inspect it before continuing`,
        );
    if (push && !remote) {
        git("push", "--no-follow-tags", "origin", `${object}:${ref}`);
        process.stdout.write(
            `Pushed ${tag} at ${commit} (source ${head}); watch the Release workflow on GitHub. Stable has not been advanced.\n`,
        );
    } else if (remote) {
        process.stdout.write(
            `Tag ${tag} already exists on origin at ${commit}; it was not changed or pushed again.\n`,
        );
    } else {
        process.stdout.write(
            `Tag ${tag} is ready locally at ${commit} (source ${head}). Run npm run release:tag -- ${version} --push to publish it. Stable has not been advanced.\n`,
        );
    }
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
