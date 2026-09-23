import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const state = JSON.parse(readFileSync(process.env.FAKE_RELEASE_STATE, "utf8"));
const args = process.argv.slice(2);
const input =
    args.includes("--notes-file") || args.includes("--input")
        ? readFileSync(0, "utf8")
        : undefined;
appendFileSync(
    process.env.FAKE_RELEASE_CALLS,
    `${JSON.stringify({ args, input })}\n`,
);
if (args.includes(state.fail)) {
    process.stderr.write("Simulated GitHub failure\n");
    process.exit(1);
}
if (args[0] === "release") {
    if (args[1] !== "create")
        throw new Error(`Unexpected release command: ${args}`);
    for (const file of args.slice(3, args.indexOf("--verify-tag")))
        readFileSync(file);
} else if (args[0] === "api") {
    const route = args[1];
    let result;
    if (route.includes("/commits/refs%2Ftags%2F")) {
        const tag = decodeURIComponent(route.split("/commits/")[1]).slice(10);
        const tagged = state.tagCommits?.[tag];
        result = {
            sha: tagged?.sha ?? state.commit,
            commit: { tree: { sha: tagged?.tree ?? state.tree } },
        };
    } else if (route.endsWith("/git/commits")) {
        const body = JSON.parse(input);
        result = state.commitResponse ?? {
            sha: createHash("sha1").update(input).digest("hex"),
            message: body.message,
            tree: { sha: body.tree },
            parents: body.parents.map((sha) => ({ sha })),
        };
        state.gitCommits ??= {};
        state.gitCommits[result.sha] = result;
        writeFileSync(process.env.FAKE_RELEASE_STATE, JSON.stringify(state));
    } else if (route.includes("/git/commits/")) {
        result = state.gitCommits?.[route.split("/git/commits/")[1]];
        if (!result) throw new Error(`Unknown commit: ${route}`);
    } else if (route.endsWith("/releases?per_page=100"))
        result = state.releases ?? [];
    else if (route.includes("/releases/tags/")) result = state.release;
    else if (route.endsWith("/commits/refs%2Fheads%2Fmain"))
        result = { sha: state.main };
    else if (route.endsWith(`/compare/${state.commit}...${state.main}`))
        result = state.mainComparison;
    else if (route.includes("/compare/")) result = state.stableComparison;
    else if (route.endsWith("/git/matching-refs/heads/stable"))
        result = state.stableRefs;
    else if (
        route.endsWith("/git/refs") ||
        route.endsWith("/git/refs/heads/stable")
    ) {
        const method = args[args.indexOf("--method") + 1];
        const body = JSON.parse(input);
        if (state.raceStable) {
            state.stableRefs = [state.raceStable];
            state.stableComparison = { status: "behind" };
            delete state.raceStable;
            writeFileSync(
                process.env.FAKE_RELEASE_STATE,
                JSON.stringify(state),
            );
            process.stderr.write("Concurrent ref change rejected\n");
            process.exit(1);
        }
        if (method === "POST") {
            if (
                body.ref !== "refs/heads/stable" ||
                state.stableRefs.some((ref) => ref.ref === body.ref)
            )
                throw new Error("Invalid ref creation");
        } else if (method === "PATCH") {
            if (body.force !== false)
                throw new Error("Expected typed force:false");
        } else throw new Error(`Unexpected write method: ${method}`);
        result = state.writeResponse ?? {
            ref: "refs/heads/stable",
            object: { type: "commit", sha: body.sha },
        };
        state.stableRefs = [result];
        writeFileSync(process.env.FAKE_RELEASE_STATE, JSON.stringify(state));
    } else throw new Error(`Unexpected GitHub API route: ${route}`);
    if (state.largeResponse === route)
        result = { ...result, files: [{ patch: "x".repeat(2 * 1024 * 1024) }] };
    if (args.includes("--jq")) {
        const query = args[args.indexOf("--jq") + 1];
        if (query === "{sha: .sha}") result = { sha: result?.sha };
        else if (query === "{sha: .sha, tree: .commit.tree.sha}")
            result = { sha: result?.sha, tree: result?.commit?.tree?.sha };
        else if (query === "{status: .status}")
            result = { status: result?.status };
        else throw new Error(`Unexpected GitHub API query: ${query}`);
    }
    process.stdout.write(
        JSON.stringify(args.includes("--slurp") ? [result] : result),
    );
} else {
    throw new Error(`Unexpected GitHub command: ${args}`);
}
