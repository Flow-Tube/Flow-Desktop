import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getChannelDetails,
  getSubscriptionRotationFeed,
  scanSubscriptionCollaborations,
  streamSubscriptionRssFeed,
  type SubscriptionRssChannel,
  type SubscriptionRssFeed,
} from './api/youtube';
import { getSetting, setSetting } from './api/db';
import { SETTINGS } from './settings/schema';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import type { SubscribedChannel } from '../store/useSubscriptionStore';
import type { ChannelDetails, VideoSummary } from '../types/video';
import { mapWithConcurrency } from './concurrency';
import { observeChannelUploads } from './api/recommendation';
import { mergeCollaborations, mergeScopedFeed } from './subscriptionFeedMerge';

export interface ScanProgress {
  processed: number;
  total: number;
}

interface CachedFeed {
  videos: VideoSummary[];
  channels: SubscriptionRssChannel[];
  failedChannelIds: string[];
  cachedAt: number;
}

interface PersistedFeed extends CachedFeed {
  key: string;
}

const FEED_TTL_MS = 15 * 60 * 1000;
// v2: Shorts are marked by the backend (`isShort`), which v1 feeds never carry.
// v3: v2 feeds were saved before RSS links and frame checks told Shorts apart.
const FEED_CACHE_KEY = 'subscription_feed_cache_v3';
const MAX_CACHED_VIDEOS = 500;

const feedCache = new Map<string, CachedFeed>();

