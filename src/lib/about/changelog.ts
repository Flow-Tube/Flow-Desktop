import { parseChangelog } from "../../../scripts/changelog-format.mjs";

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}

/** "ABOUT" describes the app rather than the release, so it stays out of the dialog. */
const SKIPPED_SECTION = "ABOUT";

const BULLET = /^[-*•]\s+/;

export function releaseFromText(fileName: string, text: string): ChangelogRelease {
  const { meta, blocks } = parseChangelog(text);
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  for (const block of blocks) {
    if (block.kind === "heading") {
      current = block.text === SKIPPED_SECTION ? null : { title: block.text, items: [] };
      if (current) sections.push(current);
    } else if (block.kind === "text" && current) {
      current.items.push(block.text.replace(BULLET, ""));
    }
  }
  return {
    version: meta.VERSION ?? fileName.replace(/^.*\/v?/, "").replace(/\.txt$/, ""),
    date: meta.DATE ?? null,
    sections: sections.filter((section) => section.items.length > 0),
  };
}

/** Newest first. Betas of one version share its numbers, so the date settles the order. */
export function sortReleases(releases: ChangelogRelease[]): ChangelogRelease[] {
  return [...releases].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.version.localeCompare(a.version, undefined, { numeric: true }));
}

// Lazy, so the notes of every release stay out of the startup bundle.
const FILES = import.meta.glob("../../../changelog/*.txt", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

export async function loadChangelog(): Promise<ChangelogRelease[]> {
  const releases = await Promise.all(
    Object.entries(FILES).map(async ([file, load]) => releaseFromText(file, await load())),
  );
  return sortReleases(releases);
}
