import { readFile } from "node:fs/promises";
import { join } from "node:path";

const number = "(?:0|[1-9][0-9]*)";
const identifier = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const versionTag = new RegExp(
    `^v(${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?)$`,
);

export function versionFromTag(tag) {
    const match = versionTag.exec(tag ?? "");
    if (!match || match[0] !== tag)
        throw new Error(
            "Expected a SemVer release tag v<version>, optionally with a prerelease",
        );
    return match[1];
}

export async function releaseDocuments(root) {
    const files = [
        "package.json",
        "package-lock.json",
        "plugin.json",
        ".github/plugin/marketplace.json",
    ];
    return Object.fromEntries(
        await Promise.all(
            files.map(async (file) => [
                file,
                JSON.parse(await readFile(join(root, file), "utf8")),
            ]),
        ),
    );
}

export async function checkReleaseVersions(root, tag) {
    const version = versionFromTag(tag);
    const documents = await releaseDocuments(root);
    const versions = {
        "package.json": documents["package.json"].version,
        "package-lock.json": documents["package-lock.json"].version,
        "package-lock.json root package":
            documents["package-lock.json"].packages?.[""]?.version,
        "plugin.json": documents["plugin.json"].version,
        "marketplace metadata":
            documents[".github/plugin/marketplace.json"].metadata?.version,
        "marketplace plugin":
            documents[".github/plugin/marketplace.json"].plugins?.[0]?.version,
    };
    for (const [file, actual] of Object.entries(versions)) {
        if (actual !== version)
            throw new Error(
                `${file} version ${actual} does not match release tag ${tag}`,
            );
    }
    return version;
}
