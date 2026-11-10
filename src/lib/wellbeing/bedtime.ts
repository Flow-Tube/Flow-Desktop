/** Waking up long after bedtime isn't when to say it's bedtime. */
const LATE_LIMIT_MS = 2 * 60 * 60_000;
const DAY_MINUTES = 24 * 60;

function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

/** The next time the clock reads `time` ("23:00") after `nowMs`; null for a time that isn't one. */
export function nextBedtimeAt(time: string, nowMs: number): number | null {
  const minutes = minutesOf(time);
  if (minutes === null) return null;
  const next = new Date(nowMs);
  next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (next.getTime() <= nowMs) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** What an armed reminder should do at `nowMs`: wait, notify, or pass quietly because it's far too late. */
export function bedtimeState(armedAt: number, nowMs: number): "wait" | "notify" | "missed" {
  if (nowMs < armedAt) return "wait";
  return nowMs - armedAt <= LATE_LIMIT_MS ? "notify" : "missed";
}

/** How long the sleep window from `start` to `end` lasts, wrapping past midnight. */
export function sleepWindowMs(start: string, end: string): number | null {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === null || to === null) return null;
  return (((to - from) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES * 60_000;
}
