import { compareReleases, compareVersions } from "../../scripts/changelog-format.mjs";
import type { ChangelogRelease, ChangelogSection } from "./about/changelog";

/** What an update dialog lists: only the changes since the installed build. */
export interface UpdateNotes {
  /** Newest first. A nightly's runs are merged into one entry, as Flow for Android does. */
  releases: ChangelogRelease[];
  /** For a nightly, the run the install is on. */
  sinceRun: number | null;
}

const NIGHTLY_RUN = /[-+]nightly\.(\d+)$/;

/** 1760 for 0.1.0-nightly.1760 (Windows, macOS) or 0.1.0+nightly.1760 (Linux). */
export function nightlyRun(version: string): number | null {
  const match = NIGHTLY_RUN.exec(version);
  return match ? Number(match[1]) : null;
}

function isSections(value: unknown): value is ChangelogSection[] {
  return Array.isArray(value) && value.every(
    (section) => typeof section?.title === "string"
      && Array.isArray(section.items)
      && section.items.every((item: unknown) => typeof item === "string"),
  );
}

interface RunEntry {
  run: number;
  date: string | null;
  sections: ChangelogSection[];
}

function releaseEntries(history: unknown[]): ChangelogRelease[] {
  return history.flatMap((entry) => {
    const candidate = entry as Partial<ChangelogRelease> | null;
    if (typeof candidate?.version !== "string" || !isSections(candidate.sections)) return [];
    return [{ version: candidate.version, date: typeof candidate.date === "string" ? candidate.date : null, sections: candidate.sections }];
  });
}

function runEntries(history: unknown[]): RunEntry[] {
  return history.flatMap((entry) => {
    const candidate = entry as Partial<RunEntry> | null;
    if (!Number.isInteger(candidate?.run) || !isSections(candidate?.sections)) return [];
    return [{ run: candidate!.run!, date: typeof candidate!.date === "string" ? candidate!.date : null, sections: candidate!.sections! }];
  });
}

/** Every run's sections in one list, oldest run first, so each section reads in the order it grew. */
function mergeRuns(runs: RunEntry[]): ChangelogSection[] {
  const merged = new Map<string, string[]>();
  for (const run of [...runs].sort((a, b) => a.run - b.run)) {
    for (const section of run.sections) {
      const items = merged.get(section.title) ?? [];
      for (const item of section.items) if (!items.includes(item)) items.push(item);
      merged.set(section.title, items);
    }
  }
  return [...merged].map(([title, items]) => ({ title, items }));
}

/**
 * The notes in an update manifest's `history` that are newer than the installed build:
 * releases dated after the installed one, or nightly runs after the installed
 * run. `installedDate` comes from the installed version's own bundled changelog;
 * the version decides when it has none. Null when the manifest has no usable
 * history, so the dialog falls back to its plain notes.
 */
export function notesSinceInstalled(
  history: unknown,
  installed: { version: string; date: string | null },
  offeredVersion: string,
): UpdateNotes | null {
  if (!Array.isArray(history)) return null;

  const offeredRun = nightlyRun(offeredVersion);
  if (offeredRun !== null) {
    const installedRun = nightlyRun(installed.version) ?? 0;
    const runs = runEntries(history).filter((entry) => entry.run > installedRun && entry.run <= offeredRun);
    if (runs.length === 0) return null;
    const newest = runs.reduce((a, b) => (b.run > a.run ? b : a));
    return {
      releases: [{ version: offeredVersion, date: newest.date, sections: mergeRuns(runs) }],
      sinceRun: installedRun || null,
    };
  }

  // The manifest lists the offered release and the ones before it.
  const releases = releaseEntries(history)
    .filter((entry) => (installed.date
      ? compareReleases(entry, installed) > 0
      : compareVersions(entry.version, installed.version) > 0))
    .sort((a, b) => compareReleases(b, a));
  return releases.length > 0 ? { releases, sinceRun: null } : null;
}

/** The update's notes since this install, read from its manifest; null when there are none to list. */
export async function updateNotesFor(update: { rawJson: Record<string, unknown>; currentVersion: string; version: string }): Promise<UpdateNotes | null> {
  try {
    const { loadChangelog } = await import("./about/changelog");
    const installed = (await loadChangelog()).find((release) => release.version === update.currentVersion);
    return notesSinceInstalled(update.rawJson.history, { version: update.currentVersion, date: installed?.date ?? null }, update.version);
  } catch (error) {
    console.error("Couldn't read the update's notes", error);
    return null;
  }
}
