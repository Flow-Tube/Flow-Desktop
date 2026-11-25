export type ChangelogBlock = { kind: "heading" | "text"; text: string } | { kind: "blank" };

export interface ParsedChangelog {
  meta: Record<string, string>;
  blocks: ChangelogBlock[];
}

export function parseChangelog(text: string): ParsedChangelog;

export interface ChangelogSection {
  title: string;
  items: string[];
}

export function changelogSections(blocks: ChangelogBlock[]): ChangelogSection[];
export function sentenceCase(heading: string): string;
export function compareVersions(a: string, b: string): number;
export function compareReleases(a: { version: string; date: string | null }, b: { version: string; date: string | null }): number;
export function nextPreRelease<T extends { version: string; status: string }>(entries: T[], currentVersion: string): T | null;
