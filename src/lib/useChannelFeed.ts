import { useCallback, useEffect, useRef, useState } from 'react';
import { getChannelTab } from './api/youtube';
import { mergeChannelItems } from './channelPage';
import type { ChannelTabResponse } from '../types/video';

/** What to show: a tab by its params, a filter by its continuation or params, or a search. */
export interface ChannelFeedRequest {
  key: string;
  params?: string | null;
  continuation?: string | null;
  query?: string | null;
}

const CACHE_LIMIT = 24;
/** Tabs already visited this session, with every page loaded so far, so switching back is instant. */
const feedCache = new Map<string, ChannelTabResponse>();

function remember(key: string, response: ChannelTabResponse) {
  feedCache.delete(key);
  feedCache.set(key, response);
  if (feedCache.size > CACHE_LIMIT) {
    const oldest = feedCache.keys().next().value;
    if (oldest !== undefined) feedCache.delete(oldest);
  }
}

/**
 * One view of a channel: Home comes with the page (`initial`), everything else is browsed on
 * demand and paged by `loadMore`. A further page keeps the filters of the first.
 */
export function useChannelFeed(
  channelId: string | undefined,
  request: ChannelFeedRequest | null,
  initial: ChannelTabResponse | null,
) {
  const cacheKey = channelId && request ? `${channelId}|${request.key}` : null;
  const [feed, setFeed] = useState<ChannelTabResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const generation = ++requestRef.current;
    setLoadingMore(false);
    if (!channelId || !request || !cacheKey) {
      setFeed(initial);
      setLoading(false);
      setFailed(false);
      return;
    }
    const cached = feedCache.get(cacheKey);
    if (cached) {
      setFeed(cached);
      setLoading(false);
      setFailed(false);
      return;
    }
    setFeed(null);
    setLoading(true);
    setFailed(false);
    getChannelTab(channelId, request.params, request.continuation, request.query)
      .then((next) => {
        if (generation !== requestRef.current) return;
        remember(cacheKey, next);
        setFeed(next);
      })
      .catch((err) => {
        if (generation !== requestRef.current) return;
        console.warn('Failed to load a channel tab', err);
        setFailed(true);
      })
      .finally(() => {
        if (generation === requestRef.current) setLoading(false);
      });
    // `request` is identified by its key; a new object with the same key is the same view.
  }, [channelId, cacheKey, initial, nonce]);

  const loadMore = useCallback(() => {
    const token = feed?.nextPageToken;
    if (!channelId || !token || loadingMore || loading) return;
    const generation = requestRef.current;
    setLoadingMore(true);
    getChannelTab(channelId, null, token, null)
      .then((page) => {
        if (generation !== requestRef.current) return;
        setFeed((current) => {
          if (!current) return current;
          const next = {
            ...current,
            items: mergeChannelItems(current.items, page.items),
            nextPageToken: page.nextPageToken ?? null,
          };
          if (cacheKey) remember(cacheKey, next);
          return next;
        });
      })
      .catch((err) => console.warn('Failed to load more of a channel tab', err))
      .finally(() => {
        if (generation === requestRef.current) setLoadingMore(false);
      });
  }, [channelId, feed?.nextPageToken, loadingMore, loading, cacheKey]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);
  return { feed, loading, loadingMore, failed, loadMore, retry };
}
