import {
    appendFileSync,
    copyFileSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const command = args.join(" ");
const statePath = process.env.FAKE_COPILOT_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
appendFileSync(process.env.FAKE_COPILOT_CALLS, `${JSON.stringify(args)}\n`);

if (command === state.failCommand) {
    process.stderr.write("Simulated Copilot failure\n");
    process.exit(1);
}

switch (command) {
    case "plugin list --json":
        process.stdout.write(JSON.stringify(state.plugins));
        break;
    case "plugin marketplace list --json":
        process.stdout.write(JSON.stringify(state.marketplaces));
        break;
    case "plugin marketplace add gingi/cyclecloud-mcp":
        state.marketplaces.push({
            name: "cyclecloud-mcp",
            source: "GitHub: gingi/cyclecloud-mcp",
            isDefault: false,
        });
        writeFileSync(statePath, JSON.stringify(state));
        break;
    case "plugin install cyclecloud-mcp@cyclecloud-mcp": {
        const root = join(
            process.env.HOME,
            ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
        );
        mkdirSync(join(root, "bin"), { recursive: true });
        writeFileSync(
            join(root, "bin/cyclecloud-mcp.mjs"),
            "// Test fixture; never executed.\n",
        );
        if (!state.omitTemplate) {
            copyFileSync(
                process.env.FAKE_COPILOT_TEMPLATE,
                join(root, "cyclecloud.example.json"),
            );
        }
        state.plugins.push({
            name: "cyclecloud-mcp",
            marketplace: "cyclecloud-mcp",
            version: "0.1.0",
            enabled: true,
            source: "installed",
        });
        writeFileSync(statePath, JSON.stringify(state));
        break;
    }
    default:
        throw new Error(`Unexpected command: ${command}`);
}
