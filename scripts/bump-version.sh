#!/usr/bin/env bash
# macOS/Linux port of bump-version.ps1: sets the app version in package.json,
# src-tauri/tauri.conf.json, src-tauri/Cargo.toml and the "flow" entry of
# src-tauri/Cargo.lock, which scripts/verify-release-version.mjs requires to match.
# Usage: scripts/bump-version.sh [VERSION] [--dry-run] [--yes]
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
new_version=""
dry_run=false
assume_yes=false

die() {
    echo "$*" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        -n | --dry-run) dry_run=true ;;
        -y | --yes) assume_yes=true ;;
        -h | --help)
            sed -n '2,5p' "$0"
            exit 0
            ;;
        -*) die "Unknown option: $1" ;;
        *) new_version="$1" ;;
    esac
    shift
done

# Each pattern captures (prefix)(version)(suffix). Perl rather than sed because
# the Cargo.lock pattern spans two lines and sed -i differs between macOS and Linux.
files=(package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock)
patterns=(
    '("version"\s*:\s*")([^"]+)(")'
    '("version"\s*:\s*")([^"]+)(")'
    '^(version = ")([^"]+)(")'
    '(name = "flow"\r?\nversion = ")([^"]+)(")'
)

read_version() {
    PATTERN="$2" perl -0ne 'if (/$ENV{PATTERN}/m) { print $2; exit }' "$repo_root/$1"
}

write_version() {
    PATTERN="$2" VERSION="$3" perl -0pi -e 's/$ENV{PATTERN}/$1$ENV{VERSION}$3/m' "$repo_root/$1"
}

echo "Flow Desktop - version bump"
echo

current_version=""
in_sync=true
for i in "${!files[@]}"; do
    file="${files[$i]}"
    [ -f "$repo_root/$file" ] || die "File not found: $file"
    version="$(read_version "$file" "${patterns[$i]}")"
    [ -n "$version" ] || die "Could not find a version in $file"
    printf '  %-28s %s\n' "$file" "$version"
    if [ -z "$current_version" ]; then
        current_version="$version"
    elif [ "$version" != "$current_version" ]; then
        in_sync=false
    fi
done

if [ "$in_sync" = false ]; then
    echo
    echo "WARNING: version files are out of sync. This bump sets them all to the new version."
fi

if [ -z "$new_version" ]; then
    echo
    read -r -p "Current version is v$current_version. Enter the new version: " new_version
fi

new_version="$(printf '%s' "$new_version" | tr -d '[:space:]')"
new_version="${new_version#[vV]}"
[ -n "$new_version" ] || die "No version entered - aborting."

semver='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?(\+[0-9A-Za-z][0-9A-Za-z.-]*)?$'
printf '%s' "$new_version" | grep -Eq "$semver" ||
    die "'$new_version' is not a valid semantic version (expected e.g. 0.1.1 or v0.1.1)."

if [ "$new_version" = "$current_version" ] && [ "$in_sync" = true ]; then
    echo "Version is already $new_version - nothing to do."
    exit 0
fi

echo
echo "About to bump: v$current_version -> v$new_version"

if [ "$dry_run" = true ]; then
    echo "Dry run - no files changed."
    exit 0
fi

if [ "$assume_yes" = false ]; then
    read -r -p "Proceed? (y/N) " confirm
    case "$confirm" in
        y | Y | yes | YES) ;;
        *) die "Aborted." ;;
    esac
fi

echo
for i in "${!files[@]}"; do
    file="${files[$i]}"
    if [ "$(read_version "$file" "${patterns[$i]}")" = "$new_version" ]; then
        echo "  skipped  $file (already $new_version)"
    else
        write_version "$file" "${patterns[$i]}" "$new_version"
        echo "  updated  $file"
    fi
done

echo
echo "Done. Version is now v$new_version."
echo
echo "Next steps:"
echo "  1. pnpm verify:version"
echo "  2. Review the diff, then commit: git commit -am \"chore(release): bump version to $new_version\""
echo "  3. git tag v$new_version && git push origin v$new_version"
