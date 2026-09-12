import type { VideoSummary } from "../types/video";

/**
 * Keeps an already-visible Home feed stable while adding newly ranked results.
 * The refresh pipeline deliberately excludes session-seen videos, so replacing
 * the current feed with its output would otherwise swap every visible card.
 */
export function reconcileHomeFeedResults(
  current: VideoSummary[],
  incoming: VideoSummary[],
): VideoSummary[] {
  if (current.length === 0) {
    return incoming;
  }

  const seenIds = new Set(current.map((video) => video.id));
  const additions = incoming.filter((video) => {
    if (seenIds.has(video.id)) {
      return false;
    }
    seenIds.add(video.id);
    return true;
  });

  return additions.length === 0 ? current : [...current, ...additions];
}
