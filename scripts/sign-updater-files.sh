#!/usr/bin/env bash
# Signs the files a plan lists ("<version>\t<file>" per line), binding each
# signature to the version its updater manifest announces. Uses only the
# Tauri CLI installed from .github/signing.
# Usage: sign-updater-files.sh <folder> <plan>
# Env: TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH, and
#      TAURI_SIGNING_PRIVATE_KEY_PASSWORD
set -euo pipefail

folder="$1"
plan="$2"
tauri=".github/signing/node_modules/.bin/tauri"

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  echo "::error::No updater signing key in this job's environment." >&2
  exit 1
fi

count=0
while IFS=$'\t' read -r version file; do
  # The CLI also prints the signature; the .sig file is what's kept.
  "$tauri" signer sign --app-version "$version" "$folder/$file" >/dev/null
  echo "signed $file for $version"
  count=$((count + 1))
done <"$plan"

if [[ "$count" -eq 0 ]]; then
  echo "the signing plan lists no files" >&2
  exit 1
fi
