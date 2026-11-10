export type ChangelogBlock = { kind: "heading" | "text"; text: string } | { kind: "blank" };

export interface ParsedChangelog {
  meta: Record<string, string>;
  blocks: ChangelogBlock[];
}

export function parseChangelog(text: string): ParsedChangelog;
