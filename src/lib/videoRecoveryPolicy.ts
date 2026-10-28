/**
 * When a video that stopped mid-way fetches fresh links by itself. A source
 * that played and then stopped was most likely refused or its link expired, and
 * another source mode built from the same links fails the same way. A long
 * video can hit that more than once (a VPN changing exit, links expiring), so
 * it gets a few tries, each only after the last one carried playback on.
 */

/** Fresh link sets fetched for one video without asking. */
export const MAX_AUTO_RERESOLVES = 3;

/** How far playback must have moved past the last recovery before another one. */
export const RERESOLVE_SPACING_SECONDS = 5 * 60;

export interface ReResolveHistory {
  videoId: string;
  count: number;
  /** Where the last recovery resumed. */
  position: number;
}

export interface ReResolveAttempt {
  videoId: string;
  position: number;
  isLive: boolean;
  /** The failing source played before it stopped. */
  sourcePlayed: boolean;
  /** Another source mode is left to try with the current links. */
  hasNextSource: boolean;
}

export function shouldAutoReResolve(history: ReResolveHistory | null, attempt: ReResolveAttempt): boolean {
  if (attempt.isLive) return false;
  // A source that never started is more likely the mode's fault than the links'.
  if (!attempt.sourcePlayed && attempt.hasNextSource) return false;
  if (!history || history.videoId !== attempt.videoId) return true;
  return history.count < MAX_AUTO_RERESOLVES && attempt.position >= history.position + RERESOLVE_SPACING_SECONDS;
}

export function recordAutoReResolve(history: ReResolveHistory | null, videoId: string, position: number): ReResolveHistory {
  const count = history && history.videoId === videoId ? history.count + 1 : 1;
  return { videoId, count, position };
}
