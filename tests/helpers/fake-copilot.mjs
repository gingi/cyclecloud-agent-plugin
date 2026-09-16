import {
    appendFileSync,
    cpSync,
    rmSync,
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
    case "plugin update cyclecloud-mcp@cyclecloud-mcp":
    case "plugin install cyclecloud-mcp@cyclecloud-mcp": {
        const local = state.marketplaces.find(
            (item) => item.name === "cyclecloud-mcp",
        )?.source;
        if (local?.startsWith("Local: ")) {
            const source = local.slice("Local: ".length);
            const root = join(
                process.env.HOME,
                ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
            );
            if (!state.liveLocal) {
                rmSync(root, { recursive: true, force: true });
                cpSync(source, root, { recursive: true });
            }
            const enabled =
                state.plugins.find((item) => item.name === "cyclecloud-mcp")
                    ?.enabled ?? true;
            state.plugins = state.plugins.filter(
                (item) => item.name !== "cyclecloud-mcp",
            );
            state.plugins.push({
                name: "cyclecloud-mcp",
                version: JSON.parse(
                    readFileSync(join(source, "plugin.json"), "utf8"),
                ).version,
                enabled,
                ...(state.flatPluginJson
                    ? {
                          marketplace: "cyclecloud-mcp",
                          source: state.liveLocal ? "live" : "installed",
                          ...(state.liveLocal ? { installedFrom: source } : {}),
                      }
                    : {
                          kind: "plugin",
                          scope: "user",
                          source: "marketplace:cyclecloud-mcp",
                      }),
            });
            writeFileSync(statePath, JSON.stringify(state));
            break;
        }
        throw new Error(
            "Tests require a real packaged marketplace; source-only installs have no runtime bundle.",
        );
    }
    case "plugin uninstall cyclecloud-mcp@cyclecloud-mcp":
        state.plugins = state.plugins.filter(
            (item) => item.name !== "cyclecloud-mcp",
        );
        rmSync(
            join(
                process.env.HOME,
                ".copilot/installed-plugins/cyclecloud-mcp/cyclecloud-mcp",
            ),
            { recursive: true, force: true },
        );
        writeFileSync(statePath, JSON.stringify(state));
        break;
    case "plugin marketplace remove cyclecloud-mcp":
        state.marketplaces = state.marketplaces.filter(
            (item) => item.name !== "cyclecloud-mcp",
        );
        writeFileSync(statePath, JSON.stringify(state));
        break;
    case "plugin disable cyclecloud-mcp@cyclecloud-mcp":
        state.plugins.find((item) => item.name === "cyclecloud-mcp").enabled =
            false;
        writeFileSync(statePath, JSON.stringify(state));
        break;
    default:
        if (
            args.slice(0, 3).join(" ") === "plugin marketplace add" &&
            args[3].startsWith("/")
        ) {
            state.marketplaces.push({
                name: "cyclecloud-mcp",
                source: `Local: ${args[3]}`,
                isDefault: false,
            });
            writeFileSync(statePath, JSON.stringify(state));
            break;
        }
        throw new Error(`Unexpected command: ${command}`);
}
