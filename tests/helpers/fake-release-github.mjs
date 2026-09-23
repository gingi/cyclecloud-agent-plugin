import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

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
    if (route.includes("/commits/refs%2Ftags%2F"))
        result = { sha: state.commit };
    else if (route.endsWith("/releases?per_page=100"))
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
    process.stdout.write(
        JSON.stringify(args.includes("--slurp") ? [result] : result),
    );
} else {
    throw new Error(`Unexpected GitHub command: ${args}`);
}
