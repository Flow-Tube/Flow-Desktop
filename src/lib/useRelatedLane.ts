import { useCallback, useEffect, useRef, useState } from "react";
import { getMoreRelatedVideos, getRelatedVideos } from "./api/youtube";
import { appendRelated } from "./relatedLane";
import { usePlayerStore } from "../store/usePlayerStore";
import type { RelatedContentItem } from "../types/video";

export interface RelatedLane {
  items: RelatedContentItem[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

/**
 * The watch page's related lane for `videoId`. It is fetched only once `fetchEnabled` (after
 * playback has started, so it never competes with the first media buffer); `shown` holds the
 * skeleton up until then. Pages beyond the first load on `loadMore`.
 */
export function useRelatedLane(videoId: string | undefined, shown: boolean, fetchEnabled: boolean, retryNonce: number): RelatedLane {
  const [items, setItems] = useState<RelatedContentItem[]>([]);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const videoRef = useRef(videoId);

  useEffect(() => {
    videoRef.current = videoId;
    const cache = usePlayerStore.getState().watchPageCache;
    const cached = cache?.videoId === videoId ? cache : null;
    setItems(cached?.relatedVideos ?? []);
    setContinuation(cached?.relatedContinuation ?? null);
    setLoadingMore(false);
    setLoading(shown && !cached?.relatedVideos?.length);
  }, [videoId, shown]);

  useEffect(() => {
    if (!videoId || !shown || !fetchEnabled) return;
    const cache = usePlayerStore.getState().watchPageCache;
    if (cache?.videoId === videoId && cache.relatedVideos.length > 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getRelatedVideos(videoId)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setContinuation(page.continuation ?? null);
        usePlayerStore.getState().setWatchPageCache(videoId, {
          relatedVideos: page.items,
          relatedContinuation: page.continuation ?? null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Failed to load related content", error);
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, shown, fetchEnabled, retryNonce]);

  const loadMore = useCallback(() => {
    if (!videoId || !continuation || loadingMore) return;
    setLoadingMore(true);
    getMoreRelatedVideos(continuation)
      .then((page) => {
        if (videoRef.current !== videoId) return;
        setItems((previous) => {
          const next = appendRelated(previous, page.items);
          usePlayerStore.getState().setWatchPageCache(videoId, {
            relatedVideos: next,
            relatedContinuation: page.continuation ?? null,
          });
          return next;
        });
        setContinuation(page.continuation ?? null);
      })
      .catch((error) => console.warn("Failed to load more related content", error))
      .finally(() => {
        if (videoRef.current === videoId) setLoadingMore(false);
      });
  }, [videoId, continuation, loadingMore]);

  return { items, loading, hasMore: Boolean(continuation), loadingMore, loadMore };
}
