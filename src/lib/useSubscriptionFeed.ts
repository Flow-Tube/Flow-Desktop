import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getChannelDetails,
  getSubscriptionRotationFeed,
  streamSubscriptionRssFeed,
  type SubscriptionRssChannel,
  type SubscriptionRssFeed,
} from './api/youtube';
import { getSetting, setSetting } from './api/db';
import type { SubscribedChannel } from '../store/useSubscriptionStore';
import type { ChannelDetails, VideoSummary } from '../types/video';
import { mapWithConcurrency } from './concurrency';
import { observeChannelUploads } from './api/recommendation';

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
const FEED_CACHE_KEY = 'subscription_feed_cache_v2';
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

async function persistFeed(key: string, feed: SubscriptionRssFeed): Promise<void> {
  try {
    const payload: PersistedFeed = {
      key,
      videos: feed.videos.slice(0, MAX_CACHED_VIDEOS),
      channels: feed.channels,
      failedChannelIds: feed.failedChannelIds,
      cachedAt: Date.now(),
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

export function useSubscriptionFeed(channels: SubscribedChannel[]) {
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [rssChannels, setRssChannels] = useState<SubscriptionRssChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [failedChannelIds, setFailedChannelIds] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const channelIds = useMemo(
    () => channels.map((channel) => channel.id).sort().join('|'),
    [channels],
  );

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
      return;
    }

    // A refresh asks again however fresh the cached feed is.
    if (refreshNonce > 0) feedCache.delete(channelIds);
    const mem = feedCache.get(channelIds);
    if (mem) {
      setVideos(mem.videos);
      setRssChannels(mem.channels);
      setFailedChannelIds(mem.failedChannelIds);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    setScanProgress(null);

    const loadFeed = async () => {
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
            feedCache.set(channelIds, {
              videos: feed.videos,
              channels: feed.channels,
              failedChannelIds: feed.failedChannelIds,
              cachedAt: Date.now(),
            });
            void persistFeed(channelIds, feed);
            void observeChannelUploads(recentUploadsPerChannel(feed.videos)).catch((err) =>
              console.warn('Failed to learn from subscription uploads', err),
            );
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

  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);
  return { videos, rssChannels, loading, error, scanProgress, failedChannelIds, refresh };
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
