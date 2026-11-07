import type { LyricsEntry } from "./types";
import { segmenter } from "./display/textLayout";

/**
 * Port of Android's SessionLyricTimeline: which lyric text belongs at a playback position, for the
 * system's media controls. Their title is cut off after a line or so, so a long line is shown in
 * parts, one after the other.
 */

const MAX_LINE_WIDTH = 24;
const WIDE_CHARACTER_WEIGHT = 1.75;
const MAX_PIECES = 4;
const MIN_PIECE_MS = 700;
/** A slow singer's pace, so a line followed by a long gap doesn't stretch its parts across the gap. */
const MAX_MS_PER_CHARACTER = 100;
/** Lyrics often leave a solo unmarked, so a silence this long after a line's words counts as a break too. */
const MIN_BREAK_MS = 5_000;
const BREAK_FRAME_MS = 3_000;
const BREAK_FRAMES = ["♪", "♪♪", "♪♪♪"];

/** The steps of the setting that moves the lines if they feel late or early. */
export const MEDIA_LYRICS_DELAY = {
  MAX_MS: 2_000,
  STEP_MS: 200,
  snap(delayMs: number): number {
    const snapped = Math.round(delayMs / this.STEP_MS) * this.STEP_MS;
    return Math.max(-this.MAX_MS, Math.min(this.MAX_MS, snapped)) || 0;
  },
};

interface Piece {
  text: string;
  timeMs: number;
}

interface Break {
  startMs: number;
  endMs: number;
}

const isSung = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

/** Case and punctuation don't make a line another line, but vowel signs do: कमल isn't कमली. */
const repeatKey = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();

const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function lineWidth(text: string): number {
  let width = 0;
  for (const character of text) width += WIDE.test(character) ? WIDE_CHARACTER_WEIGHT : 1;
  return width;
}

/** The artist line shown under a lyric, which keeps the song's name in view. */
export function mediaLyricArtist(title: string | null | undefined, artist: string | null | undefined): string {
  return [title, artist].filter((part): part is string => !!part && part.trim() !== "").join(" - ");
}

/** The parts of the song with no words: a long intro, a line the lyrics leave blank or a long silence. */
function breaksOf(lines: LyricsEntry[]): Break[] {
  const first = lines[0];
  if (!first) return [];
  const found: Break[] = [];
  if (first.time >= MIN_BREAK_MS) found.push({ startMs: 0, endMs: first.time });
  lines.forEach((line, index) => {
    const nextMs = lines[index + 1]?.time ?? Number.POSITIVE_INFINITY;
    const text = line.text.trim();
    if (!isSung(text)) {
      found.push({ startMs: line.time, endMs: nextMs });
      return;
    }
    const sungUntil =
      line.words && line.words.length > 0
        ? Math.max(...line.words.map((word) => word.endTime))
        : line.time + text.length * MAX_MS_PER_CHARACTER;
    if (nextMs - sungUntil >= MIN_BREAK_MS) found.push({ startMs: sungUntil, endMs: nextMs });
  });
  const merged: Break[] = [];
  for (const next of found) {
    const last = merged[merged.length - 1];
    if (last && next.startMs <= last.endMs) merged[merged.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, next.endMs) };
    else merged.push(next);
  }
  return merged;
}

/** How many times in a row the line at `index` has been sung, counting itself. */
function repeatCount(lines: LyricsEntry[], index: number): number {
  const text = lines[index]!.text.trim();
  if (!isSung(text)) return 1;
  const key = repeatKey(text);
  let first = index;
  while (first > 0 && repeatKey(lines[first - 1]!.text) === key) first--;
  return index - first + 1;
}

function codePointStarts(text: string): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const character of text) {
    starts.push(at);
    at += character.length;
  }
  return starts;
}

/** Where to cut for two parts of about equal width: at a space when there is one, else between characters. */
function balancedBreak(text: string): number | null {
  let cuts: number[] = [];
  for (let i = 1; i < text.length; i++) if (/\s/.test(text[i]!)) cuts.push(i);
  if (cuts.length === 0) {
    const graphemes = segmenter("grapheme");
    const starts = graphemes ? [...graphemes.segment(text)].map((g) => g.index) : codePointStarts(text);
    cuts = starts.filter((at) => at > 0 && at < text.length);
  }
  let best: number | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const at of cuts) {
    const gap = Math.abs(lineWidth(text.slice(0, at)) - lineWidth(text.slice(at)));
    if (gap < bestGap) {
      best = at;
      bestGap = gap;
    }
  }
  return best;
}

