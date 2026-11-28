import { useEffect, useRef, useState } from "react";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { shortItemToSummary } from "./shortsQueue";
import { fetchFeedShorts, visibleFetchedShorts } from "./useShortsFeed";
import { loadFinishedShortIds } from "./useWatchedFilter";
import type { ShortVideoSummary } from "../types/video";

const SHELF_SIZE = 15;
const CACHE_MS = 5 * 60 * 1000;

let cached: { at: number; request: Promise<ShortVideoSummary[]> } | null = null;

/** Coming back to Home reuses the shelf for a while rather than asking for a new feed each time. */
function loadShelf(): Promise<ShortVideoSummary[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.request;
  const request = fetchFeedShorts().then((feed) => feed.items.map(shortItemToSummary));
  const entry = { at: Date.now(), request };
  cached = entry;
  request.catch(() => {
    if (cached === entry) cached = null;
  });
  return request;
}

/**
 * The Shorts on Home. It only adds to the page, so a failed load shows nothing. A new
 * `refreshCount` is Home's refresh: the shelf asks for a new feed and keeps the old one until then.
 */
export function useHomeShortsShelf(enabled: boolean, refreshCount = 0): ShortVideoSummary[] {
  const [shorts, setShorts] = useState<ShortVideoSummary[]>([]);
  // Every switch reads as on until settings load, which would fetch a shelf that was turned off.
  const settingsLoaded = useAppSettingsStore((s) => s.loaded);
  const wanted = enabled && settingsLoaded;
  const loadedForRef = useRef(refreshCount);

  useEffect(() => {
    if (!wanted) {
      setShorts([]);
      return;
    }
    if (loadedForRef.current !== refreshCount) {
      loadedForRef.current = refreshCount;
      forgetHomeShortsShelf();
    }
    let cancelled = false;
    void Promise.all([loadShelf(), loadFinishedShortIds()])
      .then(([loaded, finished]) => {
        if (!cancelled) setShorts(visibleFetchedShorts(loaded, finished).slice(0, SHELF_SIZE));
      })
      .catch((error) => console.warn("Failed to load the Home Shorts shelf", error));
    return () => {
      cancelled = true;
    };
  }, [wanted, refreshCount]);

  return shorts;
}

export const forgetHomeShortsShelf = () => {
  cached = null;
};
