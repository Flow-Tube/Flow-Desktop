import { useEffect, useState } from "react";
import { usePlayerStore } from "../store/usePlayerStore";

/** How long secondary content waits before loading anyway. A video that never
 * starts — a restriction, an extraction failure, a paused cold open — still has
 * to fill its page in. */
const PLAYBACK_GRACE_MS = 2500;

/**
 * True once the player has begun rendering [videoId], or once the grace period
 * has passed.
 *
 * Gate everything that is not playback on this: related videos, channel details
 * and comments each cost a request that would otherwise be opened at the exact
 * moment the first media buffer needs the connection pool.
 */
export function usePlaybackSettled(videoId: string | undefined): boolean {
  const playbackStartedVideoId = usePlayerStore((s) => s.playbackStartedVideoId);
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    setGraceElapsed(false);
    if (!videoId) return;
    const timer = window.setTimeout(() => setGraceElapsed(true), PLAYBACK_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [videoId]);

  if (!videoId) return false;
  return playbackStartedVideoId === videoId || graceElapsed;
}
