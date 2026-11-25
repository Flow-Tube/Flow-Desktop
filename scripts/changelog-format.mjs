// The format of changelog/*.txt, read by the release script and by the app's Changelog dialog,
// so this module must stay free of Node imports.
const TITLE_LINES = new Set(["FLOW DESKTOP CHANGE LOG", "FLOW CHANGE LOG"]);
const META_LINE = /^(VERSION|DATE|STATUS):(.*)$/i;
const HEADING_LINE = /^[A-Z][A-Z &/,:-]+:?$/;

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

/** "ABOUT" describes the app rather than a release, so no release list shows it. */
const SKIPPED_SECTION = "ABOUT";
const BULLET = /^[-*•]\s+/;

/** A parsed changelog's sections with their bullets, without ABOUT and empty sections. */
export function changelogSections(blocks) {
  const sections = [];
  let current = null;
  for (const block of blocks) {
    if (block.kind === "heading") {
      current = block.text === SKIPPED_SECTION ? null : { title: block.text, items: [] };
      if (current) sections.push(current);
    } else if (block.kind === "text" && current) {
      current.items.push(block.text.replace(BULLET, ""));
    }
  }
  return sections.filter((section) => section.items.length > 0);
}

// Sentence-casing a heading would otherwise print "Macos" or "Youtube".
const PROPER_NOUNS = { macos: "macOS", linux: "Linux", android: "Android", youtube: "YouTube", ui: "UI" };

/** "HOME AND RECOMMENDATIONS" → "Home and recommendations". */
export function sentenceCase(heading) {
  const lower = heading.toLowerCase();
  const cased = lower.charAt(0).toUpperCase() + lower.slice(1);
  return cased.replace(/[A-Za-z]+/g, (word) => PROPER_NOUNS[word.toLowerCase()] ?? word);
}

function splitVersion(version) {
  const [core, pre = ""] = version.replace(/^v/, "").split("+")[0].split(/-(.*)/s);
  return [core.split(".").map(Number), pre];
}

/** Semver order: a pre-release ranks below its release, and beta10 above beta4. */
export function compareVersions(a, b) {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (coreA[i] !== coreB[i]) return (coreA[i] ?? 0) - (coreB[i] ?? 0);
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA.localeCompare(preB, "en", { numeric: true });
}

/**
 * Release order, oldest first. The date decides, because the first release was
 * 0.1.0 and the betas after it rank below it in semver; the version settles a tie.
 */
export function compareReleases(a, b) {
  return (a.date ?? "").localeCompare(b.date ?? "") || compareVersions(a.version, b.version);
}

/** The release being worked on: the lowest-versioned PRE-RELEASE entry above `currentVersion`. */
export function nextPreRelease(entries, currentVersion) {
  return entries
    .filter((entry) => entry.status === "PRE-RELEASE" && compareVersions(entry.version, currentVersion) > 0)
    .sort((a, b) => compareVersions(a.version, b.version))[0] ?? null;
}
