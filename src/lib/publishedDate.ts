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

function relativePrefix(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.startsWith("streamed ")) return "Streamed";
  if (lower.startsWith("premiered ")) return "Premiered";
  return null;
}

export function withPublishedAt(video: VideoSummary, now = Date.now()): VideoSummary {
  const parsed = video.publishedText ? parseRelativeToTimestamp(video.publishedText, now) : null;
  if (parsed === null) return video;
  const publishedAt = video.publishedAt && video.publishedAt > 0
    ? Math.min(video.publishedAt, parsed)
    : parsed;
  return publishedAt === video.publishedAt ? video : { ...video, publishedAt };
}

export function formatPublishedText(video: VideoSummary, now = Date.now()): string | null {
  const text = video.publishedText?.trim();
  if (!text) return null;
  const parsed = parseRelativeToTimestamp(text, now);
  if (parsed === null || !video.publishedAt) return text;

  const relative = formatYouTubeRelativeTime(Math.min(video.publishedAt, parsed), now);
  const prefix = relativePrefix(text);
  return prefix ? `${prefix} ${relative}` : relative;
}
