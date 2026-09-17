import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { releasePrContext } from "./release-context.mjs";
import { githubApi, releaseRepository } from "./release-github.mjs";

try {
    const repository = releaseRepository();
    const event = JSON.parse(
        await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    const context = releasePrContext(event, repository);
    if (!context)
        throw new Error(
            "Cleanup requires a merged release PR from this repository",
        );
    const refs = githubApi(
        `repos/${repository}/git/matching-refs/heads/${context.branch}`,
        { paginate: true },
    );
    const ref = refs.find(
        (item) => item.ref === `refs/heads/${context.branch}`,
    );
    if (!ref) {
        process.stdout.write("Release branch is already absent.\n");
    } else if (ref.object?.sha !== context.head) {
        process.stdout.write(
            "Keeping release branch: it has changed since the PR merged.\n",
        );
    } else {
        const head = encodeURIComponent(
            `${repository.split("/")[0]}:${context.branch}`,
        );
        const prs = githubApi(
            `repos/${repository}/pulls?state=open&head=${head}&per_page=100`,
            { paginate: true },
        );
        if (prs.length) {
            process.stdout.write(
                "Keeping release branch: another open PR uses it.\n",
            );
        } else {
            // The lease also protects against a push between the API check and deletion.
            execFileSync(
                "git",
                [
                    "-c",
                    "credential.helper=",
                    "-c",
                    "credential.helper=!gh auth git-credential",
                    "push",
                    `--force-with-lease=refs/heads/${context.branch}:${context.head}`,
                    `https://github.com/${repository}.git`,
                    `:refs/heads/${context.branch}`,
                ],
                { stdio: "inherit", timeout: 30_000 },
            );
            process.stdout.write(
                `Deleted merged release branch ${context.branch}\n`,
            );
        }
    }
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
