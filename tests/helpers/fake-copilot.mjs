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
    case "plugins list --json":
        process.stdout.write(
            JSON.stringify(
                state.pluginListOutput ??
                    (state.flatPluginJson
                        ? state.plugins
                        : { plugins: state.plugins, errors: [] }),
            ),
        );
        break;
    case "plugin marketplace list":
        process.stdout.write(
            [
                "Included with GitHub Copilot:",
                "  ◆ copilot-plugins (GitHub: github/copilot-plugins)",
                "",
                "Registered marketplaces:",
                ...state.marketplaces.map(
                    ({ name, source }) => `  • ${name} (${source})`,
                ),
                "",
            ].join("\n"),
        );
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
            version: "0.1.0",
            enabled: true,
            ...(state.flatPluginJson
                ? { marketplace: "cyclecloud-mcp", source: "installed" }
                : {
                      kind: "plugin",
                      scope: "user",
                      source: "marketplace:cyclecloud-mcp",
                  }),
        });
        writeFileSync(statePath, JSON.stringify(state));
        break;
    }
    default:
        throw new Error(`Unexpected command: ${command}`);
}
