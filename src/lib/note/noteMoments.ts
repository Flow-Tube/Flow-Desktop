import { formatTime } from "../musicFormat";
import type { RichText } from "../../types/video";

/** A time written in a note: where it sits in the text, where it points in the video, and the words after it. */
export interface NoteMoment {
  start: number;
  end: number;
  seconds: number;
  label: string;
}

// The first group is what may precede a time; lookbehind would say this more simply, but older
// WebKit builds reject it outright.
const TIMESTAMP = /(^|[^\d:.])((?:\d{1,2}:)?\d{1,2}:\d{2})(?!\d|:\d)/g;
const LABEL_TRIM = /^[ \t\-–—:|·•]+|[ \t\-–—:|·•]+$/g;

const trimLabel = (text: string) => text.replace(LABEL_TRIM, "");

function labelAfter(text: string, end: number): string {
  const lineEnd = text.indexOf("\n", end);
  const rest = trimLabel(text.slice(end, lineEnd < 0 ? text.length : lineEnd));
  const next = [...rest.matchAll(TIMESTAMP)][0];
  return next ? trimLabel(rest.slice(0, (next.index ?? 0) + (next[1]?.length ?? 0))) : rest;
}

/**
 * Every time in `text`, in writing order, read the way Flow for Android reads them. With
 * `durationSeconds` known, a time past the end of the video is not one of its moments; minutes or
 * seconds of 60 and more never are.
 */
export function findMoments(text: string, durationSeconds = 0): NoteMoment[] {
  const moments: NoteMoment[] = [];
  for (const match of text.matchAll(TIMESTAMP)) {
    const stamp = match[2] ?? "";
    const fields = stamp.split(":").map(Number);
    if (fields.slice(1).some((field) => field >= 60)) continue;
    const seconds = fields.reduce((total, field) => total * 60 + field, 0);
    if (durationSeconds > 0 && seconds > durationSeconds) continue;
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    const end = start + stamp.length;
    moments.push({ start, end, seconds, label: labelAfter(text, end) });
  }
  return moments;
}

/** One entry per time, earliest first, for a list of where to jump. */
export function timeline(text: string, durationSeconds = 0): NoteMoment[] {
  const seen = new Set<number>();
  return findMoments(text, durationSeconds)
    .filter((moment) => !seen.has(moment.seconds) && seen.add(moment.seconds))
    .sort((a, b) => a.seconds - b.seconds);
}

/**
 * Writes `seconds` at `cursor`, on a line of its own unless the cursor already starts one, and
 * returns the new text with the cursor after the time, ready for its description.
 */
export function insertMoment(text: string, cursor: number, seconds: number): { text: string; cursor: number } {
  const at = Math.min(Math.max(cursor, 0), text.length);
  const startsLine = at === 0 || text[at - 1] === "\n";
  const stamp = `${startsLine ? "" : "\n"}${formatTime(seconds)} `;
  return { text: text.slice(0, at) + stamp + text.slice(at), cursor: at + stamp.length };
}

/** A note's text with every time in it as a link. */
export function noteRichText(text: string, durationSeconds = 0): RichText {
  return {
    text,
    spans: findMoments(text, durationSeconds).map((moment) => ({
      start: moment.start,
      length: moment.end - moment.start,
      target: { kind: "timestamp", seconds: moment.seconds },
    })),
    emojis: [],
  };
}
