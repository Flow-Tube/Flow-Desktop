// Turns changelog/<tag>.txt into the GitHub release body and the in-app
// update notes. Same parse as releasenote.sh in the Android repo.
// Usage: node scripts/release-notes.mjs <tag> [--app] [--changelog-dir DIR]
//        node scripts/release-notes.mjs --next <current version> [--app] [--changelog-dir DIR]
//          the changes the next release's changelog lists so far, for nightlies
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseChangelog } from "./changelog-format.mjs";

export const SUPPORT_MESSAGE =
  "Enjoying Flow? Consider supporting its development on [Open Collective](https://opencollective.com/flow-tube) or [Patreon](https://patreon.com/A_EDev) to help keep the app free, open source, ad-free, and improving!";

// Sentence-casing a heading would otherwise print "Macos" or "Youtube".
const PROPER_NOUNS = { macos: "macOS", linux: "Linux", android: "Android", youtube: "YouTube" };

function sentenceCase(heading) {
  const lower = heading.toLowerCase();
  const cased = lower.charAt(0).toUpperCase() + lower.slice(1);
  return cased.replace(/[A-Za-z]+/g, (word) => PROPER_NOUNS[word.toLowerCase()] ?? word);
}

function renderMarkdownBlocks(blocks) {
  const out = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      out.push(`## ${sentenceCase(block.text)}`, "");
    } else if (block.kind === "blank") {
      // A heading already left a blank line after itself.
      if (out.length > 0 && out.at(-1) !== "") out.push("");
    } else {
      out.push(block.text);
    }
  }
  return out;
}

export function renderGithubNotes({ meta, blocks }, tag) {
  const out = [`# Flow ${tag}`];
  const details = [];
  if (meta.DATE) details.push(`**Release date:** ${meta.DATE}`);
  if (meta.STATUS) details.push(`**Status:** ${sentenceCase(meta.STATUS)}`);
  if (details.length > 0) out.push("", ...details);
  out.push("", SUPPORT_MESSAGE);
  if (blocks.length > 0) out.push("", ...renderMarkdownBlocks(blocks));
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

function compareVersions(a, b) {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (coreA[i] !== coreB[i]) return coreA[i] - coreB[i];
  }
  // A pre-release ranks below its release; beta10 ranks above beta4.
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA.localeCompare(preB, "en", { numeric: true });
}

function splitVersion(version) {
  const [core, pre = ""] = version.replace(/^v/, "").split("+")[0].split(/-(.*)/s);
  return [core.split(".").map(Number), pre];
}

/**
 * The changes listed so far for the next release: the lowest-versioned
 * PRE-RELEASE changelog above `currentVersion`, without its ABOUT section.
 * Returns null when there is none.
 */
export function nextReleaseNotes(currentVersion, { app = false, changelogDir = "changelog" } = {}) {
  const next = readdirSync(changelogDir)
    .filter((name) => /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\.txt$/.test(name))
    .map((name) => ({ version: name.slice(1, -4), parsed: parseChangelog(readFileSync(join(changelogDir, name), "utf8")) }))
    .filter(({ version, parsed }) => parsed.meta.STATUS === "PRE-RELEASE" && compareVersions(version, currentVersion) > 0)
    .sort((a, b) => compareVersions(a.version, b.version))[0];
  if (!next) return null;

  const blocks = [];
  let inAbout = false;
  for (const block of next.parsed.blocks) {
    if (block.kind === "heading") inAbout = block.text === "ABOUT";
    if (!inAbout) blocks.push(block);
  }
  while (blocks[0]?.kind === "blank") blocks.shift();

  const body = app ? renderAppNotes({ blocks }) : renderMarkdownBlocks(blocks).join("\n");
  return { version: next.version, body };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf("--changelog-dir");
  const changelogDir = dirIndex === -1 ? "changelog" : args[dirIndex + 1];
  const tag = args.find(
    (arg, index) => !arg.startsWith("--") && (dirIndex === -1 || index !== dirIndex + 1),
  );
  if (!tag || !changelogDir) {
    console.error("Usage: node scripts/release-notes.mjs [--next] <tag or version> [--app] [--changelog-dir DIR]");
    process.exit(1);
  }
  try {
    if (args.includes("--next")) {
      const next = nextReleaseNotes(tag, { app: args.includes("--app"), changelogDir });
      if (next) console.log(next.body);
    } else {
      console.log(releaseNotes(tag, { app: args.includes("--app"), changelogDir }));
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
