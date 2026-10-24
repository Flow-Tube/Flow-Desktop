import type { LyricsEntry, WordTimestamp } from "../types";
import { entriesAreSynced } from "../sync";

/** Port of Android's LyricsModel.kt: the rows the lyrics panel lays out, and which are being sung. */

export type LyricsListItem =
  | { kind: "line"; index: number; entry: LyricsEntry }
  | { kind: "indicator"; afterLineIndex: number; gapStartMs: number; gapEndMs: number };

/** Plain lyrics get placeholder times past any song, so they never read as synced. */
export const PLAIN_LINE_BASE_MS = 1_000_000;

export function adaptiveLyricsTextSize(baseSize: number, textLength: number, isBackground: boolean): number {
  const foreground =
    textLength > 92
      ? baseSize * 0.66
      : textLength > 72
        ? baseSize * 0.72
        : textLength > 54
          ? baseSize * 0.8
          : textLength > 42
            ? baseSize * 0.9
            : baseSize;
  return isBackground ? foreground * 0.7 : foreground;
}

export function buildLines(lyrics: string | null, syncedLyrics: LyricsEntry[]): LyricsEntry[] {
  if (syncedLyrics.length > 0 && entriesAreSynced(syncedLyrics)) {
    return [{ time: 0, text: "" }, ...[...syncedLyrics].sort((a, b) => a.time - b.time)];
  }
  const plainSource = lyrics?.trim() ? lyrics : syncedLyrics.map((e) => e.text).join("\n");
  return plainSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, index) => ({ time: PLAIN_LINE_BASE_MS + index, text }));
}

/** An instrumental break of more than four seconds between lines gets its own indicator row. */
export function buildMergedLyricsList(lines: LyricsEntry[]): LyricsListItem[] {
  const result: LyricsListItem[] = [];
  lines.forEach((entry, index) => {
    if (entry.text.trim()) result.push({ kind: "line", index, entry });
    const next = lines[index + 1];
    if (!next) return;
    const words = entry.words;
    const currentEnd = words && words.length > 0 ? words[words.length - 1]!.endTime : !entry.text.trim() ? entry.time : null;
    if (currentEnd !== null && currentEnd < next.time && next.time - currentEnd > 4000) {
      result.push({ kind: "indicator", afterLineIndex: index, gapStartMs: currentEnd, gapEndMs: next.time });
    }
  });
  return result;
}

export function findActiveLineIndices(lines: LyricsEntry[], position: number): Set<number> {
  const active = new Set<number>();
  const hasWordTimings = lines.some((l) => l.words && l.words.length > 0);
  const mainTimes = new Set<number>();
  for (const line of lines) {
    if (line.isBackground) continue;
    mainTimes.add(line.time);
    if (mainTimes.size >= 2) break;
  }
  if (mainTimes.size < 2) return active;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.time > position) break;
    let lineEnd = Number.POSITIVE_INFINITY;
    if (line.words && line.words.length > 0) {
      lineEnd = line.words[line.words.length - 1]!.endTime;
    } else {
      for (let j = index + 1; j < lines.length; j++) {
        if (lines[j]!.time > line.time) {
          lineEnd = lines[j]!.time;
          break;
        }
      }
    }
    if (position <= lineEnd) active.add(index);
  }

  if (!hasWordTimings && active.size > 1) {
    const mainActive = [...active].filter((i) => !lines[i]!.isBackground);
    if (mainActive.length > 1) {
      const maxTime = Math.max(...mainActive.map((i) => lines[i]!.time));
      for (const i of mainActive) if (lines[i]!.time < maxTime) active.delete(i);
    }
  }
  return active;
}

export function sanitizeWordTimestamps(words: WordTimestamp[]): WordTimestamp[] {
  return words.map((word, index) => {
    const next = words[index + 1];
    const start = Math.max(0, word.startTime);
    const endFromNext = next && next.startTime > start ? next.startTime : null;
    const end =
      endFromNext !== null && word.endTime > endFromNext ? endFromNext : word.endTime <= start ? start + 80 : word.endTime;
    return { ...word, startTime: start, endTime: end };
  });
}

/**
 * The last word of a line, when it holds hyphens ("la-la-la"), is sung as separate syllables:
 * split it into timed segments.
 */
export function splitTrailingHyphenWord(words: WordTimestamp[]): WordTimestamp[] {
  const last = words[words.length - 1];
  if (!last || !last.text.includes("-") || last.text.length <= 1) return words;
  const segments: string[] = [];
  let start = 0;
  for (let i = 0; i < last.text.length; i++) {
    if (last.text[i] === "-") {
      segments.push(last.text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < last.text.length) segments.push(last.text.slice(start));
  if (segments.length <= 1) return words;
  // Integer division, as on Android, so segment boundaries land on whole milliseconds.
  const segmentDuration = Math.trunc((last.endTime - last.startTime) / segments.length);
  return [
    ...words.slice(0, -1),
    ...segments.map((text, i) => ({
      text,
      startTime: last.startTime + i * segmentDuration,
      endTime: last.startTime + (i + 1) * segmentDuration,
    })),
  ];
}