async function loadPersistedFeed(): Promise<PersistedFeed | null> {
  try {
    const raw = await getSetting(FEED_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedFeed;
    if (!parsed || typeof parsed.key !== 'string' || !Array.isArray(parsed.videos)) return null;
    return parsed;
  } catch (err) {
    console.warn('Failed to read subscription feed cache', err);
    return null;
  }
}

async function persistFeed(key: string, feed: Omit<CachedFeed, 'cachedAt'>, cachedAt = Date.now()): Promise<void> {
  try {
    const payload: PersistedFeed = {
      key,
      videos: feed.videos.slice(0, MAX_CACHED_VIDEOS),
      channels: feed.channels,
      failedChannelIds: feed.failedChannelIds,
      cachedAt,
    };
    await setSetting(FEED_CACHE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Failed to persist subscription feed cache', err);
  }
}

/** Upload titles a channel is read by; more than a few say nothing new about it. */
const UPLOADS_PER_CHANNEL = 6;

export function recentUploadsPerChannel(videos: VideoSummary[]): VideoSummary[] {
  const counts = new Map<string, number>();
  return videos.filter((video) => {
    const channelId = video.channelId ?? '';
    if (!channelId) return false;
    const count = counts.get(channelId) ?? 0;
    counts.set(channelId, count + 1);
    return count < UPLOADS_PER_CHANNEL;
  });
}

const feedKey = (channelIds: string[]) => [...channelIds].sort().join('|');

/** Keeps a finished scan: memory for this session, disk for the next, and the engine's reading of it. */
function rememberFinishedFeed(key: string, feed: SubscriptionRssFeed): void {
  feedCache.set(key, {
    videos: feed.videos,
    channels: feed.channels,
    failedChannelIds: feed.failedChannelIds,
    cachedAt: Date.now(),
  });
  void persistFeed(key, feed);
  void observeChannelUploads(recentUploadsPerChannel(feed.videos)).catch((err) =>
    console.warn('Failed to learn from subscription uploads', err),
  );
}

/** The startup pass, which a page opened meanwhile waits for instead of scanning twice. */
let startupRefresh: { key: string; done: Promise<void> } | null = null;

/** "Refresh subscriptions at startup": scans the feed before anyone opens the page. */
export function refreshSubscriptionsAtStartup(channelIds: string[]): Promise<void> {
  const key = feedKey(channelIds);
  const done = streamSubscriptionRssFeed(channelIds, (feed) => {
    if (feed.processed >= feed.total && feed.videos.length > 0) rememberFinishedFeed(key, feed);
  })
    .catch((err) => console.warn('Startup subscription refresh failed', err))
    .finally(() => {
      startupRefresh = null;
    });
  startupRefresh = { key, done };
  return done;
}

export function useSubscriptionFeed(channels: SubscribedChannel[]) {
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [rssChannels, setRssChannels] = useState<SubscriptionRssChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [failedChannelIds, setFailedChannelIds] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [collaborations, setCollaborations] = useState<VideoSummary[]>([]);
  const collaborationsEnabled = useAppSettingsStore(
    (state) => state.values[SETTINGS.SUBSCRIPTION_COLLABORATIONS_ENABLED] !== 'false',
  );
  const channelIds = useMemo(() => feedKey(channels.map((channel) => channel.id)), [channels]);
  const scopeRequestRef = useRef(0);

  useEffect(() => {
    let active = true;
    const ids = channelIds.split('|').filter(Boolean);

    if (ids.length === 0) {
      setVideos([]);
      setRssChannels([]);
      setFailedChannelIds([]);
      setError(null);
      setLoading(false);
      setScanProgress(null);
      setLastRefreshedAt(null);
      return;
    }

    // A refresh asks again however fresh the cached feed is.
    if (refreshNonce > 0) feedCache.delete(channelIds);
    const mem = feedCache.get(channelIds);
    if (mem) {
      setVideos(mem.videos);
      setRssChannels(mem.channels);
      setFailedChannelIds(mem.failedChannelIds);
      setLastRefreshedAt(mem.cachedAt);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    setScanProgress(null);

    const loadFeed = async () => {
      if (!mem && refreshNonce === 0 && startupRefresh?.key === channelIds) {
        await startupRefresh.done;
        if (!active) return;
        const scanned = feedCache.get(channelIds);
        if (scanned) {
          setVideos(scanned.videos);
          setRssChannels(scanned.channels);
          setFailedChannelIds(scanned.failedChannelIds);
          setLastRefreshedAt(scanned.cachedAt);
          setLoading(false);
          return;
        }
      }

      let cachedAt = mem?.cachedAt ?? null;
      let haveVideos = mem != null && mem.videos.length > 0;

      if (!mem && refreshNonce === 0) {
        const persisted = await loadPersistedFeed();
        if (!active) return;
        if (persisted && persisted.key === channelIds && persisted.videos.length > 0) {
          const failed = persisted.failedChannelIds ?? [];
          feedCache.set(channelIds, {
            videos: persisted.videos,
            channels: persisted.channels,
            failedChannelIds: failed,
            cachedAt: persisted.cachedAt,
          });
          setVideos(persisted.videos);
          setRssChannels(persisted.channels);
          setFailedChannelIds(failed);
          setLastRefreshedAt(persisted.cachedAt);
          setLoading(false);
          cachedAt = persisted.cachedAt;
          haveVideos = true;
        }
      }

      if (cachedAt != null && Date.now() - cachedAt < FEED_TTL_MS) {
        return;
      }

      let sawVideos = haveVideos;

      try {

        await streamSubscriptionRssFeed(ids, (feed) => {
          if (!active) return;
          setVideos(feed.videos);
          setRssChannels(feed.channels);
          setFailedChannelIds(feed.failedChannelIds);
          if (feed.videos.length > 0) sawVideos = true;
          setLoading(false);

          const done = feed.processed >= feed.total;
          setScanProgress(done ? null : { processed: feed.processed, total: feed.total });
          if (done && feed.videos.length > 0) {
            setLastRefreshedAt(Date.now());
            rememberFinishedFeed(channelIds, feed);
          }
        });
        if (!active) return;
        setScanProgress(null);

        // No channel yielded RSS videos — fall back to the rotation feed.
        if (!sawVideos) {
          const latest = await getSubscriptionRotationFeed();
          if (active) setVideos(latest);
        }
      } catch (err) {
        console.error('Failed to load subscription feed', err);
        if (active) setScanProgress(null);
        if (sawVideos) return;
        try {
          const latest = await getSubscriptionRotationFeed();
          if (active) {
            setVideos(latest);
            setRssChannels([]);
            setError(latest.length > 0 ? null : 'Failed to load latest subscription videos.');
          }
        } catch (fallbackErr) {
          console.error('Failed to load subscription rotation fallback', fallbackErr);
          if (active) {
            setError('Failed to load latest subscription videos.');
          }
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadFeed();

    return () => {
      active = false;
    };
  }, [channelIds, refreshNonce]);

  // A heavy look at a few channels, after the feed itself is on screen and never blocking it.
  useEffect(() => {
    const ids = channelIds.split('|').filter(Boolean);
    if (ids.length === 0 || loading || scanProgress) return;
    let active = true;
    scanSubscriptionCollaborations(ids)
      .then((found) => {
        if (active) setCollaborations(found);
      })
      .catch((err) => console.warn('Failed to look for collaborations', err));
    return () => {
      active = false;
    };
  }, [channelIds, collaborationsEnabled, refreshNonce, lastRefreshedAt, loading, scanProgress]);

  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  /** Refreshes only these channels, as an open group's Refresh does, within the feed already shown. */
  const refreshChannels = useCallback(
    async (scope: string[]) => {
      if (scope.length === 0) return;
      const request = ++scopeRequestRef.current;
      setScanProgress({ processed: 0, total: scope.length });
      const scopeSet = new Set(scope);
      try {
        await streamSubscriptionRssFeed(scope, (feed) => {
          if (request !== scopeRequestRef.current) return;
          const done = feed.processed >= feed.total;
          setScanProgress(done ? null : { processed: feed.processed, total: feed.total });
          if (!done) return;
          const refreshedAt = Date.now();
          setLastRefreshedAt(refreshedAt);
          const failed = (current: string[]) => [
            ...current.filter((id) => !scopeSet.has(id)),
            ...feed.failedChannelIds,
          ];
          setFailedChannelIds(failed);
          setVideos((current) => {
            // A channel that couldn't be read says nothing about its uploads, so they stay.
            const answered = scope.filter((id) => !feed.failedChannelIds.includes(id));
            const merged = mergeScopedFeed(current, answered, feed.videos);
            const cached = feedCache.get(channelIds);
            const next = {
              videos: merged,
              channels: cached?.channels ?? feed.channels,
              failedChannelIds: failed(cached?.failedChannelIds ?? []),
            };
            // The whole feed's age stays: only these channels were looked at.
            const cachedAt = cached?.cachedAt ?? refreshedAt;
            feedCache.set(channelIds, { ...next, cachedAt });
            void persistFeed(channelIds, next, cachedAt);
            return merged;
          });
        });
      } catch (err) {
        console.warn('Failed to refresh these channels', err);
      } finally {
        if (request === scopeRequestRef.current) setScanProgress(null);
      }
    },
    [channelIds],
  );

  const withCollaborations = useMemo(
    () => (collaborationsEnabled ? mergeCollaborations(videos, collaborations) : videos),
    [videos, collaborations, collaborationsEnabled],
  );
  return {
    videos: withCollaborations,
    rssChannels,
    loading,
    error,
    scanProgress,
    failedChannelIds,
    lastRefreshedAt,
    refresh,
    refreshChannels,
  };
}

const channelDetailsCache = new Map<string, ChannelDetails>();

function needsDetails(channel: SubscribedChannel): boolean {
  return !channel.avatarUrl || !channel.subscriberCountText;
}

export function useSubscriptionChannelDetails(channels: SubscribedChannel[]) {
  const [detailsById, setDetailsById] = useState<Record<string, ChannelDetails>>({});

  const idsToFetch = useMemo(
    () =>
      channels
        .filter((channel) => needsDetails(channel) && !channelDetailsCache.has(channel.id))
        .map((channel) => channel.id),
    [channels],
  );
  const fetchKey = useMemo(() => [...idsToFetch].sort().join('|'), [idsToFetch]);

  useEffect(() => {
    if (channelDetailsCache.size > 0) {
      setDetailsById((prev) => {
        const next = { ...prev };
        for (const [id, details] of channelDetailsCache) next[id] = details;
        return next;
      });
    }

    const ids = fetchKey.split('|').filter(Boolean);
    if (ids.length === 0) return;

    let active = true;

    const loadDetails = async () => {
      const entries = await mapWithConcurrency(ids, 6, async (channelId) => {
        try {
          const details = await getChannelDetails(channelId);
          channelDetailsCache.set(channelId, details);
          return [channelId, details] as const;
        } catch (err) {
          console.warn('Failed to load subscription channel details', channelId, err);
          return null;
        }
      });

      if (!active) return;

      setDetailsById((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    };

    loadDetails();

    return () => {
      active = false;
    };
  }, [fetchKey]);

  return detailsById;
}
