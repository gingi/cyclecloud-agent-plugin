import { execFileSync } from "node:child_process";
import { versionFromTag } from "./release-version.mjs";

function api(...args) {
    return JSON.parse(
        execFileSync("gh", ["api", ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 30_000,
        }),
    );
}

try {
    const [tag, commit] = process.argv.slice(2);
    versionFromTag(tag);
    const repository = process.env.GH_REPO;
    if (process.argv.length !== 4 || !/^[a-f0-9]{40}$/.test(commit ?? ""))
        throw new Error("A full verified commit SHA is required");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""))
        throw new Error("GH_REPO must identify owner/repository");
    const base = `repos/${repository}`;
    // A successful empty list means absent; authentication/network failures must stop.
    const refs = api(`${base}/git/matching-refs/tags/${tag}`);
    if (!Array.isArray(refs))
        throw new Error("Unexpected tag inventory response");
    if (refs.some((ref) => ref.ref === `refs/tags/${tag}`)) {
        const target = api(
            `${base}/commits/${encodeURIComponent(`refs/tags/${tag}`)}`,
        ).sha;
        if (target !== commit)
            throw new Error(
                `Tag ${tag} already points to a different commit; refusing to move it`,
            );
        process.stdout.write(`Tag ${tag} already identifies ${commit}\n`);
    } else {
        api(
            "--method",
            "POST",
            `${base}/git/refs`,
            "-f",
            `ref=refs/tags/${tag}`,
            "-f",
            `sha=${commit}`,
        );
        process.stdout.write(`Created tag ${tag} at ${commit}\n`);
    }
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
