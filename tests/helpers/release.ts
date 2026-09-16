import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Versioned {
    version: string;
}

// Arrange fixture versions independently of the preparation code under test.
export async function setFixtureVersion(directory: string, version: string) {
    for (const file of ["package.json", "plugin.json"]) {
        const path = join(directory, file);
        const value = JSON.parse(await readFile(path, "utf8")) as Versioned;
        value.version = version;
        await writeFile(path, JSON.stringify(value));
    }
    const lockPath = join(directory, "package-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as Versioned & {
        packages: { "": Versioned };
    };
    lock.version = version;
    lock.packages[""].version = version;
    await writeFile(lockPath, JSON.stringify(lock));
    const marketplacePath = join(directory, ".github/plugin/marketplace.json");
    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as {
        metadata: Versioned;
        plugins: [Versioned];
    };
    marketplace.metadata.version = version;
    marketplace.plugins[0].version = version;
    await writeFile(marketplacePath, JSON.stringify(marketplace));
}
