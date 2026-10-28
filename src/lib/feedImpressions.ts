import { recordFeedImpressions, recordSeenVideos } from "./api/recommendation";
import type { VideoSummary } from "../types/video";

/** How long a card has to stay on screen before it counts as seen. */
export const IMPRESSION_DWELL_MS = 500;
/** Share of a card that has to be visible. */
export const IMPRESSION_VISIBLE_SHARE = 0.5;
const FLUSH_DELAY_MS = 1500;

/** Sends each card once per app session, in batches. */
function sessionBatcher(send: (videos: VideoSummary[]) => Promise<void>, what: string) {
  const counted = new Set<string>();
  let pending = new Map<string, VideoSummary>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    flushTimer = null;
    const batch = [...pending.values()];
    pending = new Map();
    if (batch.length === 0) return;
    void send(batch).catch((error) => {
      // Not counted after all, so the next time the card is on screen it can try again.
      for (const video of batch) counted.delete(video.id);
      console.warn(`Failed to record ${what}`, error);
    });
  }

  return {
    note(video: VideoSummary) {
      if (counted.has(video.id)) return;
      counted.add(video.id);
      pending.set(video.id, video);
      if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
    },
    reset() {
      counted.clear();
      pending = new Map();
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = null;
    },
  };
}

const impressions = sessionBatcher(recordFeedImpressions, "feed impressions");
const sightings = sessionBatcher(
  (videos) => recordSeenVideos(videos.map((video) => video.id)),
  "seen videos",
);

/**
 * Counts a card the viewer actually saw, once per app session: the ranker's fatigue
 * penalties should follow what was on screen, not every list that was painted.
 */
export function noteImpression(video: VideoSummary) {
  impressions.note(video);
}

/**
 * Counts a card seen in a list the ranker does not learn from, such as the Watch page's
 * related videos. Only "Hide videos you've already seen" reads it.
 */
export function noteSeen(video: VideoSummary) {
  sightings.note(video);
}

/** Test seam: forgets what this session counted. */
export function resetImpressionsForTest() {
  impressions.reset();
  sightings.reset();
}
