#!/bin/sh
# Self-contained: also works when downloaded outside the repository or piped to sh.
set -eu

main() {
    local_source=''
    case "${1:-}" in
        '') [ "$#" -eq 0 ] || return 1 ;;
        --help|-h)
            printf '%s\n' 'Usage: sh install.sh [--local [package-directory]]' \
                'Installs the Copilot plugin and prepares private configuration.' \
                '--local copies a complete package into private persistent storage; reruns update it.' \
                'Without --local, installs from GitHub and preserves existing versions.' \
                'Requires Node and Copilot CLI 1.0.81 or later; never overwrites credentials.'
            return ;;
        --local)
            [ "$#" -le 2 ] || { printf '%s\n' 'Usage: sh install.sh [--local [package-directory]]' >&2; return 1; }
            local_source=${2:-$(dirname "$0")}
            ;;
        *) printf '%s\n' 'Usage: sh install.sh [--local [package-directory]]' >&2; return 1 ;;
    esac

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
    node - "$node_version" "$local_source" <<'NODE'
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

function copilot(args, capture = false) {
    const result = spawnSync('copilot', args, {
        // Never let a subprocess consume a piped installer or prompt for credentials.
        stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        fail(`copilot ${args.join(' ')} failed. Check CLI plugin support, authentication, and source access, then rerun the same installer command. Completed steps were kept; credentials were not changed.`);
    }
    return capture ? result.stdout : undefined;
}

function installedPlugins() {
    const output = copilot(['plugins', 'list', '--json'], true);
    let data;
    try {
        data = JSON.parse(output);
    } catch {
        fail('Invalid Copilot JSON output. GitHub Copilot CLI 1.0.81 or later is required.');
    }
    if (Array.isArray(data) && data.every(item => item && typeof item.name === 'string')) return data;
    if (!data || !Array.isArray(data.plugins) ||
        !data.plugins.every(item => item && typeof item.name === 'string' && typeof item.kind === 'string') ||
        !Array.isArray(data.errors)) {
        fail('Unexpected Copilot JSON output. GitHub Copilot CLI 1.0.81 or later is required.');
    }
    if (data.errors.length) {
        fail('Copilot reported plugin inventory errors. Inspect copilot plugins list --json and resolve them before rerunning; no automatic rollback or update was attempted.');
    }
    // Older CLIs mix plugins, MCP servers, and skills in a single inventory.
    return data.plugins.filter(item => item.kind === 'plugin').map(item => ({
        name: item.name,
        marketplace: typeof item.source === 'string' && item.source.startsWith('marketplace:')
            ? item.source.slice('marketplace:'.length) : undefined,
        source: item.scope === 'user' ? 'installed' : undefined,
        enabled: item.enabled,
    }));
}

function marketplaces() {
    const output = copilot(['plugin', 'marketplace', 'list'], true)
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    return output.split(/\r?\n/).flatMap(line => {
        const match = /^\s*(?:\S+\s+)?([A-Za-z0-9][A-Za-z0-9._-]*)\s+\((.+)\)\s*$/.exec(line);
        return match ? [{ name: match[1], source: match[2] }] : [];
    });
}

function installedPlugin(plugins, localRoot) {
    const matches = plugins.filter(plugin => plugin.name === name);
    if (matches.length > 1 || matches.some(plugin =>
        plugin.marketplace !== name ||
        !(plugin.source === 'installed' || (localRoot && plugin.source === 'live' && plugin.installedFrom === localRoot)) ||
        typeof plugin.enabled !== 'boolean'
    )) {
        fail('A same-name plugin has a conflicting source or unsupported metadata. Resolve it explicitly; the installer will not replace it.');
    }
    return matches[0];
}

function registeredMarketplace(marketplaces, localRoot) {
    const matches = marketplaces.filter(marketplace => marketplace.name === name);
    if (matches.length > 1 || matches.some(marketplace =>
        marketplace.source !== `GitHub: ${source}` &&
        (!localRoot || marketplace.source !== `Local: ${localRoot}`)
    )) {
        fail('The cyclecloud-mcp marketplace name has a different source. Inspect it with copilot plugin marketplace list; resolve the conflict explicitly. Use --local to maintain a managed local installation.');
    }
    return matches[0];
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

const packageFiles = ['plugin.json', 'bin/cyclecloud-mcp.mjs',
    'cyclecloud.example.json', 'LICENSE', 'install.sh', '.github/plugin/marketplace.json'];

function validateTemplate(contents) {
    let document;
    try { document = JSON.parse(contents); } catch {}
    if (!document || document.password !== '' || document.enableMutations !== false ||
        document.verifyTls !== true || document.allowInsecureHttp !== false) {
        fail('Installed configuration template does not contain the expected empty-password, read-only, verified-TLS defaults. No configuration was created.');
    }
}

function readPackage(directory) {
    const payload = new Map();
    for (const file of packageFiles) {
        const target = path.join(directory, file);
        // Do not follow package symlinks, including intermediate directories.
        let current = directory;
        for (const component of file.split('/')) {
            current = path.join(current, component);
            const info = stat(current);
            if (!info || info.isSymbolicLink() || (current === target ? !info.isFile() : !info.isDirectory())) {
                fail(`Missing or unsafe local package file: ${target}`);
            }
        }
        payload.set(file, fs.readFileSync(target));
    }
    const plugin = JSON.parse(payload.get('plugin.json'));
    const catalog = JSON.parse(payload.get('.github/plugin/marketplace.json'));
    const server = plugin.mcpServers?.cyclecloud;
    if (plugin.name !== name || plugin.$schema !== undefined || typeof plugin.version !== 'string' ||
        Object.keys(plugin.mcpServers ?? {}).length !== 1 || server?.command !== 'node' ||
        JSON.stringify(server.args) !== JSON.stringify(['${PLUGIN_ROOT}/bin/cyclecloud-mcp.mjs']) ||
        server.env !== undefined || server.cwd !== undefined ||
        catalog.name !== name || catalog.plugins?.length !== 1 ||
        catalog.plugins[0].name !== name || catalog.plugins[0].source !== './' ||
        payload.get('bin/cyclecloud-mcp.mjs').length === 0) {
        fail('Invalid local package: expected the cyclecloud-mcp Copilot manifests and bundled server.');
    }
    validateTemplate(payload.get('cyclecloud.example.json'));
    return payload;
}

function checkTree(directory) {
    checkDirectory(directory, false);
    if (!stat(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) checkTree(target);
        else {
            const info = stat(target);
            if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o022)) {
                fail(`Unsafe managed package file: ${target}`);
            }
        }
    }
}

