import { changelogSections, compareReleases, parseChangelog, type ChangelogSection } from "../../../scripts/changelog-format.mjs";

export type { ChangelogSection };

export interface ChangelogRelease {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}

export function releaseFromText(fileName: string, text: string): ChangelogRelease {
  const { meta, blocks } = parseChangelog(text);
  return {
    version: meta.VERSION ?? fileName.replace(/^.*\/v?/, "").replace(/\.txt$/, ""),
    date: meta.DATE ?? null,
    sections: changelogSections(blocks),
  };
}

/** Newest first. Betas of one version share its numbers, so the date settles the order. */
export function sortReleases(releases: ChangelogRelease[]): ChangelogRelease[] {
  return [...releases].sort((a, b) => compareReleases(b, a));
}

// Lazy, so the notes of every release stay out of the startup bundle.
const FILES = import.meta.glob("../../../changelog/*.txt", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

export async function loadChangelog(): Promise<ChangelogRelease[]> {
  const releases = await Promise.all(
    Object.entries(FILES).map(async ([file, load]) => releaseFromText(file, await load())),
  );
  return sortReleases(releases);
}
