import type { VideoSummary } from "../types/video";

/**
 * Keeps an already-visible Home feed stable while adding newly ranked results.
 *
 * The Home feed paints in stages — cached or persisted feed, then a starter
 * feed, then the fully ranked one — and each stage deliberately excludes
 * session-seen videos. Replacing the visible feed with a later stage's output
 * therefore swaps every card the user is currently looking at, which is the
 * flicker this exists to stop.
 *
 * Two things it deliberately does not do:
 *
 * 1. It never reorders what is already on screen — that is the whole point —
 *    so a caller that needs an item hoisted (fresh subscription uploads, say)
 *    must compose that on top of the result rather than expect ranking to
 *    survive. Reconcile first, hoist second.
 * 2. It does not diversify. `appendUniqueVideos` in Home is the other half of
 *    this pair: it spreads channels out and prefers session-fresh videos
 *    because infinite scroll wants variety, whereas a refresh landing under
 *    the user's eyes wants the ranked order it was given.
 *
 * Returns `current` unchanged when nothing new arrived, so a late duplicate
 * result cannot re-render the grid.
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
