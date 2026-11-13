import type { LyricsEntry } from "./types";

/** Android's cap: a card holds at most five lyric lines. */
export const MAX_SHARE_LINES = 5;

/** A line worth putting on a card: not blank and not a section marker such as "[Chorus]". */
export function isShareableLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.startsWith("[");
}

export interface ShareLine {
  text: string;
  /** Milliseconds into the song, for synced lyrics. */
  time: number | null;
}

/** The lines the picker lists, from synced lyrics when there are any, else from the plain text. */
export function shareLines(entries: LyricsEntry[], plain: string): ShareLine[] {
  if (entries.length > 0) {
    return entries.filter((entry) => isShareableLine(entry.text)).map((entry) => ({ text: entry.text.trim(), time: entry.time }));
  }
  return plain
    .split("\n")
    .filter(isShareableLine)
    .map((text) => ({ text: text.trim(), time: null }));
}

/** The line playing at `positionMs`: the last one that has started, or the first. */
export function shareLineIndexAt(lines: ShareLine[], positionMs: number): number {
  let index = 0;
  lines.forEach((line, i) => {
    if (line.time !== null && line.time <= positionMs) index = i;
  });
  return index;
}

/** Selects or deselects `index`, keeping song order and refusing a line past the cap. */
export function toggleShareLine(selected: number[], index: number): number[] {
  if (selected.includes(index)) return selected.filter((i) => i !== index);
  if (selected.length >= MAX_SHARE_LINES) return selected;
  return [...selected, index].sort((a, b) => a - b);
}
