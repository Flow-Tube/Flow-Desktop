import { useCallback, useEffect, useRef, useState } from "react";
import { useSubscriptionStore } from "../store/useSubscriptionStore";
import { cleanChannelId, useFeedActionsStore } from "../store/useFeedActionsStore";
import { getShortsFeed, loadMoreShorts, resetShortsFeed } from "./api/shorts";
import { SETTINGS } from "./settings/schema";
import { loadFinishedShortIds } from "./useWatchedFilter";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import type { ShortItem, ShortsFeed } from "../types/shorts";


async function currentSubIds(): Promise<string[]> {
  const store = useSubscriptionStore.getState();
  if (store.subscriptions.length === 0) {
    await store.loadSubscriptions();
  }
  return useSubscriptionStore.getState().subscriptions.map((s) => s.id);
}

const inFlightFeeds = new Map<string, Promise<ShortsFeed>>();
export function fetchFeedShorts(seedId?: string): Promise<ShortsFeed> {
  const key = seedId ?? "__home__";
  const existing = inFlightFeeds.get(key);
  if (existing) return existing;
  const request = currentSubIds()
    .then((subs) => getShortsFeed(subs, seedId))
    .finally(() => inFlightFeeds.delete(key));
  inFlightFeeds.set(key, request);
  return request;
}

function defaultSeedShort(seedId: string): ShortItem {
  return {
    id: seedId,
    title: "Short",
    channelName: "",
    channelId: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${seedId}/oar2.jpg`,
    channelAvatarUrl: null,
    viewCountText: null,
    likeCountText: null,
    commentCountText: null,
    publishedText: null,
    sequenceParams: null,
  };
}

function initialItems(seedItem: ShortItem | null, initialQueue?: ShortItem[] | null): ShortItem[] {
  const queued = initialQueue?.filter((item) => item.id) ?? [];
  if (!seedItem) return queued;
  if (queued.some((item) => item.id === seedItem.id)) return queued;
  return [seedItem, ...queued];
}

function mergeInitialItems(items: ShortItem[], initial: ShortItem[]): ShortItem[] {
  if (initial.length === 0) return items;
  const seen = new Set(initial.map((item) => item.id));
  const fresh = items.filter((item) => !seen.has(item.id));
  return [...initial, ...fresh];
}

const NOTHING_FINISHED: ReadonlySet<string> = new Set();

export function visibleFetchedShorts<T extends Pick<ShortItem, "id"> & { channelId?: string | null }>(
  items: T[],
  finished: ReadonlySet<string> = NOTHING_FINISHED,
): T[] {
  const {
    dismissedVideoIds,
    blockedChannelIds,
    suppressedChannelIds,
    watchedVideoIds,
  } = useFeedActionsStore.getState();
  const hideWatched = useAppSettingsStore.getState().values[SETTINGS.HIDE_WATCHED_SHORTS] !== "false";
  const suppressedCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

  return items.filter((short) => {
    if (dismissedVideoIds.has(short.id)) return false;
    if (hideWatched && (watchedVideoIds.has(short.id) || finished.has(short.id))) return false;
    const channelId = cleanChannelId(short.channelId);
    if (!channelId) return true;
    return (
      !blockedChannelIds.has(channelId) &&
      (suppressedChannelIds.get(channelId) ?? 0) < suppressedCutoff
    );
  });
}

/**
 * What happens when an opened queue runs out. A shelf or a channel tab continues into the feed seeded
 * from the Short that was opened, so a swipe never dead-ends. Saved Shorts is a deliberate collection,
 * and trailing recommendations onto it would misrepresent it.
 */
export type ShortsQueueEnd = "feed" | "stop";

export function useShortsFeed(
  seedId?: string,
  initialSeedItem?: ShortItem | null,
  initialQueue?: ShortItem[] | null,
  queueEnd?: ShortsQueueEnd,
) {
  const [items, setItems] = useState<ShortItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continuationRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const waitingToHandOverRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const seedFallback = initialSeedItem ?? (seedId ? defaultSeedShort(seedId) : null);
    const queuedItems = initialItems(seedFallback, initialQueue);
    setLoading(true);
    setError(null);
    seenIdsRef.current = new Set();
    queuedItems.forEach((item) => seenIdsRef.current.add(item.id));
    setItems(queuedItems);
    waitingToHandOverRef.current = false;
    if (queueEnd && queuedItems.length > 0) {
      continuationRef.current = null;
      waitingToHandOverRef.current = queueEnd === "feed";
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    Promise.all([fetchFeedShorts(seedId), loadFinishedShortIds()])
      .then(([feed, finished]) => {
        if (cancelled) return;
        const mergedItems = mergeInitialItems(visibleFetchedShorts(feed.items, finished), queuedItems);
        mergedItems.forEach((s) => seenIdsRef.current.add(s.id));
        setItems(mergedItems);
        continuationRef.current = feed.continuation;
      })
      .catch((e) => {
        console.error("[shorts] feed error:", e);
        if (!cancelled) {
          if (queuedItems.length > 0) {
            queuedItems.forEach((item) => seenIdsRef.current.add(item.id));
            setItems(queuedItems);
          }
          setError(String(e));
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [seedId, initialSeedItem, initialQueue, queueEnd]);

  const loadMore = useCallback(async () => {
    if (queueEnd === "stop") return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const [feed, finished] = await Promise.all([
        waitingToHandOverRef.current
          ? fetchFeedShorts(seedId)
          : currentSubIds().then((subs) => loadMoreShorts(subs, continuationRef.current)),
        loadFinishedShortIds(),
      ]);
      waitingToHandOverRef.current = false;
      continuationRef.current = feed.continuation;
      const fresh = visibleFetchedShorts(feed.items, finished).filter((s) => !seenIdsRef.current.has(s.id));
      if (fresh.length) {
        fresh.forEach((s) => seenIdsRef.current.add(s.id));
        setItems((prev) => [...prev, ...fresh]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      inFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [queueEnd, seedId]);

  /** Puts the opened Short's own chain right after it. Saved Shorts keeps its list as it is. */
  const moreLikeThis = useCallback(
    async (short: ShortItem) => {
      if (queueEnd === "stop") return;
      try {
        const [feed, finished] = await Promise.all([fetchFeedShorts(short.id), loadFinishedShortIds()]);
        const fresh = visibleFetchedShorts(feed.items, finished).filter((item) => !seenIdsRef.current.has(item.id));
        if (fresh.length === 0) return;
        fresh.forEach((item) => seenIdsRef.current.add(item.id));
        setItems((previous) => {
          const at = previous.findIndex((item) => item.id === short.id);
          return at < 0 ? [...previous, ...fresh] : [...previous.slice(0, at + 1), ...fresh, ...previous.slice(at + 1)];
        });
      } catch (e) {
        console.warn("[shorts] more like this failed", e);
      }
    },
    [queueEnd],
  );

  const reset = useCallback(() => {
    void resetShortsFeed();
  }, []);

  return { items, loading, loadingMore, error, loadMore, moreLikeThis, reset };
}
