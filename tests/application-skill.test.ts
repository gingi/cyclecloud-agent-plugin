import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const skill = fileURLToPath(
    new URL("../skills/author-cyclecloud-application/", import.meta.url),
);
const validator = join(skill, "scripts/validate-project.mjs");
let project: string;

beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "cyclecloud application test "));
});
afterEach(async () => {
    await rm(project, { recursive: true, force: true });
});

function validate(...args: string[]) {
    return spawnSync(process.execPath, [validator, ...args], {
        encoding: "utf8",
        timeout: 10_000,
    });
}

async function fixture() {
    await cp(join(skill, "assets/project"), project, { recursive: true });
}

async function resolvePlaceholders() {
    for (const file of [
        "project.ini",
        "README.md",
        "ATTACHMENT.md",
        "specs/install/cluster-init/scripts/10-install.sh",
        "specs/runtime/cluster-init/scripts/10-runtime.sh",
        "examples/openfoam.sbatch",
    ]) {
        const path = join(project, file);
        await writeFile(
            path,
            (await readFile(path, "utf8")).replaceAll(
                /TODO\([^\n)]*\)/g,
                "fixture-value",
            ),
        );
    }
}

describe("Application authoring skeleton", () => {
    test("declares the skill and links its bundled assets", async () => {
        const text = await readFile(join(skill, "SKILL.md"), "utf8");
        expect(text).toContain("name: author-cyclecloud-application");
        expect(text).toContain("assets/project");
        expect(text).toContain("scripts/validate-project.mjs");
        expect(text).toContain("Do not deploy");
    });

    test("guides context discovery and produces an actionable attachment handoff", async () => {
        const text = await readFile(join(skill, "SKILL.md"), "utf8");
        expect(text).toContain("get_cluster_application_context");
        expect(text).toContain('view="overview"');
        expect(text).toContain('view="details"');
        expect(text).toContain("nextOffset");
        expect(text).toContain("Do not exhaustively");
        expect(text).toContain("ATTACHMENT.md");
        const attachment = await readFile(
            join(skill, "assets/project/ATTACHMENT.md"),
            "utf8",
        );
        expect(attachment).toContain("usedBy");
        expect(attachment).toContain("terminate_cluster");
        expect(attachment).toContain("upload");
    });

    test("requires an attachment guide in the generated project", async () => {
        await fixture();
        await resolvePlaceholders();
        await rm(join(project, "ATTACHMENT.md"), { force: true });
        const result = validate(project);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
            "Missing or unreadable file: ATTACHMENT.md",
        );
    });

    test("requires version discovery before asking the user for environment facts", async () => {
        const text = await readFile(join(skill, "SKILL.md"), "utf8");
        expect(text).toContain("platform.release");
        expect(text).toContain("scheduler.version");
        expect(text).toContain("scheduler and selected compute");
        expect(text).toContain("Do not ask the user to re-enter");
        expect(text).toContain("configured but not runtime-verified");
        expect(text).toContain("OpenFOAM distribution/release");
        const reference = await readFile(
            join(skill, "references/authoring.md"),
            "utf8",
        );
        expect(reference).toContain(
            "cluster-init project version is not the Slurm software version",
        );
    });

    test("reports usage without a project argument", () => {
        const result = validate();
        expect(result.status).toBe(2);
        expect(result.stderr).toContain("Usage:");
    });

    test("reports missing files", () => {
        const result = validate(project);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
            "ERROR: Missing or unreadable file: project.ini",
        );
    });

    test("rejects the unfinished scaffold", async () => {
        await fixture();
        const result = validate(project);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("Unresolved TODO marker");
        expect(result.stdout).toContain("NOT CHECKED:");
    });

    test("checks structure and syntax without executing project scripts", async () => {
        await fixture();
        await resolvePlaceholders();
        await writeFile(
            join(project, "specs/install/cluster-init/scripts/10-install.sh"),
            "#!/usr/bin/env bash\nexit 99\n",
        );
        const result = validate(project);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toContain("Local skeleton checks passed");
        expect(result.stdout).toContain("NOT CHECKED:");
    });

    test("fails rather than skipping syntax checks when Bash is missing", async () => {
        await fixture();
        await resolvePlaceholders();
        const result = spawnSync(process.execPath, [validator, project], {
            encoding: "utf8",
            timeout: 10_000,
            env: { PATH: project },
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("Bash syntax checker unavailable");
    });

    test("rejects malformed shell without running it", async () => {
        await fixture();
        await resolvePlaceholders();
        await writeFile(join(project, "examples/openfoam.sbatch"), "if then\n");
        const result = validate(project);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
            "Shell syntax check failed: examples/openfoam.sbatch",
        );
    });
});
