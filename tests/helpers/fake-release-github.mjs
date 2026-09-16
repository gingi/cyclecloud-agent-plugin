import { appendFileSync, readFileSync } from "node:fs";

const state = JSON.parse(readFileSync(process.env.FAKE_RELEASE_STATE, "utf8"));
const args = process.argv.slice(2);
const methodIndex = args.indexOf("--method");
const method = methodIndex < 0 ? "GET" : args[methodIndex + 1];
const route = args.find((arg) => arg.startsWith("repos/"));
const body = args.includes("--input")
    ? JSON.parse(readFileSync(0, "utf8"))
    : undefined;
appendFileSync(
    process.env.FAKE_RELEASE_CALLS,
    `${JSON.stringify({ method, route, body })}\n`,
);
if (route === state.failRoute) {
    process.stderr.write("Simulated GitHub API failure\n");
    process.exit(1);
}
const base = "repos/example/plugin";
let result;
if (route === base) result = { default_branch: "main" };
else if (route === `${base}/git/ref/heads/main`)
    result = { object: { sha: state.base } };
else if (route.includes("/git/matching-refs/tags/")) result = state.tags ?? [];
else if (route.includes("/git/matching-refs/heads/"))
    result = state.branches ?? [];
else if (route.startsWith(`${base}/commits/refs%2Ftags%2F`))
    result = { sha: state.tagCommit };
else if (route.includes("/pulls?state=all")) result = state.prs ?? [];
else if (route.includes("/pulls?state=open")) result = state.openPrs ?? [];
else if (route.endsWith("/reviews?per_page=100")) result = state.reviews ?? [];
else if (route === `${base}/releases/generate-notes`)
    result = { body: "## What's Changed\n\n- Example change (#1)\n" };
else if (route === `${base}/git/commits/${state.base}`)
    result = { tree: { sha: "b".repeat(40) } };
else if (route === `${base}/git/trees`) result = { sha: "c".repeat(40) };
else if (route === `${base}/git/commits`) result = { sha: "d".repeat(40) };
else if (route === `${base}/git/refs`)
    result = { ref: body.ref, object: { sha: body.sha } };
else if (route === `${base}/pulls`)
    result = {
        number: 12,
        html_url: "https://github.com/example/plugin/pull/12",
    };
else throw new Error(`Unexpected GitHub call: ${method} ${route}`);
process.stdout.write(
    JSON.stringify(args.includes("--slurp") ? [result] : result),
);
