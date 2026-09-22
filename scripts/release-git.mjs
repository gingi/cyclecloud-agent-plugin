import { execFileSync } from "node:child_process";
import { requireSha } from "./release-github.mjs";

export function releaseGit(root) {
    return (...args) =>
        execFileSync("git", args, {
            cwd: root,
            encoding: "utf8",
            timeout: 30_000,
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
}

export function requireCleanCheckout(git) {
    if (git("status", "--porcelain"))
        throw new Error(
            "Release operation requires a clean working tree and index; commit or save your changes first",
        );
}

export function refCommit(git, ref) {
    const refs = git("for-each-ref", "--format=%(refname)", ref).split("\n");
    return refs.includes(ref)
        ? requireSha(git("rev-parse", `${ref}^{commit}`))
        : undefined;
}

export function fetchOrigin(git, tags = false) {
    git(
        "fetch",
        "--no-prune",
        tags ? "--tags" : "--no-tags",
        "origin",
        "+refs/heads/*:refs/remotes/origin/*",
    );
}