function matchesPackage(directory, payload) {
    if (!stat(directory)) return false;
    for (const [file, contents] of payload) {
        const target = path.join(directory, file);
        if (!stat(target)?.isFile() || !fs.readFileSync(target).equals(contents)) return false;
    }
    // Extra files can be old manifests, hooks, or other active plugin assets.
    const actualFiles = [];
    function visit(relative) {
        for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
            const file = path.join(relative, entry.name);
            if (entry.isDirectory()) visit(file);
            else actualFiles.push(file);
        }
    }
    visit('');
    return actualFiles.length === payload.size && actualFiles.every(file => payload.has(file));
}

function replacePackage(directory, payload) {
    if (matchesPackage(directory, payload)) return;
    const staged = fs.mkdtempSync(path.join(path.dirname(directory), '.package-'));
    const previous = `${staged}.previous`;
    let replaced = false;
    try {
        for (const [file, contents] of payload) {
            const target = path.join(staged, file);
            fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
            fs.writeFileSync(target, contents, { flag: 'wx', mode: 0o600 });
        }
        if (stat(directory)) fs.renameSync(directory, previous);
        try { fs.renameSync(staged, directory); replaced = true; }
        catch (error) {
            if (stat(previous)) fs.renameSync(previous, directory);
            throw error;
        }
    } finally {
        fs.rmSync(staged, { recursive: true, force: true });
        if (replaced) fs.rmSync(previous, { recursive: true, force: true });
    }
}

