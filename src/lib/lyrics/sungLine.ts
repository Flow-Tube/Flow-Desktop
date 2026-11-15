import type { LyricsEntry } from "./types";

/** Lines at or past this time are placeholders for plain lyrics, not timed lines. */
const PLAIN_PLACEHOLDER_MS = 1_000_000_000;
/** A line without word times is taken to last at most this long, so a break after it shows. */
const MAX_LINE_MS = 8000;
/** A line that ends this long before the next one gives way to the artist once it is over. */
const BREAK_MS = 6000;

/** Whether an entry is a timed main line the mini player can sing. */
export const isSungLine = (entry: LyricsEntry): boolean =>
  !entry.isBackground && entry.time > 0 && entry.time < PLAIN_PLACEHOLDER_MS && entry.text.trim().length > 0;

/**
 * The index of the line being sung at `atMs`, for the mini player. Null before the first line,
 * during a long instrumental break, and for unsynced lyrics, so the mini player shows the artist.
 */
export function sungLineIndexAt(entries: readonly LyricsEntry[], atMs: number): number | null {
  let index = -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (!isSungLine(entry)) continue;
    if (entry.time > atMs) break;
    index = i;
  }
  if (index < 0) return null;
  const line = entries[index]!;
  const next = entries.slice(index + 1).find((entry) => isSungLine(entry) && entry.time > line.time);
  const lastWord = line.words?.[line.words.length - 1];
  const end = lastWord ? lastWord.endTime : Math.min(next?.time ?? Infinity, line.time + MAX_LINE_MS);
  if (atMs > end && (!next || next.time - end > BREAK_MS)) return null;
  return index;
}

/** When each entry's next timed line starts, for spreading word timings over a line that has none. */
export function nextLineTimes(entries: readonly LyricsEntry[]): Array<number | null> {
  return entries.map((entry, i) => entries.slice(i + 1).find((other) => isSungLine(other) && other.time > entry.time)?.time ?? null);
}
