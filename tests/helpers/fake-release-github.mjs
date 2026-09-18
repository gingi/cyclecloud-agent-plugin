import { appendFileSync, readFileSync } from "node:fs";

const state = JSON.parse(readFileSync(process.env.FAKE_RELEASE_STATE, "utf8"));
const args = process.argv.slice(2);
const input = args.includes("--notes-file")
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
    for (const file of args.slice(3, 6)) readFileSync(file);
} else if (args[0] === "api") {
    const route = args[1];
    let result;
    if (route.includes("/commits/refs%2Ftags%2F"))
        result = { sha: state.commit };
    else if (route.endsWith("/releases?per_page=100"))
        result = state.releases ?? [];
    else throw new Error(`Unexpected GitHub API route: ${route}`);
    process.stdout.write(
        JSON.stringify(args.includes("--slurp") ? [result] : result),
    );
} else {
    throw new Error(`Unexpected GitHub command: ${args}`);
}
