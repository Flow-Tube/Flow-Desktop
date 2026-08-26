import { useEffect, useState } from "react";

import { getDeArrowOverride, type DeArrowOverride } from "./api/foss";

/**
 * DeArrow title/thumbnail override for one video.
 *
 * Each card resolved its own, straight from a `useEffect`, with no cache: a feed
 * of several hundred cards meant that many IPC round trips and SQLite reads, and
 * the whole set fired again on every remount — flipping a tab and back paid for
 * it twice. The backend keeps its own 7-day cache, so holding results for the
 * session here cannot serve anything staler than that already allows.
 */
const cache = new Map<string, DeArrowOverride | null>();
const inFlight = new Map<string, Promise<DeArrowOverride | null>>();

const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

/**
 * The cache + in-flight dedupe layer under the hook. Exported so the sharing
 * behaviour — the reason this module exists — can be tested without a renderer.
 */
export function loadDeArrowOverride(videoId: string): Promise<DeArrowOverride | null> {
  // `undefined` is a miss; `null` is a resolved "this video has no override".
  const cached = cache.get(videoId);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = inFlight.get(videoId);
  if (existing) return existing;

  const request = getDeArrowOverride(videoId)
    .then((override) => {
      cache.set(videoId, override ?? null);
      return override ?? null;
    })
    .catch((error) => {
      console.warn("Failed to load DeArrow override", videoId, error);
      // Deliberately not cached: a transient failure should not suppress the
      // override for the rest of the session.
      return null;
    })
    .finally(() => {
      inFlight.delete(videoId);
    });

  inFlight.set(videoId, request);
  return request;
}

/** Returns null when disabled, when the id is not a video, or until it resolves. */
export function useDeArrowOverride(
  videoId: string | null | undefined,
  enabled: boolean,
): DeArrowOverride | null {
  const key = enabled && videoId && YOUTUBE_VIDEO_ID.test(videoId) ? videoId : null;
  const [resolved, setResolved] = useState<DeArrowOverride | null>(null);

  useEffect(() => {
    if (!key) {
      setResolved(null);
      return;
    }
    if (cache.has(key)) {
      setResolved(cache.get(key) ?? null);
      return;
    }

    let active = true;
    void loadDeArrowOverride(key).then((override) => {
      if (active) setResolved(override);
    });

    return () => {
      active = false;
    };
  }, [key]);

  if (!key) return null;

  // Read the cache during render so a remounting card — or a second card for the
  // same video — shows the override immediately instead of flashing the original
  // title for a frame while the effect catches up.
  const cached = cache.get(key);
  return cached !== undefined ? cached : resolved;
}