/** Halves `text` at the break nearest its middle until every part fits or `maxParts` is reached. */
function splitToFit(text: string, maxParts: number): string[] {
  const parts = [text];
  while (parts.length < maxParts) {
    let widest = 0;
    parts.forEach((part, i) => {
      if (lineWidth(part) > lineWidth(parts[widest]!)) widest = i;
    });
    const part = parts[widest]!;
    if (lineWidth(part) <= MAX_LINE_WIDTH) break;
    const at = balancedBreak(part);
    if (at === null) break;
    parts.splice(widest, 1, part.slice(0, at).trim(), part.slice(at).trim());
  }
  return parts;
}

/** When the word at `offset` in the line's text starts, if the provider timed its words. */
function wordStartAt(line: LyricsEntry, offset: number): number | null {
  const text = line.text.trim();
  let cursor = 0;
  for (const word of line.words ?? []) {
    const own = word.text.trim();
    if (!own) continue;
    const start = text.indexOf(own, cursor);
    if (start < 0) return null;
    if (start >= offset) return word.startTime;
    cursor = start + own.length;
  }
  return null;
}

/**
 * The parts of the lines in order, with their repeats counted. A part can repeat what was just
 * shown without its whole line doing so: "Kamli" followed by "Kamli (Mahiya)" shows "Kamli" twice.
 */
function piecesOf(lines: LyricsEntry[], repeated: (line: string, count: number) => string): Piece[] {
  let previousKey = "";
  let previousCount = 1;
  return lines.flatMap((line, index) => {
    const text = line.text.trim();
    const spokenMs = index + 1 < lines.length ? lines[index + 1]!.time - line.time : Number.POSITIVE_INFINITY;
    const spanMs = Math.min(spokenMs, text.length * MAX_MS_PER_CHARACTER);
    const parts = splitToFit(text, Math.max(1, Math.min(MAX_PIECES, Math.floor(spanMs / MIN_PIECE_MS))));
    const lineCount = repeatCount(lines, index);
    let consumed = 0;
    return parts.map((part, partIndex) => {
      const start = Math.max(text.indexOf(part, consumed), consumed);
      consumed = start + part.length;
      const timeMs =
        start === 0 ? line.time : (wordStartAt(line, start) ?? line.time + Math.floor((spanMs * start) / Math.max(1, text.length)));
      const key = repeatKey(part);
      const count =
        partIndex === parts.length - 1 && lineCount > 1 ? lineCount : isSung(part) && key === previousKey ? previousCount + 1 : 1;
      previousKey = key;
      previousCount = count;
      return { text: count > 1 ? repeated(part, count) : part, timeMs };
    });
  });
}

export class MediaLyricTimeline {
  private readonly pieces: Piece[];
  private readonly breaks: Break[];

  /** `offsetMs` is added to the player's position to get the lyrics' time. */
  constructor(
    entries: LyricsEntry[],
    private readonly offsetMs: number,
    repeated: (line: string, count: number) => string,
  ) {
    const lines = entries.filter((entry) => !entry.isBackground).sort((a, b) => a.time - b.time);
    this.pieces = piecesOf(lines, repeated);
    this.breaks = breaksOf(lines);
  }

  /** The text sung at `positionMs`, music notes during a break, or null just before the first line. */
  lineAt(positionMs: number): string | null {
    const lyricTime = positionMs + this.offsetMs;
    const current = this.breakAt(lyricTime);
    if (current) return BREAK_FRAMES[Math.floor((lyricTime - current.startMs) / BREAK_FRAME_MS) % BREAK_FRAMES.length]!;
    let shown: Piece | undefined;
    for (const piece of this.pieces) {
      if (piece.timeMs > lyricTime) break;
      shown = piece;
    }
    return shown && isSung(shown.text) ? shown.text : null;
  }

  /** The player position of the next change after `positionMs`, or null after the last one. */
  nextChangeAfter(positionMs: number): number | null {
    const lyricTime = positionMs + this.offsetMs;
    const current = this.breakAt(lyricTime);
    let next: number | null;
    if (current) {
      const frames = Math.floor((lyricTime - current.startMs) / BREAK_FRAME_MS) + 1;
      next = Math.min(current.startMs + frames * BREAK_FRAME_MS, current.endMs);
    } else {
      const candidates = [
        this.pieces.find((piece) => piece.timeMs > lyricTime)?.timeMs,
        this.breaks.find((b) => b.startMs > lyricTime)?.startMs,
      ].filter((value): value is number => value !== undefined);
      next = candidates.length > 0 ? Math.min(...candidates) : null;
    }
    return next === null ? null : next - this.offsetMs;
  }

  private breakAt(lyricTime: number): Break | undefined {
    return this.breaks.find((b) => lyricTime >= b.startMs && lyricTime < b.endMs);
  }
}
