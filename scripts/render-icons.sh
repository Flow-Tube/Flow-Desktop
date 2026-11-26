#!/usr/bin/env bash
# Builds the app icons drawn from the SVGs in src-tauri/icons/source.
#
# macOS 26 and later put an icon whose art doesn't fill the rounded square on a gray plate, so the
# macOS icon (icon.icns) is drawn on its own plate. Windows and Linux show icons as drawn and keep
# the transparent mark, whose PNG and ICO files this script leaves alone.
#
# Usage: bash scripts/render-icons.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
icons="$root/src-tauri/icons"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

render() {
  local log
  if ! log="$(cd "$root" && pnpm exec tauri icon "$1" --output "$2" 2>&1)"; then
    echo "$log" >&2
    exit 1
  fi
}

render "$icons/source/flow-macos.svg" "$work/macos"
cp "$work/macos/icon.icns" "$icons/icon.icns"

echo "Icons written to $icons"
