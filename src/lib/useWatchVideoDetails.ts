import { useEffect, useState } from "react";
import { getVideoDetails } from "./api/youtube";
import { usePlayerStore } from "../store/usePlayerStore";
import type { VideoDetails } from "../types/video";

const pending = new Map<string, Promise<VideoDetails>>();

function requestDetails(videoId: string) {
  const existing = pending.get(videoId);
  if (existing) return existing;
  const request = getVideoDetails(videoId).finally(() => {
    if (pending.get(videoId) === request) pending.delete(videoId);
  });
  pending.set(videoId, request);
  return request;
}

export function useWatchVideoDetails(videoId: string | undefined, enabled: boolean, retryNonce: number) {
  const [result, setResult] = useState<VideoDetails | null>(null);

  useEffect(() => {
    const cache = usePlayerStore.getState().watchPageCache;
    const cached = cache && cache.videoId === videoId ? cache.videoDetails : null;
    setResult(cached ?? null);
    if (!videoId || !enabled || cached) return;
    let cancelled = false;
    void requestDetails(videoId).then((details) => {
      if (cancelled) return;
      setResult(details);
      usePlayerStore.getState().setWatchPageCache(videoId, { videoDetails: details });
    }).catch(() => {
      // Optional metadata cannot clear the queue or tear down working playback.
    });
    return () => { cancelled = true; };
  }, [videoId, enabled, retryNonce]);

  return result?.id === videoId ? result : null;
}
