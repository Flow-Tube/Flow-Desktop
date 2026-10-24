import type { LyricsEntry, WordTimestamp } from "./types";

const distinct = (nums: number[]): number[] => Array.from(new Set(nums));

// Line-level sync: ≥2 distinct times, ≥5s span, and word-timings OR ≥50% timed lines.
export function entriesAreSynced(entries: LyricsEntry[]): boolean {
  if (entries.length < 2) return false;
  const main = entries.filter((e) => !e.isBackground);
  const list = main.length >= 2 ? main : entries;
  const times = distinct(list.map((e) => e.time));
  if (times.length < 2) return false;
  const firstPositive = times.find((t) => t > 0);
  if (firstPositive === undefined) return false;
  const maxTime = Math.max(...list.map((e) => e.time));
  if (maxTime - firstPositive < 5000) return false;
  if (entries.some((e) => e.words && e.words.length > 0)) return true;
  const distinctTimedLines = list.filter((e) => e.time > 0).length;
  return distinctTimedLines >= Math.max(2, Math.floor(list.length * 0.5));
}

function lineHasValidTiming(words: WordTimestamp[]): boolean {
  const sorted = [...words].sort((a, b) => a.startTime - b.startTime);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return false;
  if (last.endTime <= first.startTime) return false;
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]!;
    const nxt = sorted[i + 1]!;
    if (cur.endTime < cur.startTime) return false;
    if (nxt.startTime < cur.startTime) return false;
  }
  return true;
}

// Stricter: a meaningful fraction of lines carry valid, ordered word timings.
export function hasWordSync(entries: LyricsEntry[]): boolean {
  const wordLines = entries.filter((e): e is LyricsEntry & { words: WordTimestamp[] } =>
    !!e.words && e.words.length > 0,
  );
  if (wordLines.length === 0) return false;
  const lineCount = Math.max(1, entries.length);
  const ratio = wordLines.length / lineCount;
  if (lineCount > 5 && wordLines.length < 3) return false;
  if (lineCount > 10 && ratio < 0.25) return false;

  const validTimingLines = wordLines.filter((e) => lineHasValidTiming(e.words)).length;
  if (validTimingLines < Math.min(2, wordLines.length)) return false;

  const firstWordMs = Math.min(...wordLines.map((e) => e.words[0]!.startTime));
  const lastWordMs = Math.max(...wordLines.map((e) => e.words[e.words.length - 1]!.endTime));
  if (lineCount > 5 && lastWordMs - firstWordMs < 10000) return false;
  return true;
}

// Sanity-check against the track: ≥10s span and start not far past the song end.
export function hasReasonableTimestamps(entries: LyricsEntry[], durationSec: number): boolean {
  const timed = entries.filter((e) => e.time > 0);
  if (timed.length < 2) return true;
  const firstMs = timed[0]!.time;
  const lastMs = timed[timed.length - 1]!.time;
  if (lastMs - firstMs < 10000) return false;
  if (durationSec > 0 && firstMs > durationSec * 1000 + 10000) return false;
  return true;
}

/** 3 word-synced, 2 line-synced, 1 plain, 0 none: which of two results is worth showing. */
export function lyricsQuality(entries: LyricsEntry[]): number {
  if (entries.length === 0) return 0;
  if (!entriesAreSynced(entries)) return 1;
  return hasWordSync(entries) ? 3 : 2;
}
