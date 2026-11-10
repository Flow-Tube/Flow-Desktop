import type { WatchHistoryRecord } from "../types/db";

export type WatchedThreshold = "PERCENT_90" | "PERCENT_95" | "PERCENT_99" | "ALMOST_FINISHED";

const RULES: Record<WatchedThreshold, { minShare: number; maxRemainingSeconds: number }> = {
  PERCENT_90: { minShare: 0.9, maxRemainingSeconds: Infinity },
  PERCENT_95: { minShare: 0.95, maxRemainingSeconds: Infinity },
  PERCENT_99: { minShare: 0.99, maxRemainingSeconds: Infinity },
  // The last minute of a long video, and 90% of a short one: a one-minute video is not watched as it starts.
  ALMOST_FINISHED: { minShare: 0.9, maxRemainingSeconds: 60 },
};

const SHORT_COMPLETE_SHARE = 0.9;

/** The only definition of watched: every filter of watched videos reads history through this. */
export function isWatched(positionSeconds: number, durationSeconds: number, threshold: WatchedThreshold): boolean {
  if (positionSeconds <= 0 || durationSeconds <= 0) return false;
  const rule = RULES[threshold];
  return (
    positionSeconds / durationSeconds >= rule.minShare && durationSeconds - positionSeconds <= rule.maxRemainingSeconds
  );
}

/** The videos history counts as watched. Songs share the history and never count. */
export function watchedVideoIds(history: WatchHistoryRecord[], threshold: WatchedThreshold): Set<string> {
  const ids = new Set<string>();
  for (const record of history) {
    if (record.isMusic) continue;
    if (isWatched(record.watchDurationSeconds, record.totalDurationSeconds ?? 0, threshold)) ids.add(record.videoId);
  }
  return ids;
}

/** Finished Shorts: a fixed line of their own, not the video threshold. */
export function finishedShortIds(history: WatchHistoryRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const record of history) {
    const duration = record.totalDurationSeconds ?? 0;
    if (!record.isMusic && duration > 0 && record.watchDurationSeconds >= duration * SHORT_COMPLETE_SHARE) {
      ids.add(record.videoId);
    }
  }
  return ids;
}
