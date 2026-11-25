// The release history the updater manifests carry, so an installed app can list
// what changed since its own build and nothing older. latest.json keeps its
// plain `notes` for installs that predate this; newer ones read `history`.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { changelogSections, compareReleases, nextPreRelease, parseChangelog } from "./changelog-format.mjs";

/** Releases a manifest lists: enough for someone who skipped a few. */
export const RELEASE_HISTORY_LIMIT = 5;
/** Nightly runs that added notes, about four months of daily builds. */
export const NIGHTLY_HISTORY_LIMIT = 120;

const CHANGELOG_FILE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\.txt$/;

/** Every changelog in `dir` as `{ version, date, status, sections }`. */
export function readChangelogs(dir) {
  return readdirSync(dir)
    .filter((name) => CHANGELOG_FILE.test(name))
    .map((name) => {
      const { meta, blocks } = parseChangelog(readFileSync(join(dir, name), "utf8"));
      return {
        version: (meta.VERSION ?? name.slice(1, -4)).replace(/^v/i, ""),
        date: meta.DATE ?? null,
        status: meta.STATUS ?? "",
        sections: changelogSections(blocks),
      };
    });
}

/**
 * `version` and the releases before it, newest first, at most `limit`. Only
 * released changelogs count, so a pre-release file never reaches a release.
 */
export function releaseHistory(changelogs, version, limit = RELEASE_HISTORY_LIMIT) {
  const released = changelogs
    .filter((entry) => entry.status === "RELEASE" || entry.version === version)
    .sort(compareReleases);
  const index = released.findIndex((entry) => entry.version === version);
  if (index === -1) throw new Error(`no changelog for ${version}`);
  return released
    .slice(Math.max(0, index + 1 - limit), index + 1)
    .reverse()
    .map(({ version: entryVersion, date, sections }) => ({ version: entryVersion, date, sections }));
}

/**
 * Adds this run's group to the previous manifest's nightly history: the bullets
 * of the next release's changelog that no earlier run listed. A bullet that is
 * reworded counts as new. Newest run first.
 */
export function nightlyHistory({ previous, pending, run, date, limit = NIGHTLY_HISTORY_LIMIT }) {
  const earlier = (Array.isArray(previous) ? previous : []).filter(
    (group) => Number.isInteger(group?.run) && group.run < run && Array.isArray(group.sections),
  );
  const seen = new Set(earlier.flatMap((group) => group.sections.flatMap((section) => section.items)));
  const sections = pending
    .map((section) => ({ title: section.title, items: section.items.filter((item) => !seen.has(item)) }))
    .filter((section) => section.items.length > 0);
  const groups = sections.length > 0 ? [{ run, date, sections }, ...earlier] : earlier;
  return groups.slice(0, limit);
}

/** The `history` of an earlier manifest file, or none when it can't be read. */
export function readManifestHistory(path) {
  try {
    const history = JSON.parse(readFileSync(path, "utf8")).history;
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

/** The sections the next release's changelog lists so far, or none. */
export function pendingSections(changelogs, currentVersion) {
  return nextPreRelease(changelogs, currentVersion)?.sections ?? [];
}
