import { useEffect, useState } from "react";
import { getVideoCategory } from "./api/youtube";

const requests = new Map<string, Promise<string | null>>();

/**
 * The video's category for the recommendation engine: `known` when its details carried one,
 * else one small request once `enabled` (after playback has settled). Most playback clients
 * return no category, so this is how most watches get one.
 */
export function useVideoCategory(videoId: string | undefined, known: string | null | undefined, enabled: boolean) {
  const [fetched, setFetched] = useState<{ videoId: string; category: string | null } | null>(null);

  useEffect(() => {
    if (!videoId || known || !enabled) return;
    let cancelled = false;
    let request = requests.get(videoId);
    if (!request) {
      request = getVideoCategory(videoId).catch(() => null);
      requests.set(videoId, request);
    }
    void request.then((category) => {
      if (!cancelled) setFetched({ videoId, category });
    });
    return () => {
      cancelled = true;
    };
  }, [videoId, known, enabled]);

  if (known) return known;
  return fetched && fetched.videoId === videoId ? fetched.category : null;
}
