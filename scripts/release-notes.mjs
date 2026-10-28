// Turns changelog/<tag>.txt into the GitHub release body and the in-app
// update notes. Same parse as releasenote.sh in the Android repo.
// Usage: node scripts/release-notes.mjs <tag> [--app] [--changelog-dir DIR]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const SUPPORT_MESSAGE =
  "Enjoying Flow? Consider supporting its development on [Open Collective](https://opencollective.com/flow-tube) or [Patreon](https://patreon.com/A_EDev) to help keep the app free, open source, ad-free, and improving!";

const TITLE_LINES = new Set(["FLOW DESKTOP CHANGE LOG", "FLOW CHANGE LOG"]);
const META_LINE = /^(VERSION|DATE|STATUS):(.*)$/i;
const HEADING_LINE = /^[A-Z][A-Z &/,:-]+:?$/;
// Sentence-casing a heading would otherwise print "Macos" or "Youtube".
const PROPER_NOUNS = { macos: "macOS", linux: "Linux", android: "Android", youtube: "YouTube" };

export function parseChangelog(text) {
  const meta = {};
  const blocks = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (blocks.length > 0 && blocks.at(-1).kind !== "blank") blocks.push({ kind: "blank" });
      continue;
    }
    if (TITLE_LINES.has(line)) continue;

    const metaMatch = META_LINE.exec(line);
    if (metaMatch && metaMatch[2].trim()) {
      meta[metaMatch[1].toUpperCase()] = metaMatch[2].trim();
      continue;
    }

    if (HEADING_LINE.test(line)) {
      if (blocks.length > 0 && blocks.at(-1).kind !== "blank") blocks.push({ kind: "blank" });
      blocks.push({ kind: "heading", text: line.replace(/:+$/, "") });
      continue;
    }

    blocks.push({ kind: "text", text: raw.trimEnd() });
  }

  while (blocks.at(-1)?.kind === "blank") blocks.pop();
  return { meta, blocks };
}

function sentenceCase(heading) {
  const lower = heading.toLowerCase();
  const cased = lower.charAt(0).toUpperCase() + lower.slice(1);
  return cased.replace(/[A-Za-z]+/g, (word) => PROPER_NOUNS[word.toLowerCase()] ?? word);
}

export function renderGithubNotes({ meta, blocks }, tag) {
  const out = [`# Flow ${tag}`];
  const details = [];
  if (meta.DATE) details.push(`**Release date:** ${meta.DATE}`);
  if (meta.STATUS) details.push(`**Status:** ${sentenceCase(meta.STATUS)}`);
  if (details.length > 0) out.push("", ...details);
  out.push("", SUPPORT_MESSAGE);
  if (blocks.length > 0) out.push("");

  for (const block of blocks) {
    if (block.kind === "heading") {
      out.push(`## ${sentenceCase(block.text)}`, "");
    } else if (block.kind === "blank") {
      // A heading already left a blank line after itself.
      if (out.at(-1) !== "") out.push("");
    } else {
      out.push(block.text);
    }
  }
  return out.join("\n");
}

// The update dialog shows notes as plain text, so markdown would print raw.
// The dialog already names the version, so the title, date and status go too.
export function renderAppNotes({ blocks }) {
  return blocks
    .map((block) => (block.kind === "blank" ? "" : block.text))
    .join("\n");
}

export function releaseNotes(tag, { app = false, changelogDir = "changelog" } = {}) {
  if (!/^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }

  // Never fall back to another file: that would publish an older release's notes.
  const file = join(changelogDir, `${tag}.txt`);
  if (!existsSync(file)) throw new Error(`No changelog for ${tag} at ${file}`);

  const parsed = parseChangelog(readFileSync(file, "utf8"));
  const version = tag.slice(1);
  if (parsed.meta.VERSION && parsed.meta.VERSION.replace(/^v/i, "") !== version) {
    throw new Error(`${file} says VERSION: ${parsed.meta.VERSION}, expected ${version}`);
  }

  return app ? renderAppNotes(parsed) : renderGithubNotes(parsed, tag);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf("--changelog-dir");
  const changelogDir = dirIndex === -1 ? "changelog" : args[dirIndex + 1];
  const tag = args.find(
    (arg, index) => !arg.startsWith("--") && (dirIndex === -1 || index !== dirIndex + 1),
  );
  if (!tag || !changelogDir) {
    console.error("Usage: node scripts/release-notes.mjs <tag> [--app] [--changelog-dir DIR]");
    process.exit(1);
  }
  try {
    console.log(releaseNotes(tag, { app: args.includes("--app"), changelogDir }));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