try {
    const home = process.env.HOME;
    if (!home || !path.isAbsolute(home) || !fs.statSync(home).isDirectory()) {
        fail('HOME must identify an existing absolute home directory.');
    }
    if (process.env.COPILOT_HOME && path.resolve(process.env.COPILOT_HOME) !== path.join(home, '.copilot')) {
        fail('Custom COPILOT_HOME is not supported by this installer; use the default HOME-based layout.');
    }
    const pluginRoot = path.join(home, '.copilot/installed-plugins', name, name);
    const installedDirectories = [path.join(home, '.copilot'), path.join(home, '.copilot/installed-plugins'), path.dirname(pluginRoot)];
    const local = process.argv[3] !== '';
    const managedRoot = path.join(home, '.local/share', name);
    const localRoot = local ? path.join(managedRoot, 'marketplace') : undefined;
    const localDirectories = ['.local', '.local/share', `.local/share/${name}`].map(part => path.join(home, part));
    const receipt = path.join(managedRoot, 'installation.json');
    let localState = { version: 1, pendingDisabled: false };
    let payload;
    if (local) {
        payload = readPackage(fs.realpathSync(process.argv[3]));
        for (const directory of [...localDirectories, ...installedDirectories]) checkDirectory(directory, false);
        checkTree(localRoot);
        checkTree(pluginRoot);
        if (hasConfiguration(receipt)) {
            localState = JSON.parse(fs.readFileSync(receipt, 'utf8'));
            if (localState.version !== 1 || typeof localState.pendingDisabled !== 'boolean') fail('Invalid managed installation receipt.');
        } else if (stat(localRoot)) {
            fail(`Refusing to replace an unmanaged directory: ${localRoot}`);
        }
    }
    function saveLocalState() {
        const temporary = path.join(managedRoot, `.receipt-${process.pid}`);
        fs.writeFileSync(temporary, JSON.stringify(localState), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, receipt);
    }
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

    let installed = installedPlugin(installedPlugins(), localRoot);
    let registered = registeredMarketplace(marketplaces(), localRoot);
    if (local) {
        for (const directory of localDirectories) checkDirectory(directory, true);
        // Persist a disabled choice before any destructive CLI source-switch step.
        localState.pendingDisabled ||= installed?.enabled === false;
        saveLocalState();
        replacePackage(localRoot, payload);
        if (registered?.source === `GitHub: ${source}`) {
            console.log('Switching this plugin from GitHub to the managed local package.');
            if (installed) {
                copilot(['plugin', 'uninstall', id]);
                installed = undefined;
            }
            copilot(['plugin', 'marketplace', 'remove', name]);
            registered = undefined;
        }
    }
    if (!registered) {
        copilot(['plugin', 'marketplace', 'add', localRoot ?? source]);
        registered = registeredMarketplace(marketplaces(), localRoot);
        if (registered?.source !== (local ? `Local: ${localRoot}` : `GitHub: ${source}`)) {
            fail('Copilot did not register the expected marketplace. Inspect its output before retrying.');
        }
    }
    if (!installed) {
        copilot(['plugin', 'install', id]);
        installed = installedPlugin(installedPlugins(), localRoot);
        if (!installed) fail('Copilot did not report the plugin as installed.');
    } else if (local && installed.source === 'installed') {
        checkTree(pluginRoot);
        if (!matchesPackage(pluginRoot, payload)) {
            copilot(['plugin', 'update', id]);
            installed = installedPlugin(installedPlugins(), localRoot);
            if (!installed) fail('Copilot did not report the updated plugin.');
        }
    } else {
        console.log('Keeping the existing plugin registration; no enablement change.');
    }
    if (local) {
        if (localState.pendingDisabled && installed.enabled) {
            copilot(['plugin', 'disable', id]);
            installed = installedPlugin(installedPlugins(), localRoot);
            if (!installed || installed.enabled) fail('Copilot did not preserve the disabled plugin state. Rerun to retry.');
        }
        // VS Code scans installed-plugins; it does not discover CLI live marketplaces.
        if (installed.source === 'live') {
            for (const directory of installedDirectories) checkDirectory(directory, true);
            replacePackage(pluginRoot, payload);
        }
        checkTree(pluginRoot);
        if (!matchesPackage(pluginRoot, payload)) fail('Installed package does not match the local payload. Rerun to repair it.');
        localState.pendingDisabled = false;
        saveLocalState();
        console.log(`Local plugin is ready at ${pluginRoot}; the source directory is no longer needed.`);
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
            fail(`Installed configuration template is missing: ${template}. Reinstall a complete plugin package, then rerun this installer.`);
        }
        const contents = fs.readFileSync(template, 'utf8');
        validateTemplate(contents);
        for (const directory of dataDirectories) checkDirectory(directory, true);
        fs.chmodSync(dataRoot, 0o700);
        fs.writeFileSync(config, contents, { flag: 'wx', mode: 0o600 });
        console.log(`Created private configuration: ${config}`);
    }
    if (!installed.enabled) {
        console.log('The plugin is disabled in Copilot CLI. That choice was preserved; enable it explicitly there if you want to use it.');
    }
    console.log(`\nNext steps:\n`);
    console.log(`1. Edit ${config}; set url, username, and password.`);
    console.log(`2. Run "Developer: Reload Window".`);
    console.log(`3. Ensure "Chat: Plugins Enabled" is enabled in VS Code.`);
    console.log(`4. Ensure cyclecloud-mcp is enabled under "Agent Plugins - Installed".`);
    console.log(`5. Start a fresh connected agent session and ask:\n`);
    console.log(`   Use the cyclecloud MCP to list my clusters`);
} catch (error) {
    console.error(`cyclecloud-mcp installer: ${error.message}`);
    process.exitCode = 1;
}
NODE
}

# Keep execution last so an incomplete download does not run a partial function body.
main "$@"
