import type { LyricsEntry } from "./types";

/** Lines at or past this time are placeholders for plain lyrics, not timed lines. */
const PLAIN_PLACEHOLDER_MS = 1_000_000_000;
/** A line without word times is taken to last at most this long, so a break after it shows. */
const MAX_LINE_MS = 8000;
/** A line that ends this long before the next one gives way to the artist once it is over. */
const BREAK_MS = 6000;

export interface SungLine {
  index: number;
  text: string;
  /** How much of the line has been sung, 0 to 1. */
  fill: number;
}

/**
 * The line being sung at `atMs`, for the mini player: filled word by word when the lyrics carry
 * word times, otherwise evenly up to the next line. Null before the first line, during a long
 * instrumental break, and for unsynced lyrics, so the mini player shows the artist then.
 */
export function sungLineAt(entries: readonly LyricsEntry[], atMs: number): SungLine | null {
  let index = -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.isBackground || entry.time <= 0 || entry.time >= PLAIN_PLACEHOLDER_MS) continue;
    if (entry.time > atMs) break;
    index = i;
  }
  if (index < 0) return null;
  const line = entries[index]!;
  const text = line.text.trim();
  if (!text) return null;
  const next = entries.slice(index + 1).find((entry) => !entry.isBackground && entry.time > line.time);
  const words = line.words ?? [];
  const lastWord = words[words.length - 1];
  const end = lastWord ? lastWord.endTime : Math.min(next?.time ?? Infinity, line.time + MAX_LINE_MS);
  if (atMs > end && (!next || next.time - end > BREAK_MS)) return null;
  if (words.length > 0) {
    const sung = words.filter((word) => word.startTime <= atMs).length;
    const current = words[Math.max(0, sung - 1)];
    const within =
      current && current.endTime > current.startTime
        ? Math.min(1, Math.max(0, (atMs - current.startTime) / (current.endTime - current.startTime)))
        : 1;
    return { index, text, fill: Math.min(1, (Math.max(0, sung - 1) + within) / words.length) };
  }
  const span = Math.max(1, end - line.time);
  return { index, text, fill: Math.min(1, Math.max(0, (atMs - line.time) / span)) };
}
