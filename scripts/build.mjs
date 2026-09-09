import { mkdir, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const output = new URL("../bin/cyclecloud-mcp.mjs", import.meta.url);

await mkdir(new URL("../bin/", import.meta.url), { recursive: true });
await build({
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    outfile: fileURLToPath(output),
    bundle: true,
    packages: "bundle",
    platform: "node",
    target: "node20.19",
    format: "esm",
    banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "warning",
});
await chmod(output, 0o644);
