import { recordFeedImpressions } from "./api/recommendation";
import type { VideoSummary } from "../types/video";

/** How long a card has to stay on screen before it counts as seen. */
export const IMPRESSION_DWELL_MS = 500;
/** Share of a card that has to be visible. */
export const IMPRESSION_VISIBLE_SHARE = 0.5;
const FLUSH_DELAY_MS = 1500;

const counted = new Set<string>();
let pending = new Map<string, VideoSummary>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const batch = [...pending.values()];
  pending = new Map();
  if (batch.length === 0) return;
  void recordFeedImpressions(batch).catch((error) => {
    // Not counted after all, so the next time the card is on screen it can try again.
    for (const video of batch) counted.delete(video.id);
    console.warn("Failed to record feed impressions", error);
  });
}

/**
 * Counts a card the viewer actually saw, once per app session: the ranker's fatigue
 * penalties should follow what was on screen, not every list that was painted.
 */
export function noteImpression(video: VideoSummary) {
  if (counted.has(video.id)) return;
  counted.add(video.id);
  pending.set(video.id, video);
  if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

/** Test seam: forgets what this session counted. */
export function resetImpressionsForTest() {
  counted.clear();
  pending = new Map();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
}
