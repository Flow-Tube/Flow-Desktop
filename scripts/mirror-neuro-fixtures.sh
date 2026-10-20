#!/usr/bin/env bash
# Copies the FlowNeuro tables and golden files Flow for Android writes into this repo, so both apps
# read titles and learn from the same source. Regenerate them on the Android side first:
#   NEURO_WRITE_TABLES=1 NEURO_WRITE_GOLDEN=1 NEURO_WRITE_UNSTEMMED=1 \
#     ./gradlew :app:testGithubDebugUnitTest --tests 'io.github.aedev.flow.data.recommendation.*'
# Usage: scripts/mirror-neuro-fixtures.sh /path/to/Flow
set -euo pipefail

android="${1:?usage: scripts/mirror-neuro-fixtures.sh /path/to/Flow}"
here="$(cd "$(dirname "$0")/.." && pwd)"
resources="$android/app/src/main/resources/neuro"
fixtures="$android/app/src/test/resources/neuro"

for dir in freq keys stop topical; do
  mkdir -p "$here/src-tauri/resources/neuro/$dir"
  cp "$resources/$dir/"* "$here/src-tauri/resources/neuro/$dir/"
done

cp "$fixtures/key_spec_tables.json" "$here/src-tauri/resources/neuro/key_spec_tables.json"
for file in key_spec_tables.json key_spec_golden.json stem_golden.tsv language_titles.tsv \
  language_detected.tsv learn_golden.json; do
  cp "$fixtures/$file" "$here/src-tauri/tests/fixtures/neuro/$file"
done

echo "Mirrored FlowNeuro tables and golden files from $android"
