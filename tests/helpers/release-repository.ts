import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setFixtureVersion } from "./release.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const releaseManifests = [
    "package.json",
    "package-lock.json",
    "plugin.json",
    ".github/plugin/marketplace.json",
];

export async function releaseRepository() {
    const directory = await mkdtemp(join(tmpdir(), "release repository "));
    const checkout = join(directory, "checkout");
    const remote = join(directory, "origin.git");
    for (const file of [...releaseManifests, ".prettierrc.json"]) {
        await mkdir(dirname(join(checkout, file)), { recursive: true });
        await cp(join(root, file), join(checkout, file));
    }
    await setFixtureVersion(checkout, "0.1.0");
    await writeFile(
        join(checkout, "CHANGELOG.md"),
        "# Changelog\n\n## [0.1.0]\n\nPrevious release.\n",
    );
    const git = (...args: string[]) =>
        execFileSync("git", ["-C", checkout, ...args], {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    git("config", "core.hooksPath", "/dev/null");
    const commit = (subject: string) => {
        git("add", ".");
        git("commit", "--quiet", "--allow-empty", "-m", subject);
        return git("rev-parse", "HEAD");
    };
    commit("feat: initial implementation");
    git("init", "--bare", "--quiet", "--initial-branch=main", remote);
    git("remote", "add", "origin", remote);
    git("push", "--quiet", "--set-upstream", "origin", "main");
    return { directory, checkout, remote, git, commit };
}
