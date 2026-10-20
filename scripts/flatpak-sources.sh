#!/usr/bin/env bash
# Regenerates packaging/flatpak/generated-sources/: the Cargo crates, the pnpm
# store and the pnpm release that the Flatpak manifest builds from offline.
# Run it again whenever Cargo.lock, pnpm-lock.yaml or packageManager changes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$repo_root/packaging/flatpak/generated-sources"
# Pinned so the generated files only change when our own lockfiles do.
tools_rev="74697c75b630d7330e77250fc13cb5ea688d9479"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

python3 -m venv "$work_dir/venv"
"$work_dir/venv/bin/pip" install --quiet \
  "aiohttp>=3.9.5,<4" "PyYAML>=6.0.2,<7" "tomlkit>=0.13.3,<1" \
  "flatpak_node_generator @ git+https://github.com/flatpak/flatpak-builder-tools@${tools_rev}#subdirectory=node"
curl -fsSL -o "$work_dir/flatpak-cargo-generator.py" \
  "https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/${tools_rev}/cargo/flatpak-cargo-generator.py"

rm -rf "$out_dir"
mkdir -p "$out_dir"

"$work_dir/venv/bin/python" "$work_dir/flatpak-cargo-generator.py" \
  -o "$out_dir/cargo-sources.json" "$repo_root/src-tauri/Cargo.lock"

# pnpm 11 still writes lockfile v9, but its store layout is v11.
"$work_dir/venv/bin/flatpak-node-generator" pnpm \
  --pnpm-store-version v11 \
  --no-requests-cache \
  -o "$out_dir/node-sources.json" \
  "$repo_root/pnpm-lock.yaml"

# pnpm is not in its own lockfile, so fetch the exact release package.json pins.
pnpm_spec="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["packageManager"])' "$repo_root/package.json")"
pnpm_version="${pnpm_spec#pnpm@}"
pnpm_version="${pnpm_version%%+*}"
curl -fsSL "https://registry.npmjs.org/pnpm/${pnpm_version}" > "$work_dir/pnpm.json"
"$work_dir/venv/bin/python" - "$work_dir/pnpm.json" "$out_dir/pnpm-release.json" <<'PY'
import base64
import json
import sys

dist = json.load(open(sys.argv[1], encoding="utf-8"))["dist"]
algorithm, digest = dist["integrity"].split("-", 1)
if algorithm != "sha512":
    sys.exit(f"unexpected pnpm integrity algorithm: {algorithm}")
source = [
    {
        "type": "archive",
        "url": dist["tarball"],
        "sha512": base64.b64decode(digest).hex(),
        "dest": "flatpak-pnpm",
    }
]
with open(sys.argv[2], "w", encoding="utf-8") as out:
    json.dump(source, out, indent=2)
    out.write("\n")
PY

echo "Wrote Flatpak sources to $out_dir"
