import { execFileSync } from "node:child_process";

export function releaseRepository() {
    const repository = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""))
        throw new Error("GH_REPO must identify owner/repository");
    return repository;
}

export function githubApi(route, { paginate = false, method, body, jq } = {}) {
    const args = ["api", route];
    if (paginate) args.push("--paginate", "--slurp");
    if (jq) args.push("--jq", jq);
    if (method) args.push("--method", method);
    if (body !== undefined) args.push("--input", "-");
    const result = JSON.parse(
        execFileSync("gh", args, {
            input: body === undefined ? undefined : JSON.stringify(body),
            encoding: "utf8",
            timeout: 30_000,
            stdio: ["pipe", "pipe", "pipe"],
        }),
    );
    return paginate ? result.flat() : result;
}

export function requireSha(value) {
    if (!/^[a-f0-9]{40}$/.test(value ?? ""))
        throw new Error("Expected a full commit SHA");
    return value;
}
