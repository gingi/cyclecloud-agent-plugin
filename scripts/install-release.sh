#!/bin/sh
# Release packaging embeds a version-pinned download location into this bootstrap.
set -eu

main() {
    version='@RELEASE_VERSION@'
    release_base='@RELEASE_BASE_URL@'
    for arg in "$@"; do
        case "$arg" in
            --help|-h)
                printf '%s\n' 'Usage: sh install.sh [--skip-config]' \
                    'Downloads and verifies this release, then runs its packaged installer.'
                return ;;
            --skip-config) ;;
            *) printf '%s\n' "Unknown installer argument: $arg" >&2; return 1 ;;
        esac
    done
    case "$version" in *@*) printf '%s\n' 'Use install.sh from a published GitHub Release, not the source bootstrap template.' >&2; return 1 ;; esac
    for command in curl tar node copilot; do
        command -v "$command" >/dev/null 2>&1 || {
            printf '%s\n' "Install $command before running the release installer." >&2
            return 1
        }
    done
    umask 077
    work=$(mktemp -d "${TMPDIR:-/tmp}/cyclecloud-release.XXXXXXXX")
    trap 'rm -rf "$work"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    archive="cyclecloud-mcp-${version}.tar.gz"
    download "$release_base/SHA256SUMS" "$work/SHA256SUMS"
    download "$release_base/$archive" "$work/$archive"
    node - "$work" "$archive" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const [directory, name] = process.argv.slice(2);
const lines = fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8').split('\n');
const matches = lines.map(line => /^([a-f0-9]{64}) [ *](.+)$/.exec(line)).filter(match => match && match[2] === name);
const digest = createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
if (matches.length !== 1 || matches[0][1] !== digest) {
    console.error(`Release checksum verification failed for ${name}`);
    process.exit(1);
}
NODE
    tar -xzf "$work/$archive" --no-same-owner -C "$work"
    node - "$work/cyclecloud-mcp" "$version" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [directory, version] = process.argv.slice(2);
const plugin = JSON.parse(fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8'));
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'SOURCE_COMMIT.json'), 'utf8'));
if (plugin.version !== version || metadata.version !== version || metadata.sourceRef !== `v${version}`) {
    console.error('Downloaded release identity does not match the requested version');
    process.exit(1);
}
NODE
    sh "$work/cyclecloud-mcp/install.sh" "$@"
}

download() {
    attempt=1
    until curl -fsSL --connect-timeout 10 --max-time 60 --output "$2" "$1"; do
        if [ "$attempt" -ge 3 ]; then
            printf '%s\n' "Release download failed: $1" >&2
            return 1
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
}

main "$@"
