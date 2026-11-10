const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "5 minutes ago" in the viewer's language, from when something happened. */
export function formatTimeAgo(atMs: number, nowMs: number): string {
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const elapsed = Math.max(0, nowMs - atMs);
  if (elapsed < HOUR_MS) return format.format(-Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return format.format(-Math.floor(elapsed / HOUR_MS), "hour");
  return format.format(-Math.floor(elapsed / DAY_MS), "day");
}
