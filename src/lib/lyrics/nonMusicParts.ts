import type { LyricsEntry } from "./types";

/** A stretch of a music video with no song playing, on the video's clock. Port of Android's NonMusicParts.kt. */
export interface NonMusicPart {
  startMs: number;
  endMs: number;
}

/** Lines this close to the edge of a part can still be on the video's clock: votes and lyrics are both a little loose. */
const EDGE_MARGIN_MS = 1_500;
/** One stray line isn't enough to say lyrics were timed to something else. */
const MIN_LINES_INSIDE = 2;

/**
 * `entries` moved onto the video's clock, when they were timed to the song without the video's
 * non-music parts. Lines inside a part say they weren't on the video's clock, unless the song has a
 * spoken section or the part is marked too widely. Lyrics for the whole video then run past its end
 * once moved, so those stay. Lyrics already moved have no lines inside, so moving twice is harmless.
 */
export function onVideoClock(entries: LyricsEntry[], parts: NonMusicPart[], videoMs: number): LyricsEntry[] {
  const merged = mergedParts(parts);
  if (videoMs <= 0 || entries.length === 0 || !hasLinesInside(entries, merged)) return entries;
  if (videoTime(Math.max(...entries.map((entry) => entry.time)), merged) > videoMs) return entries;
  return entries.map((entry) => ({
    ...entry,
    time: videoTime(entry.time, merged),
    words: entry.words
      ? entry.words.map((word) => ({
          ...word,
          startTime: videoTime(word.startTime, merged),
          endTime: videoTime(word.endTime, merged),
        }))
      : entry.words,
  }));
}

function mergedParts(parts: NonMusicPart[]): NonMusicPart[] {
  const merged: NonMusicPart[] = [];
  for (const part of parts.filter((p) => p.endMs > p.startMs).sort((a, b) => a.startMs - b.startMs)) {
    const last = merged[merged.length - 1];
    if (last && part.startMs <= last.endMs) merged[merged.length - 1] = { ...last, endMs: Math.max(last.endMs, part.endMs) };
    else merged.push(part);
  }
  return merged;
}

/** Nobody sings in a part marked non-music, so lines there can't be on the video's clock. */
function hasLinesInside(entries: LyricsEntry[], parts: NonMusicPart[]): boolean {
  const inside = entries.filter(
    (entry) =>
      !entry.isBackground &&
      entry.text.trim() !== "" &&
      parts.some((part) => {
        const start = part.startMs === 0 ? 0 : part.startMs + EDGE_MARGIN_MS;
        return entry.time >= start && entry.time < part.endMs - EDGE_MARGIN_MS;
      }),
  );
  return inside.length >= MIN_LINES_INSIDE;
}

function videoTime(songMs: number, parts: NonMusicPart[]): number {
  return parts.reduce((videoMs, part) => (videoMs >= part.startMs ? videoMs + (part.endMs - part.startMs) : videoMs), songMs);
}
