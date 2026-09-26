import type { VideoSummary } from "../types/video";

// Mirrors Flow-Android's DateDisplay.

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function parseRelativeToTimestamp(text: string, now = Date.now()): number | null {
  const n = text.toLowerCase().replace(/streamed|premiered|live|ago/g, "").trim();
  if (!n) return null;
  if (n.includes("just now") || n.includes("today")) return now;
  if (n.includes("yesterday")) return now - DAY_MS;

  const compactMatch = n.match(
    /(\d+)\s*(mo|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|[smhdwy])\b/,
  );
  const value = Number(compactMatch?.[1] ?? n.match(/\d+/)?.[0]);
  if (!Number.isFinite(value)) return null;

  const compactUnit = compactMatch?.[2] ?? "";
  const is = (units: string[], word: string) => units.includes(compactUnit) || n.includes(word);
  let unitMs: number;
  if (is(["s", "sec", "secs", "second", "seconds"], "second")) unitMs = SECOND_MS;
  else if (is(["m", "min", "mins", "minute", "minutes"], "minute")) unitMs = MINUTE_MS;
  else if (is(["h", "hr", "hrs", "hour", "hours"], "hour")) unitMs = HOUR_MS;
  else if (is(["d"], "day")) unitMs = DAY_MS;
  else if (is(["w"], "week")) unitMs = 7 * DAY_MS;
  else if (is(["mo"], "month")) unitMs = 30 * DAY_MS;
  else if (is(["y"], "year")) unitMs = 365 * DAY_MS;
  else return null;
  return now - value * unitMs;
}

export function formatYouTubeRelativeTime(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });
  if (days >= 365) return format.format(-Math.floor(days / 365), "year");
  if (days >= 30) return format.format(-Math.floor(days / 30), "month");
  if (days >= 7) return format.format(-Math.floor(days / 7), "week");
  if (days > 0) return format.format(-days, "day");
  if (hours > 0) return format.format(-hours, "hour");
  if (minutes > 0) return format.format(-minutes, "minute");
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(0, "second");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parseAbsoluteDate(text: string): number | null {
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])).getTime();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const timestamp = Date.parse(text);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  const monthFirst = text.match(/^([a-z]{3,})\.?\s+(\d{1,2}),\s*(\d{4})$/i);
  const dayFirst = text.match(/^(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{4})$/i);
  const [month, day, year] = monthFirst
    ? [monthFirst[1], monthFirst[2], monthFirst[3]]
    : dayFirst
      ? [dayFirst[2], dayFirst[1], dayFirst[3]]
      : [];
  const monthIndex = month ? MONTHS.indexOf(month.slice(0, 3).toLowerCase()) : -1;
  if (monthIndex < 0) return null;
  return new Date(Number(year), monthIndex, Number(day)).getTime();
}

export function parseToTimestamp(text: string | null | undefined, now = Date.now()): number | null {
  const raw = text?.trim() ?? "";
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 100_000_000_000) return numeric;

  const cleanRaw = raw.replace(/^(streamed|premiered)\s+(live\s+)?(on\s+)?/i, "").trim();
  return parseAbsoluteDate(cleanRaw) ?? parseRelativeToTimestamp(cleanRaw, now);
}

export function resolveDisplayUploadTimestamp(
  text: string,
  storedTimestamp: number | null | undefined,
  now = Date.now(),
): number | null {
  const stored = storedTimestamp && storedTimestamp > 0 ? storedTimestamp : null;
  const relative = parseRelativeToTimestamp(text, now);
  if (stored !== null && relative !== null) return Math.min(stored, relative);
  if (relative !== null) return relative;
  return preferStoredWithinDay(parseToTimestamp(text, now), stored);
}

// A date alone parses to midnight, so on the same day the stored time is more precise.
function preferStoredWithinDay(parsed: number | null, stored: number | null): number | null {
  if (parsed === null) return stored;
  if (stored === null) return parsed;
  return new Date(parsed).toDateString() === new Date(stored).toDateString() ? stored : parsed;
}

function relativePrefix(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.startsWith("streamed ")) return "Streamed";
  if (lower.startsWith("premiered ")) return "Premiered";
  return null;
}

export function withPublishedAt(video: VideoSummary, now = Date.now()): VideoSummary {
  if (!video.publishedText) return video;
  const publishedAt = resolveDisplayUploadTimestamp(video.publishedText, video.publishedAt, now);
  if (publishedAt === null || publishedAt === video.publishedAt) return video;
  return { ...video, publishedAt };
}

export function formatPublishedText(video: VideoSummary, now = Date.now()): string | null {
  const text = video.publishedText?.trim();
  if (!text) return null;
  if (!video.publishedAt || text.toLowerCase() === "live") return text;
  const timestamp = resolveDisplayUploadTimestamp(text, video.publishedAt, now);
  if (timestamp === null) return text;

  const relative = formatYouTubeRelativeTime(timestamp, now);
  const prefix = relativePrefix(text);
  return prefix ? `${prefix} ${relative}` : relative;
}
