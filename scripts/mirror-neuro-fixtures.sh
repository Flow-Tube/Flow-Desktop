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

for dir in fold freq keys runbreak stop topical; do
  mkdir -p "$here/src-tauri/resources/neuro/$dir"
  cp "$resources/$dir/"* "$here/src-tauri/resources/neuro/$dir/"
done

# NeuroTokenizer keeps the English words that make a channel name topical in code, not a file.
tokenizer="$android/app/src/main/java/io/github/aedev/flow/data/recommendation/NeuroTokenizer.kt"
{
  echo "# English words that make a channel name topical: NeuroTokenizer.alwaysTopical, extracted by"
  echo "# scripts/mirror-neuro-fixtures.sh. Do not edit by hand."
  awk '/private val alwaysTopical =/ { inside = 1; next }
       inside && /^[[:space:]]*\)/ { exit }
       inside { while (match($0, /"[^"]*"/)) { print substr($0, RSTART + 1, RLENGTH - 2); $0 = substr($0, RSTART + RLENGTH) } }' "$tokenizer"
} > "$here/src-tauri/resources/neuro/topical/always.txt"

cp "$fixtures/key_spec_tables.json" "$here/src-tauri/resources/neuro/key_spec_tables.json"
cp "$fixtures/feature_tables.json" "$here/src-tauri/resources/neuro/feature_tables.json"
for file in key_spec_tables.json key_spec_golden.json stem_golden.tsv language_titles.tsv \
  language_detected.tsv learn_golden.json rank_golden.json features_golden.json; do
  cp "$fixtures/$file" "$here/src-tauri/tests/fixtures/neuro/$file"
done

echo "Mirrored FlowNeuro tables and golden files from $android"
