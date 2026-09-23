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
    const push = args[1] === "--push";
    const root = process.cwd();
    const git = releaseGit(root);
    requireCleanCheckout(git);
    const head = requireSha(git("rev-parse", "HEAD"));
    fetchOrigin(git);
    await checkReleaseVersions(root, tag);
    await readReleaseNotes(root, tag);
    const local = refCommit(git, ref);
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
    if ((local && local !== head) || (remote && remote !== head))
        throw new Error(
            `Tag ${tag} already identifies a different commit; refusing to move it`,
        );
    if (!version.includes("-")) {
        try {
            git(
                "merge-base",
                "--is-ancestor",
                head,
                "refs/remotes/origin/main",
            );
        } catch {
            throw new Error(
                "Stable release commit must be merged into origin/main before tagging",
            );
        }
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
    if (!local) {
        if (remote) {
            git("fetch", "--no-tags", "--no-prune", "origin", `${ref}:${ref}`);
            if (refCommit(git, ref) !== head)
                throw new Error(
                    `Remote tag ${tag} changed during fetch; inspect it before continuing`,
                );
        } else {
            git("tag", "--annotate", tag, "--message", `Release ${tag}`, head);
        }
    }
    const object = requireSha(git("rev-parse", ref));
    if (git("rev-parse", `${object}^{commit}`) !== head)
        throw new Error(
            `Tag ${tag} changed during verification; inspect it before continuing`,
        );
    if (push && !remote) {
        git("push", "--no-follow-tags", "origin", `${object}:${ref}`);
        process.stdout.write(
            `Pushed ${tag} at ${head}; watch the Release workflow on GitHub.\n`,
        );
    } else if (remote) {
        process.stdout.write(
            `Tag ${tag} already exists on origin at ${head}; it was not changed or pushed again.\n`,
        );
    } else {
        process.stdout.write(
            `Tag ${tag} is ready locally at ${head}. Run npm run release:tag -- ${version} --push to publish it.\n`,
        );
    }
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
