#!/bin/sh
# Self-contained: also works when downloaded outside the repository or piped to sh.
set -eu

main() {
    if [ "$#" -ne 0 ]; then
        if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
            printf '%s\n' 'Usage: sh install.sh' \
                'Installs the Copilot plugin and prepares private configuration.' \
                'Requires Node and authenticated Copilot CLI; never upgrades or overwrites credentials.'
            return
        fi
        printf '%s\n' 'Usage: sh install.sh (no installation options)' >&2
        return 1
    fi

    case "$(uname -s)" in
        Linux|Darwin) ;;
        *) printf '%s\n' 'Use Linux, macOS, or WSL. Native Windows is not supported.' >&2; return 1 ;;
    esac
    command -v node >/dev/null 2>&1 || {
        printf '%s\n' 'Install a supported Node.js version first; node is not on PATH.' >&2
        return 1
    }
    command -v copilot >/dev/null 2>&1 || {
        printf '%s\n' 'Install and authenticate GitHub Copilot CLI first; copilot is not on PATH.' >&2
        return 1
    }
    node_version=$(node --version)

    # Node is already required by the server. Use it for JSON and exclusive file creation.
    node - "$node_version" <<'NODE'
const version = /^v(\d+)\.(\d+)\.(\d+)$/.exec(process.argv[2]);
if (!version || !(
    (Number(version[1]) === 20 && Number(version[2]) >= 19) ||
    (Number(version[1]) === 22 && Number(version[2]) >= 12) ||
    Number(version[1]) >= 24
)) {
    console.error('Node.js ^20.19.0, ^22.12.0, or >=24.0.0 is required (no prereleases).');
    process.exit(1);
}
if (process.platform !== 'linux' && process.platform !== 'darwin') {
    console.error('Use a Linux/macOS Node executable; inside WSL do not use node.exe.');
    process.exit(1);
}

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const name = 'cyclecloud-mcp';
const source = 'gingi/cyclecloud-mcp';
const id = `${name}@${name}`;
process.umask(0o077);

function fail(message) {
    throw new Error(message);
}

function copilot(args, json = false) {
    const result = spawnSync('copilot', args, {
        // Never let a subprocess consume a piped installer or prompt for credentials.
        stdio: ['ignore', json ? 'pipe' : 'inherit', 'inherit'],
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        fail(`copilot ${args.join(' ')} failed. Check CLI plugin support, authentication, and repository access, then rerun. No automatic rollback or update was attempted.`);
    }
    if (!json) return;
    try {
        const data = JSON.parse(result.stdout);
        if (Array.isArray(data) && data.every(item => item && typeof item.name === 'string')) return data;
    } catch {}
    fail('Unexpected Copilot JSON output. Use a CLI supporting plugin list --json and plugin marketplace list --json.');
}

function installedPlugin(plugins) {
    const matches = plugins.filter(plugin => plugin.name === name);
    if (matches.length > 1 || matches.some(plugin =>
        plugin.marketplace !== name || plugin.source !== 'installed' ||
        typeof plugin.enabled !== 'boolean'
    )) {
        fail('A same-name plugin has a conflicting source or unsupported metadata. Resolve it explicitly; the installer will not replace it.');
    }
    return matches[0];
}

function hasMarketplace(marketplaces) {
    const matches = marketplaces.filter(marketplace => marketplace.name === name);
    if (matches.length > 1 || matches.some(marketplace => marketplace.source !== `GitHub: ${source}`)) {
        fail('The cyclecloud-mcp marketplace name has a different source. Inspect it with copilot plugin marketplace list; resolve the conflict explicitly.');
    }
    return matches.length === 1;
}

function stat(file) {
    return fs.lstatSync(file, { throwIfNoEntry: false });
}

function checkDirectory(directory, create) {
    if (!stat(directory) && create) fs.mkdirSync(directory, { mode: 0o700 });
    const info = stat(directory);
    if (info && (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o022))) {
        fail(`Expected a user-owned, non-symlink directory that is not group/world writable: ${directory}`);
    }
}

function hasConfiguration(file) {
    const info = stat(file);
    if (!info) return false;
    if (!info.isFile() || info.uid !== process.getuid() || ![0o600, 0o400].includes(info.mode & 0o777)) {
        fail(`Existing configuration must be a user-owned regular file (not a symlink), mode 0600 or 0400: ${file}. Left unchanged.`);
    }
    return true; // Deliberately do not read credentials, validate them, or change their mode.
}

