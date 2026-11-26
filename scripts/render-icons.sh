#!/usr/bin/env bash
# Builds the app icons drawn from the SVGs in src-tauri/icons/source.
#
# macOS 26 and later put an icon whose art doesn't fill the rounded square on a gray plate, so the
# macOS icon (icon.icns) is drawn on its own plate. Windows and Linux show icons as drawn and keep
# the transparent mark. The stable PNG and ICO files predate these sources and are left alone;
# the nightly ones in icons/nightly are all drawn here, as Flow for Android's nightly icon: the
# mark with a moon badge, on its indigo plate for macOS.
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

mkdir -p "$icons/nightly"
render "$icons/source/flow-nightly-macos.svg" "$work/nightly-macos"
cp "$work/nightly-macos/icon.icns" "$icons/nightly/icon.icns"
render "$icons/source/flow-nightly-mark.svg" "$work/nightly"
for file in 32x32.png 128x128.png 128x128@2x.png icon.png icon.ico; do
  cp "$work/nightly/$file" "$icons/nightly/$file"
done
sips -z 256 256 "$work/nightly/icon.png" --out "$icons/nightly/256x256.png" >/dev/null

echo "Icons written to $icons"