try {
    const home = process.env.HOME;
    if (!home || !path.isAbsolute(home) || !fs.statSync(home).isDirectory()) {
        fail('HOME must identify an existing absolute home directory.');
    }
    const pluginRoot = path.join(home, '.copilot/installed-plugins', name, name);
    const dataRoot = path.join(home, '.copilot/plugin-data', name, name);
    const config = path.join(dataRoot, 'cyclecloud.json');
    const dataDirectories = [
        path.join(home, '.copilot'),
        path.join(home, '.copilot/plugin-data'),
        path.join(home, '.copilot/plugin-data', name),
        dataRoot,
    ];
    // Check existing destination paths before asking the CLI to make any changes.
    for (const directory of dataDirectories) checkDirectory(directory, false);
    hasConfiguration(config);

    let installed = installedPlugin(copilot(['plugin', 'list', '--json'], true));
    const registered = hasMarketplace(copilot(['plugin', 'marketplace', 'list', '--json'], true));
    if (!registered) {
        copilot(['plugin', 'marketplace', 'add', source]);
        if (!hasMarketplace(copilot(['plugin', 'marketplace', 'list', '--json'], true))) {
            fail('Copilot did not register the expected marketplace. Inspect its output before retrying.');
        }
    }
    if (!installed) {
        copilot(['plugin', 'install', id]);
        installed = installedPlugin(copilot(['plugin', 'list', '--json'], true));
        if (!installed) fail('Copilot did not report the plugin as installed.');
    } else {
        console.log('Keeping the existing plugin installation; no update or enablement change.');
    }
    const bundle = path.join(pluginRoot, 'bin/cyclecloud-mcp.mjs');
    const bundleInfo = stat(bundle);
    if (!bundleInfo || !bundleInfo.isFile()) {
        fail(`Installed bundle not found at ${bundle}. This installer uses Copilot's default HOME-based locations; inspect the installation before explicitly repairing it.`);
    }

    if (hasConfiguration(config)) {
        console.log(`Keeping existing configuration without reading its contents: ${config}`);
    } else {
        const template = path.join(pluginRoot, 'cyclecloud.example.json');
        const templateInfo = stat(template);
        if (!templateInfo || !templateInfo.isFile()) {
            fail(`Installed configuration template is missing: ${template}. Explicitly update the marketplace and plugin to a revision containing it, then rerun; existing versions are not upgraded automatically.`);
        }
        const contents = fs.readFileSync(template, 'utf8');
        let document;
        try { document = JSON.parse(contents); } catch {}
        if (!document || document.password !== '' || document.enableMutations !== false ||
            document.verifyTls !== true || document.allowInsecureHttp !== false) {
            fail('Installed configuration template does not contain the expected empty-password, read-only, verified-TLS defaults. No configuration was created.');
        }
        for (const directory of dataDirectories) checkDirectory(directory, true);
        fs.chmodSync(dataRoot, 0o700);
        fs.writeFileSync(config, contents, { flag: 'wx', mode: 0o600 });
        console.log(`Created private configuration: ${config}`);
    }
    if (!installed.enabled) {
        console.log('The plugin is disabled in Copilot CLI. That choice was preserved; enable it explicitly there if you want to use it.');
    }
    console.log('\nNext steps (not performed by this installer):');
    console.log(`1. Edit ${config} outside Chat: set url, username, and password; keep enableMutations: false.`);
    console.log('2. In VS Code, enable Chat: Plugins Enabled and reload. Keep cyclecloud-mcp disabled only in the VS Code Agent Plugins view while issue #335006 remains; do not uninstall it.');
    console.log('3. Start a fresh Copilot session and ask:');
    console.log('\n     Use the cyclecloud MCP server to list my clusters.\n');
    console.log('Setup is prepared; credentials, connectivity, and an actual tool call have not been verified.');
} catch (error) {
    console.error(`cyclecloud-mcp installer: ${error.message}`);
    process.exitCode = 1;
}
NODE
}

# Keep execution last so an incomplete download does not run a partial function body.
main "$@"
