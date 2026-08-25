import React, { useCallback, useRef, useState, useEffect } from "react";
import { Loader2, ChevronDown } from "lucide-react";
import {
  getChannelTab,
  getRelatedVideos,
  getSubscriptionRotationFeed,
  getSubscriptionRssFeed,
  searchVideos,
} from "../lib/api/youtube";
import {
  generateDiscoveryQueries,
  getFeedQuotas,
  recordFeedImpressions,
  rankVideos,
  logInteraction,
} from "../lib/api/recommendation";
import type { FeedQuotas } from "../lib/api/recommendation";
import { cleanChannelId, useFeedActionsStore, useFeedHiddenFilter } from "../store/useFeedActionsStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { getSetting, setSetting, getWatchHistory } from "../lib/api/db";
import { getString } from "../lib/i18n/index";
import { SETTINGS } from "../lib/settings/schema";
import type { VideoSummary } from "../types/video";
import type { WatchHistoryRecord } from "../types/db";
import { VideoGrid } from "../components/video/VideoGrid";
import { VideoShelf } from "../components/shelf/VideoShelf";
import { mapHistoryRecordToVideo } from "../lib/useHistory";
import {
  getHiddenContinueWatchingIds,
  hideContinueWatchingVideo,
} from "../lib/continueWatching";

interface HomeProps {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}

const HOME_FEED_CACHE_TTL_MS = 30 * 60 * 1000;
const SESSION_SEEN_VIDEO_LIMIT = 500;
const STARTER_SUBSCRIPTION_TIMEOUT_MS = 12000;
const STARTER_DISCOVERY_TIMEOUT_MS = 25000;
const STARTER_EMPTY_RESCUE_TIMEOUT_MS = 20000;
const FULL_DISCOVER_SOURCE_TIMEOUT_MS = 30000;
const VIRAL_FALLBACK_TIMEOUT_MS = 8000;
const DISCOVER_EMPTY_RESCUE_TIMEOUT_MS = 45000;
const LOAD_MORE_SOURCE_TIMEOUT_MS = 12000;
const LOAD_MORE_MUSIC_TIMEOUT_MS = 8000;

const STANDARD_DISCOVER_QUOTAS: FeedQuotas = {
  maturity: "mature",
  totalInteractions: 101,
  subscriptionPercent: 10 / 35,
  discoveryPercent: 15 / 35,
  viralPercent: 10 / 35,
  subscriptionLimit: 10,
  discoveryLimit: 15,
  viralLimit: 10,
};

const homeFeedCache: Record<"discover" | "trending", { videos: VideoSummary[]; timestamp: number }> = {
  discover: { videos: [], timestamp: 0 },
  trending: { videos: [], timestamp: 0 },
};

const logHomeFeed = (stage: string, details: Record<string, unknown>) => {
  console.info(`[home-feed] ${stage}`, details);
};

const buildContinueWatchingVideos = (history: WatchHistoryRecord[]): VideoSummary[] => {
  const hiddenIds = getHiddenContinueWatchingIds();
  const seenIds = new Set<string>();
  const videos: VideoSummary[] = [];

  for (const record of history) {
    if (seenIds.has(record.videoId) || hiddenIds.has(record.videoId) || record.isMusic) {
      continue;
    }

    seenIds.add(record.videoId);
    const duration = record.totalDurationSeconds ?? 0;
    if (duration <= 0 || record.watchDurationSeconds <= 0) {
      continue;
    }

    const progressPercent = Math.min(100, Math.max(0, (record.watchDurationSeconds / duration) * 100));
    if (progressPercent >= 90) {
      continue;
    }

    videos.push({
      ...mapHistoryRecordToVideo(record),
      viewCountText: `${Math.round(progressPercent)}% watched`,
    });
  }

  return videos.slice(0, 20);
};

// Persistent discover feed: survives process restart for an instant cold-start paint and an
// offline floor, unlike the in-memory `homeFeedCache`. Reconciled by the background refresh.
const PERSISTED_FEED_KEY = "home_discover_cache_v1";
const PERSISTED_FEED_TTL_MS = 24 * 60 * 60 * 1000;

const persistDiscoverFeed = async (videos: VideoSummary[]) => {
  if (videos.length === 0) return;
  try {
    const payload = JSON.stringify({ videos: videos.slice(0, 60), timestamp: Date.now() });
    await setSetting(PERSISTED_FEED_KEY, payload);
  } catch (error) {
    console.warn("Failed to persist discover feed", error);
  }
};

const loadPersistedDiscoverFeed = async (): Promise<VideoSummary[] | null> => {
  try {
    const raw = await getSetting(PERSISTED_FEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { videos?: VideoSummary[]; timestamp?: number };
    if (!parsed.videos?.length) return null;
    if (Date.now() - (parsed.timestamp ?? 0) > PERSISTED_FEED_TTL_MS) return null;
    const { dismissedVideoIds, blockedChannelIds, suppressedChannelIds, watchedVideoIds } = useFeedActionsStore.getState();
    return parsed.videos.filter(
      (video) => {
        if (!video || typeof video.id !== "string") {
          return false;
        }
        const channelId = cleanChannelId(video.channelId);
        return (
          !dismissedVideoIds.has(video.id) &&
          !watchedVideoIds.has(video.id) &&
          !(channelId && (blockedChannelIds.has(channelId) || suppressedChannelIds.has(channelId)))
        );
      },
    );
  } catch (error) {
    console.warn("Failed to load persisted discover feed", error);
    return null;
  }
};

  const summarizeVideosForLog = (items: VideoSummary[]) => (
    items.slice(0, 5).map((video) => ({
      id: video.id,
      title: video.title,
    channel: video.channelName,
  }))
);

export const Home: React.FC<HomeProps> = ({ onPlay, onAddToQueue }) => {
  const [activeTab] = useState<"discover" | "trending">("discover");
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const homeFeedEnabled = useAppSettingsStore((state) => state.values[SETTINGS.HOME_FEED_ENABLED] !== "false");
  const continueWatchingEnabled = useAppSettingsStore((state) => state.values[SETTINGS.CONTINUE_WATCHING_ENABLED] !== "false");
  const hideWatchedVideos = useAppSettingsStore((state) => state.values[SETTINGS.HIDE_WATCHED_VIDEOS] === "true");
  const isHidden = useFeedHiddenFilter({ hideWatched: hideWatchedVideos });
  const dismissedVideoIds = useFeedActionsStore((s) => s.dismissedVideoIds);
  const blockedChannelIds = useFeedActionsStore((s) => s.blockedChannelIds);
  const suppressedChannelIds = useFeedActionsStore((s) => s.suppressedChannelIds);
  const watchedVideoIds = useFeedActionsStore((s) => s.watchedVideoIds);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [continueWatchingVideos, setContinueWatchingVideos] = useState<VideoSummary[]>([]);
  const [hasMoreDiscover, setHasMoreDiscover] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const requestSequenceRef = useRef(0);
  const lastImpressionSignatureRef = useRef<string>("");
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreObserverRef = useRef<IntersectionObserver | null>(null);
  // IntersectionObserver only reports transitions, so once the sentinel is intersecting it
  // never fires again on its own — every deferred re-attempt must consult this flag.
  const sentinelIntersectingRef = useRef(false);
  const loadMoreRetryTimerRef = useRef<number | null>(null);
  const handleLoadMoreRef = useRef<((options?: { manual?: boolean }) => Promise<void>) | null>(null);
  const loadingMoreRef = useRef(false);
  const initialDiscoverHydratingRef = useRef(false);
  const videosRef = useRef<VideoSummary[]>([]);
  const loadMoreBackoffUntilRef = useRef(0);
  const loadMoreMissesRef = useRef(0);
  const discoveryQueriesRef = useRef<string[]>([]);
  const discoveryIndexRef = useRef(0);
  const subscriptionIdsRef = useRef<string[]>([]);
  const subscriptionIndexRef = useRef(0);
  const watchHistoryRef = useRef<WatchHistoryRecord[]>([]);
  const watchedIdsRef = useRef<Set<string>>(new Set());
  const sessionSeenOrderRef = useRef<string[]>([]);
  const sessionSeenIdsRef = useRef<Set<string>>(new Set());

  const capPerChannel = (items: VideoSummary[], maxPerChannel = 3) => {
    const counts = new Map<string, number>();
    return items.filter((video) => {
      const key = video.channelId ?? video.id;
      const count = counts.get(key) ?? 0;
      if (count >= maxPerChannel) return false;
      counts.set(key, count + 1);
      return true;
    });
  };

  const uniqueByVideoId = (items: VideoSummary[]) => {
    const seen = new Set<string>();
    return items.filter((video) => {
      if (seen.has(video.id)) {
        return false;
      }
      seen.add(video.id);
      return true;
    });
  };

  const updateCache = (tab: "discover" | "trending", nextVideos: VideoSummary[]) => {
    homeFeedCache[tab] = {
      videos: nextVideos,
      timestamp: Date.now(),
    };
    if (tab === "discover") {
      void persistDiscoverFeed(nextVideos);
    }
  };

  useEffect(() => {
    setVideos((currentVideos) => {
      const filteredVideos = currentVideos.filter((video) => !isHidden(video));
      if (filteredVideos.length === currentVideos.length) {
        return currentVideos;
      }
      updateCache(activeTab, filteredVideos);
      return filteredVideos;
    });
  }, [activeTab, isHidden, dismissedVideoIds, blockedChannelIds, suppressedChannelIds, watchedVideoIds]);

  const rememberSeenVideos = (items: VideoSummary[]) => {
    for (const video of items) {
      if (sessionSeenIdsRef.current.has(video.id)) {
        continue;
      }
      sessionSeenIdsRef.current.add(video.id);
      sessionSeenOrderRef.current.push(video.id);
    }

    while (sessionSeenOrderRef.current.length > SESSION_SEEN_VIDEO_LIMIT) {
      const oldestId = sessionSeenOrderRef.current.shift();
      if (oldestId) {
        sessionSeenIdsRef.current.delete(oldestId);
      }
    }
  };

  const preferSessionFreshVideos = (items: VideoSummary[], minimumCount = 0) => {
    const unseen: VideoSummary[] = [];
    const seen: VideoSummary[] = [];

    for (const video of uniqueByVideoId(items)) {
      if (sessionSeenIdsRef.current.has(video.id)) {
        seen.push(video);
      } else {
        unseen.push(video);
      }
    }

    if (minimumCount <= 0 || unseen.length >= minimumCount) {
      return unseen;
    }

    return [...unseen, ...seen.slice(0, Math.max(0, minimumCount - unseen.length))];
  };

  const isDiscoverJunkVideo = (video: VideoSummary) => {
    const text = `${video.title ?? ""} ${video.channelName ?? ""}`.toLowerCase();
    const junkPatterns = [
      "viral",
      "popular meme",
      "internet meme",
      "memes now",
      "tiktok",
      "funniest",
      "street food",
      "compilation",
      "went viral",
      "then and now",
    ];

    return junkPatterns.some((pattern) => text.includes(pattern));
  };

  const withTimeout = async <T,>(
    promise: Promise<T>,
    timeoutMs: number,
    fallback: T,
    label: string,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => {
            logHomeFeed("source-timeout", { label, timeoutMs });
            resolve(fallback);
          }, timeoutMs);
        }),
      ]);
    } catch (error: any) {
      console.warn(`${label} failed`, error?.message || error);
      return fallback;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  const getFreshCachedFeed = (tab: "discover" | "trending") => {
    const cache = homeFeedCache[tab];
    if (cache.videos.length === 0) {
      return null;
    }
    if ((Date.now() - cache.timestamp) > HOME_FEED_CACHE_TTL_MS) {
      return null;
    }

    const minimumCount = tab === "discover" ? 12 : 8;
    const cachedVideos = tab === "discover"
      ? cache.videos.filter((video) => !isDiscoverJunkVideo(video))
      : cache.videos;
    const sessionFresh = preferSessionFreshVideos(cachedVideos, minimumCount);
    return sessionFresh.length > 0 ? sessionFresh : null;
  };

  const isLikelyLive = (video: VideoSummary) => {
    const published = video.publishedText?.toLowerCase() ?? "";
    const views = video.viewCountText?.toLowerCase() ?? "";
    return published.includes("live") || views.includes("watching");
  };

  const isValidFeedVideo = (video: VideoSummary) => {
    const duration = video.durationSeconds ?? 0;
    if (isLikelyLive(video)) {
      return true;
    }
    return duration > 120;
  };

  const getMostlyWatchedIds = (history: WatchHistoryRecord[]) => {
    const watched = new Set<string>();
    for (const record of history) {
      const total = record.totalDurationSeconds ?? 0;
      const ratio = total > 0 ? record.watchDurationSeconds / total : 0;
      if (ratio >= 0.85 || (total === 0 && record.watchDurationSeconds >= 1800)) {
        watched.add(record.videoId);
      }
    }
    return watched;
  };

  const filterFeedVideos = (items: VideoSummary[], watchedIds: Set<string>) => {
    return uniqueByVideoId(items).filter((video) => {
      if (!isValidFeedVideo(video)) {
        return false;
      }
      if (isHidden(video)) {
        return false;
      }
      return !hideWatchedVideos || !watchedIds.has(video.id);
    });
  };

  const filterDiscoveryLane = (items: VideoSummary[]) => {
    return items.filter((video) => {
      const published = video.publishedText?.toLowerCase() ?? "";
      const years = Number.parseInt(published.replace(/\D+/g, ""), 10);
      const isOld = published.includes("year") && Number.isFinite(years) && years > 4;
      const viewCountText = video.viewCountText?.toLowerCase() ?? "";
      const isClassic = viewCountText.includes("m") || viewCountText.includes("million");
      return !isOld || isClassic;
    });
  };

  const appendUniqueVideos = (currentVideos: VideoSummary[], newVideos: VideoSummary[]) => {
    const currentIds = new Set(currentVideos.map((video) => video.id));
    const recentChannels = new Set(
      currentVideos.slice(-8).map((video) => video.channelId ?? video.id),
    );

    const freshCandidates = preferSessionFreshVideos(newVideos);
    const fallbackCandidates = uniqueByVideoId(newVideos);

    const preferred = freshCandidates.filter((video) => {
      if (currentIds.has(video.id)) {
        return false;
      }
      const channelKey = video.channelId ?? video.id;
      return !recentChannels.has(channelKey);
    });

    const fallback = fallbackCandidates.filter((video) => !currentIds.has(video.id));
    const batch = preferred.length > 0 ? preferred : fallback;
    // Cap only the incoming batch: re-capping the accumulated feed silently dropped every
    // future video from any channel that had ever reached the cap, shrinking appends to zero.
    return [...currentVideos, ...capPerChannel(batch, 3)];
  };

  const mixRankedLanes = (
    discoveryLane: VideoSummary[],
    subscriptionLane: VideoSummary[],
    viralLane: VideoSummary[],
    quotas: FeedQuotas = STANDARD_DISCOVER_QUOTAS,
    relatedLane: VideoSummary[] = [],
  ) => {
    const finalMix: VideoSummary[] = [];
    const usedVideos = new Set<string>();
    const recentChannels = new Set<string>();
    const recentChannelWindow: string[] = [];
    type LaneName = "subscriptions" | "discovery" | "related" | "viral";
    const relatedTarget = relatedLane.length > 0 ? Math.round(quotas.discoveryLimit * 0.4) : 0;
    const discoveryTarget = Math.max(0, quotas.discoveryLimit - relatedTarget);
    const queues = {
      discovery: [...discoveryLane],
      subscriptions: [...subscriptionLane],
      related: [...relatedLane],
      viral: [...viralLane],
    };
    const targets: Record<LaneName, number> = {
      subscriptions: quotas.subscriptionLimit,
      discovery: discoveryTarget,
      related: relatedTarget,
      viral: quotas.viralLimit,
    };
    const counts: Record<LaneName, number> = {
      subscriptions: 0,
      discovery: 0,
      related: 0,
      viral: 0,
    };
    const targetTotal = Math.max(
      1,
      quotas.subscriptionLimit + quotas.discoveryLimit + quotas.viralLimit,
    );

    const pushUnique = (candidate?: VideoSummary, relaxChannel = false) => {
      if (!candidate || usedVideos.has(candidate.id)) {
        return false;
      }
      const channelKey = candidate.channelId ?? candidate.id;
      if (!relaxChannel && recentChannels.has(channelKey) && finalMix.length > 0) {
        return false;
      }
      finalMix.push(candidate);
      usedVideos.add(candidate.id);
      recentChannels.add(channelKey);
      recentChannelWindow.push(channelKey);
      if (recentChannelWindow.length > 6) {
        const evicted = recentChannelWindow.shift();
        // relaxChannel pushes can duplicate a key inside the window — only forget the
        // channel once its last occurrence leaves.
        if (evicted && !recentChannelWindow.includes(evicted)) {
          recentChannels.delete(evicted);
        }
      }
      return true;
    };

    const pushFromLane = (lane: LaneName) => {
      const queue = queues[lane];
      const attempts = queue.length;
      const deferred: VideoSummary[] = [];

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const candidate = queue.shift();
        if (!candidate) {
          break;
        }
        if (pushUnique(candidate)) {
          queue.push(...deferred);
          return true;
        }
        if (!usedVideos.has(candidate.id)) {
          deferred.push(candidate);
        }
      }

      for (const candidate of deferred) {
        if (pushUnique(candidate, true)) {
          queue.push(...deferred.filter((item) => item.id !== candidate.id));
          return true;
        }
      }

      queue.push(...deferred);
      return false;
    };

    while (finalMix.length < targetTotal) {
      const underTarget = (["subscriptions", "discovery", "related", "viral"] as LaneName[])
        .filter((lane) => queues[lane].length > 0)
        .filter((lane) => targets[lane] > 0 && counts[lane] < targets[lane]);
      const backfill = (["subscriptions", "discovery", "related"] as LaneName[])
        .filter((lane) => queues[lane].length > 0);
      const candidates = underTarget.length > 0 ? underTarget : backfill;

      if (candidates.length === 0) {
        break;
      }

      candidates.sort((a, b) => {
        const ratioA = counts[a] / Math.max(targets[a], 1);
        const ratioB = counts[b] / Math.max(targets[b], 1);
        if (ratioA !== ratioB) {
          return ratioA - ratioB;
        }
        const priority: Record<LaneName, number> = {
          subscriptions: 0,
          discovery: 1,
          related: 2,
          viral: 3,
        };
        return priority[a] - priority[b];
      });

      const lane = candidates[0];
      if (!lane) {
        break;
      }
      const pushed = pushFromLane(lane);
      if (pushed) {
        counts[lane] += 1;
      } else {
        queues[lane] = [];
      }
    }

    return finalMix.length > 0
      ? finalMix
      : interleaveByChannel([discoveryLane, subscriptionLane, relatedLane, viralLane]);
  };

  const interleaveByChannel = (lanes: VideoSummary[][]) => {
    const queues = lanes.map((lane) => [...lane]);
    const result: VideoSummary[] = [];
    const seenVideos = new Set<string>();
    const recentChannels: string[] = [];

    while (queues.some((queue) => queue.length > 0)) {
      let progressed = false;

      for (const queue of queues) {
        while (queue.length > 0) {
          const next = queue.shift()!;
          const channelKey = next.channelId ?? next.id;
          if (seenVideos.has(next.id)) {
            continue;
          }
          if (recentChannels.slice(-2).includes(channelKey) && queue.length > 0) {
            queue.push(next);
            break;
          }
          seenVideos.add(next.id);
          recentChannels.push(channelKey);
          if (recentChannels.length > 8) {
            recentChannels.shift();
          }
          result.push(next);
          progressed = true;
          break;
        }
      }

      if (!progressed) {
        for (const queue of queues) {
          const next = queue.shift();
          if (!next || seenVideos.has(next.id)) {
            continue;
          }
          seenVideos.add(next.id);
          result.push(next);
        }
      }
    }

    return result;
  };

  const loadSubscriptions = async (): Promise<string[]> => {
    try {
      const subsJson = await getSetting("subscriptions");
      const subObjects = subsJson ? JSON.parse(subsJson) : [];
      if (!Array.isArray(subObjects)) {
        return [];
      }
      return subObjects
        .map((entry: unknown) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry && typeof entry === "object" && "id" in entry) {
            return typeof (entry as { id?: unknown }).id === "string"
              ? (entry as { id: string }).id
              : "";
          }
          return "";
        })
        .filter((value): value is string => value.length > 0);
    } catch (dbErr: any) {
      console.warn("Subscriptions db fetch failed. Error:", dbErr?.message || dbErr);
      return [];
    }
  };

  const fetchDiscoveryPool = async (
    queryCandidates: string[],
    stage = "discovery-pool",
    queryLimit = 6,
  ) => {
    const queries = queryCandidates.slice(0, queryLimit);
    if (queries.length === 0) {
      logHomeFeed(stage, {
        queries,
        breakdown: [],
        uniqueCount: 0,
        sample: [],
      });
      return [];
    }

    const settled = await Promise.allSettled(
      queries.map((query) => searchVideos({ query })),
    );

    const queryBreakdown = queries.map((query, index) => {
      const result = settled[index];
      if (result?.status !== "fulfilled") {
        return { query, status: "rejected", count: 0 };
      }
      return { query, status: "fulfilled", count: result.value.items.length };
    });

    const pool = uniqueByVideoId(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value.items : [],
      ),
    );

    logHomeFeed(stage, {
      queries,
      breakdown: queryBreakdown,
      uniqueCount: pool.length,
      sample: summarizeVideosForLog(pool),
    });

    return pool;
  };

  const fetchWatchHistoryRelatedPool = async (history: WatchHistoryRecord[], seedLimit = 4) => {
    const eligible = history.filter((record) => {
      if (record.isMusic) return false;
      const total = record.totalDurationSeconds ?? 0;
      const ratio = total > 0 ? record.watchDurationSeconds / total : 0;
      return ratio >= 0.35 || record.watchDurationSeconds >= 180;
    });

    const seedVideoIds: string[] = [];
    const usedChannels = new Set<string>();
    const seenIds = new Set<string>();
    for (const record of eligible) {
      if (seedVideoIds.length >= seedLimit) break;
      const channelKey = record.channelName || record.videoId;
      if (usedChannels.has(channelKey) || seenIds.has(record.videoId)) continue;
      usedChannels.add(channelKey);
      seenIds.add(record.videoId);
      seedVideoIds.push(record.videoId);
    }
    for (const record of eligible) {
      if (seedVideoIds.length >= seedLimit) break;
      if (seenIds.has(record.videoId)) continue;
      seenIds.add(record.videoId);
      seedVideoIds.push(record.videoId);
    }

    if (seedVideoIds.length === 0) {
      return [];
    }

    const settled = await Promise.allSettled(
      seedVideoIds.map((videoId) => getRelatedVideos(videoId)),
    );

    return uniqueByVideoId(
      settled.flatMap((result) => {
        if (result.status !== "fulfilled") {
          return [];
        }

        return result.value
          .filter((item) => item.itemType === "video" && !item.isMix)
          .map((item) => ({
            id: item.videoId ?? item.id,
            title: item.title,
            channelName: item.channelName,
            channelId: item.channelId ?? null,
            thumbnailUrl: item.thumbnailUrl ?? null,
            durationSeconds: item.durationSeconds ?? null,
            publishedText: item.publishedText ?? null,
            viewCountText: item.viewCountText ?? null,
          } satisfies VideoSummary));
      }),
    );
  };

  const getChannelVideosHelper = async (channelId: string) => {
    const res = await getChannelTab(channelId);
    return {
      channelId: res.channelId,
      videos: res.items.filter(i => i.type === 'video') as VideoSummary[],
      nextPageToken: res.nextPageToken
    };
  };

  const fetchSubscriptionPool = async (subscriptionIds: string[], channelLimit = 6) => {
    if (subscriptionIds.length === 0) {
      return [];
    }

    const settled = await Promise.allSettled(
      subscriptionIds.slice(0, channelLimit).map((channelId) => getChannelVideosHelper(channelId)),
    );

    return uniqueByVideoId(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value.videos : [],
      ),
    );
  };

  const fetchSubscriptionBatchPool = async (channelIds: string[]) => {
    if (channelIds.length === 0) {
      return [];
    }

    const settled = await Promise.allSettled(
      channelIds.map((channelId) => getChannelVideosHelper(channelId)),
    );

    return uniqueByVideoId(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value.videos : [],
      ),
    );
  };

  const fetchFreshSubscriptionUploads = async (subscriptionIds: string[], limit = 8) => {
    if (subscriptionIds.length === 0) {
      return [];
    }
    try {
      const feed = await getSubscriptionRssFeed(subscriptionIds);
      return uniqueByVideoId(feed.videos).slice(0, limit);
    } catch (error) {
      console.warn("Failed to load fresh subscription uploads", error);
      return [];
    }
  };

  const composeWithFreshSubs = (
    fresh: VideoSummary[],
    feed: VideoSummary[],
    maxFresh = 6,
  ) => {
    const watched = watchedIdsRef.current;
    const freshValid = uniqueByVideoId(fresh)
      .filter((video) => {
        if (watched.has(video.id) || isHidden(video)) return false;
        const duration = video.durationSeconds;
        return duration == null || duration > 60;
      })
      .slice(0, maxFresh);
    const freshIds = new Set(freshValid.map((video) => video.id));
    return [...freshValid, ...feed.filter((video) => !freshIds.has(video.id))];
  };

  const fetchSubscriptionRotationPool = async () => {
    try {
      return uniqueByVideoId(await getSubscriptionRotationFeed());
    } catch (error) {
      console.warn("Failed to load subscription rotation feed", error);
      return [];
    }
  };

  const fetchPersonalizedMusicPool = async (): Promise<VideoSummary[]> => {
    return [];
  };

  const getRotatedSubscriptionBatch = (subscriptionIds: string[], batchSize: number) => {
    if (subscriptionIds.length === 0 || batchSize <= 0) {
      return [];
    }

    const result: string[] = [];
    const start = subscriptionIndexRef.current % subscriptionIds.length;
    const limit = Math.min(batchSize, subscriptionIds.length);
    for (let offset = 0; offset < limit; offset += 1) {
      const channelId = subscriptionIds[(start + offset) % subscriptionIds.length];
      if (channelId) {
        result.push(channelId);
      }
    }

    subscriptionIndexRef.current = (start + limit) % subscriptionIds.length;
    return result;
  };

  const fetchTrendingPool = async () => {
    return [];
  };

  const clearLoadMoreRetryTimer = () => {
    if (loadMoreRetryTimerRef.current !== null) {
      window.clearTimeout(loadMoreRetryTimerRef.current);
      loadMoreRetryTimerRef.current = null;
    }
  };

  // The observer never re-fires for an already-intersecting sentinel, so every path that
  // declines a trigger while it may still be intersecting schedules exactly one deferred
  // re-attempt (single timer — no stacking).
  const scheduleLoadMoreRetry = (delayMs: number) => {
    if (loadMoreRetryTimerRef.current !== null) {
      return;
    }
    loadMoreRetryTimerRef.current = window.setTimeout(() => {
      loadMoreRetryTimerRef.current = null;
      if (sentinelIntersectingRef.current) {
        void handleLoadMoreRef.current?.();
      }
    }, delayMs);
  };

  const handleLoadMore = async (options?: { manual?: boolean }) => {
    if (
      activeTab !== "discover" ||
      loadingMoreRef.current ||
      initialDiscoverHydratingRef.current ||
      !homeFeedEnabled ||
      loadingMore ||
      loading ||
      !hasMoreDiscover
    ) {
      if (activeTab === "discover" && homeFeedEnabled && hasMoreDiscover) {
        scheduleLoadMoreRetry(400);
      }
      return;
    }
    if (options?.manual) {
      // An explicit click is unambiguous user intent — it overrides the auto-load backoff.
      loadMoreBackoffUntilRef.current = 0;
      loadMoreMissesRef.current = 0;
      clearLoadMoreRetryTimer();
    } else if (Date.now() < loadMoreBackoffUntilRef.current) {
      scheduleLoadMoreRetry(loadMoreBackoffUntilRef.current - Date.now() + 50);
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      let queryPool = discoveryQueriesRef.current;
      if (queryPool.length === 0 || discoveryIndexRef.current >= queryPool.length) {
        queryPool = await withTimeout(
          generateDiscoveryQueries(),
          5000,
          [] as string[],
          "load-more-query-refresh",
        );
        discoveryQueriesRef.current = queryPool;
        discoveryIndexRef.current = 0;
        logHomeFeed("load-more-refresh-discovery-queries", {
          queryPool,
          queryCount: queryPool.length,
        });
      }

      // Two queries per page (not three): the pool refreshes less often, so the backend's
      // rotation memory saturates far slower while result volume stays ample.
      const queryA = queryPool[discoveryIndexRef.current];
      const queryB = queryPool[discoveryIndexRef.current + 1];
      discoveryIndexRef.current += 2;

      const searchQueries = [queryA, queryB].filter(
        (query): query is string => typeof query === "string" && query.length > 0,
      );
      const finalQueries = searchQueries;
      const subscriptionBatchIds = getRotatedSubscriptionBatch(subscriptionIdsRef.current, 3);
      logHomeFeed("load-more-inputs", {
        queryPoolSize: queryPool.length,
        discoveryIndex: discoveryIndexRef.current,
        finalQueries,
        subscriptionBatchIds,
      });

      const [rawDiscoveryVideos, rawSubscriptionVideos, subscriptionRotationVideos, personalizedMusicVideos, relatedVideos] = await Promise.all([
        withTimeout(
          fetchDiscoveryPool(finalQueries, "load-more-discovery-pool", 2),
          LOAD_MORE_SOURCE_TIMEOUT_MS,
          [] as VideoSummary[],
          "load-more-discovery",
        ),
        withTimeout(
          fetchSubscriptionBatchPool(subscriptionBatchIds),
          LOAD_MORE_SOURCE_TIMEOUT_MS,
          [] as VideoSummary[],
          "load-more-subscription-batch",
        ),
        withTimeout(
          fetchSubscriptionRotationPool(),
          LOAD_MORE_SOURCE_TIMEOUT_MS,
          [] as VideoSummary[],
          "load-more-subscription-rotation",
        ),
        withTimeout(
          fetchPersonalizedMusicPool(),
          LOAD_MORE_MUSIC_TIMEOUT_MS,
          [] as VideoSummary[],
          "load-more-personalized-music",
        ),
        withTimeout(
          fetchWatchHistoryRelatedPool(watchHistoryRef.current, 2),
          LOAD_MORE_SOURCE_TIMEOUT_MS,
          [] as VideoSummary[],
          "load-more-related",
        ),
      ]);

      // Minimum 12: on late pages nearly everything is session-seen, and a strict
      // unseen-only filter collapsed the pools to zero and armed the backoff forever.
      const filteredDiscovery = filterDiscoveryLane(
        preferSessionFreshVideos(
          filterFeedVideos([...personalizedMusicVideos, ...relatedVideos, ...rawDiscoveryVideos], watchedIdsRef.current),
          12,
        ),
      );
      const filteredSubscriptions = preferSessionFreshVideos(
        filterFeedVideos([...subscriptionRotationVideos, ...rawSubscriptionVideos], watchedIdsRef.current),
        12,
      );

      logHomeFeed("load-more-pools", {
        finalQueries,
        rawDiscoveryCount: rawDiscoveryVideos.length,
        rawSubscriptionCount: rawSubscriptionVideos.length,
        subscriptionRotationCount: subscriptionRotationVideos.length,
        personalizedMusicCount: personalizedMusicVideos.length,
        relatedCount: relatedVideos.length,
        filteredDiscoveryCount: filteredDiscovery.length,
        filteredSubscriptionCount: filteredSubscriptions.length,
        filteredDiscoverySample: summarizeVideosForLog(filteredDiscovery),
      });

      if (filteredDiscovery.length === 0 && filteredSubscriptions.length === 0) {
        loadMoreMissesRef.current += 1;
        loadMoreBackoffUntilRef.current = Date.now() + Math.min(8000, 1500 * loadMoreMissesRef.current);
        logHomeFeed("load-more-empty", {
          finalQueries,
          subscriptionBatchIds,
          misses: loadMoreMissesRef.current,
        });
        return;
      }

      const [rankedSubscriptions, rankedDiscovery] = await Promise.all([
        filteredSubscriptions.length > 0
          ? withTimeout(
              rankVideos(filteredSubscriptions, subscriptionIdsRef.current),
              5000,
              filteredSubscriptions,
              "load-more-rank-subscriptions",
            ).then((items) => items.slice(0, 8))
          : Promise.resolve([]),
        filteredDiscovery.length > 0
          ? withTimeout(
              rankVideos(filteredDiscovery, subscriptionIdsRef.current),
              5000,
              filteredDiscovery,
              "load-more-rank-discovery",
            ).then((items) => items.slice(0, 12))
          : Promise.resolve([]),
      ]);

      const dedupedBatch = mixRankedLanes(rankedDiscovery, rankedSubscriptions, []);
      logHomeFeed("load-more-ranked", {
        rankedDiscoveryCount: rankedDiscovery.length,
        rankedSubscriptionCount: rankedSubscriptions.length,
        appendedCandidateCount: dedupedBatch.length,
        sample: summarizeVideosForLog(dedupedBatch),
      });

      // Computed outside the setVideos updater: reading a captured variable back out of an
      // updater only works on React's eager-state fast path (any queued update yields []
      // and falsely arms the backoff), and side effects inside it double-fire in StrictMode.
      const currentVideos = videosRef.current;
      const nextVideos = appendUniqueVideos(currentVideos, dedupedBatch);
      const appendedVideos = nextVideos.slice(currentVideos.length);

      if (appendedVideos.length > 0) {
        videosRef.current = nextVideos;
        setVideos(nextVideos);
        updateCache("discover", nextVideos);
        loadMoreMissesRef.current = 0;
        loadMoreBackoffUntilRef.current = 0;
        setHasMoreDiscover(true);
        rememberSeenVideos(appendedVideos);
        logHomeFeed("load-more-appended", {
          appendedCount: appendedVideos.length,
          sample: summarizeVideosForLog(appendedVideos),
        });
        void recordFeedImpressions(appendedVideos.slice(0, 12)).catch((error) => {
          console.warn("Failed to record appended feed impressions", error);
        });
      } else {
        loadMoreMissesRef.current += 1;
        loadMoreBackoffUntilRef.current = Date.now() + Math.min(8000, 1500 * loadMoreMissesRef.current);
        if (discoveryIndexRef.current >= discoveryQueriesRef.current.length) {
          discoveryQueriesRef.current = [];
          discoveryIndexRef.current = 0;
        }
        logHomeFeed("load-more-no-append", {
          dedupedBatchCount: dedupedBatch.length,
          misses: loadMoreMissesRef.current,
        });
      }
    } catch (error) {
      console.warn("Failed to load more videos", error);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      // If the appended rows didn't push the sentinel out of the viewport, the observer
      // stays silent — re-check after layout settles (backoff, if armed, gates the retry).
      scheduleLoadMoreRetry(250);
    }
  };

  const buildDiscoverFeedFromPools = async (
    pools: {
      subscriptionPool: VideoSummary[];
      subscriptionRotationPool: VideoSummary[];
      discoveryPool: VideoSummary[];
      relatedPool: VideoSummary[];
      personalizedMusicPool: VideoSummary[];
      viralPool: VideoSummary[];
    },
    watchedIds: Set<string>,
    subscriptionIds: string[],
    feedQuotas: FeedQuotas,
    rankTimeoutMs?: number,
    rankLabelPrefix = "discover",
  ) => {
    const filteredSubscriptions = preferSessionFreshVideos(
      filterFeedVideos([...pools.subscriptionRotationPool, ...pools.subscriptionPool], watchedIds),
    );
    const filteredDiscovery = filterDiscoveryLane(
      preferSessionFreshVideos(
        filterFeedVideos([...pools.personalizedMusicPool, ...pools.discoveryPool], watchedIds),
      ),
    );
    // Related (co-view graph) is its own first-class lane, not merged into discovery search.
    const filteredRelated = filterDiscoveryLane(
      preferSessionFreshVideos(filterFeedVideos(pools.relatedPool, watchedIds)),
    );

    const rankLane = async (
      lane: VideoSummary[],
      limit: number,
      label: string,
    ) => {
      if (lane.length === 0 || limit <= 0) {
        return [];
      }

      const fallback = lane.slice(0, limit);
      const ranked = rankVideos(lane, subscriptionIds).then((items) => items.slice(0, limit));
      return rankTimeoutMs
        ? withTimeout(ranked, rankTimeoutMs, fallback, `${rankLabelPrefix}-rank-${label}`)
        : ranked;
    };

    let rankedLanes: [VideoSummary[], VideoSummary[], VideoSummary[]];
    let rankedRelated: VideoSummary[] = [];
    try {
      const [bestSubscriptions, bestDiscovery, bestRelated, bestViral] = await Promise.all([
        rankLane(filteredSubscriptions, feedQuotas.subscriptionLimit, "subscriptions"),
        rankLane(filteredDiscovery, feedQuotas.discoveryLimit, "discovery"),
        rankLane(filteredRelated, feedQuotas.discoveryLimit, "related"),
        rankLane(pools.viralPool, feedQuotas.viralLimit, "viral"),
      ]);
      rankedLanes = [bestSubscriptions, bestDiscovery, bestViral];
      rankedRelated = bestRelated;
    } catch (rankErr: any) {
      console.warn("Ranking engine failed, displaying baseline feed. Error:", rankErr?.message || rankErr);
      rankedLanes = [
        filteredSubscriptions.slice(0, feedQuotas.subscriptionLimit),
        filteredDiscovery.slice(0, feedQuotas.discoveryLimit),
        pools.viralPool.slice(0, feedQuotas.viralLimit),
      ];
      rankedRelated = filteredRelated.slice(0, feedQuotas.discoveryLimit);
    }

    return {
      filteredSubscriptions,
      filteredDiscovery,
      rankedLanes,
      mixedFeed: mixRankedLanes(rankedLanes[1], rankedLanes[0], rankedLanes[2], feedQuotas, rankedRelated),
    };
  };

  const buildStarterDiscoverFeed = async (
    starterRotationPool: VideoSummary[],
    starterDiscoveryPool: VideoSummary[],
    watchedIds: Set<string>,
    subscriptionIds: string[],
    feedQuotas: FeedQuotas,
    rankLabelPrefix = "starter",
  ) => {
    const starterSubscriptions = preferSessionFreshVideos(
      filterFeedVideos(starterRotationPool, watchedIds),
    );
    const starterDiscovery = filterDiscoveryLane(
      preferSessionFreshVideos(
        filterFeedVideos(starterDiscoveryPool, watchedIds)
          .filter((video) => !isDiscoverJunkVideo(video)),
      ),
    );

    const starterQuotas: FeedQuotas = {
      ...feedQuotas,
      subscriptionLimit: Math.min(feedQuotas.subscriptionLimit, 8),
      discoveryLimit: Math.min(feedQuotas.discoveryLimit, 12),
      viralLimit: 0,
      viralPercent: 0,
    };

    const [rankedStarterSubscriptions, rankedStarterDiscovery] = await Promise.all([
      starterSubscriptions.length > 0
        ? withTimeout(
            rankVideos(starterSubscriptions, subscriptionIds),
            1800,
            starterSubscriptions,
            `${rankLabelPrefix}-rank-subscriptions`,
          ).then((items) => items.slice(0, starterQuotas.subscriptionLimit))
        : Promise.resolve([]),
      starterDiscovery.length > 0
        ? withTimeout(
            rankVideos(starterDiscovery, subscriptionIds),
            1800,
            starterDiscovery,
            `${rankLabelPrefix}-rank-discovery`,
          ).then((items) => items.slice(0, starterQuotas.discoveryLimit))
        : Promise.resolve([]),
    ]);

    return {
      starterSubscriptions,
      starterDiscovery,
      rankedStarterSubscriptions,
      rankedStarterDiscovery,
      starterFeed: mixRankedLanes(
        rankedStarterDiscovery,
        rankedStarterSubscriptions,
        [],
        starterQuotas,
      ),
    };
  };

  const fetchFeed = async (isRefresh = false) => {
    if (!homeFeedEnabled) {
      requestSequenceRef.current += 1;
      setVideos([]);
      videosRef.current = [];
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }

    const requestId = ++requestSequenceRef.current;
    let renderedInitialFeed = false;
    initialDiscoverHydratingRef.current = activeTab === "discover";
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    if (!isRefresh) {
      const cached = getFreshCachedFeed(activeTab);
      if (cached) {
        setVideos(cached);
        videosRef.current = cached;
        rememberSeenVideos(cached);
        renderedInitialFeed = true;
        setLoading(false);
      }
    }

    // Cold start (in-memory cache empty): paint the last persisted feed instantly while the
    // network refresh runs in the background and reconciles it.
    if (!isRefresh && !renderedInitialFeed && activeTab === "discover") {
      const persisted = await loadPersistedDiscoverFeed();
      if (persisted && persisted.length > 0 && requestSequenceRef.current === requestId) {
        setVideos(persisted);
        videosRef.current = persisted;
        rememberSeenVideos(persisted);
        renderedInitialFeed = true;
        setLoading(false);
      }
    }

    try {
      const [subscriptionIds, watchedHistory, queryCandidates, feedQuotas] = await Promise.all([
        loadSubscriptions(),
        getWatchHistory(200, 0),
        generateDiscoveryQueries(),
        getFeedQuotas(),
      ]);
      const watchedIds = getMostlyWatchedIds(watchedHistory);
      subscriptionIdsRef.current = subscriptionIds;
      subscriptionIndexRef.current = subscriptionIds.length === 0 ? 0 : Math.min(subscriptionIds.length, 6) % subscriptionIds.length;
      watchHistoryRef.current = watchedHistory;
      setContinueWatchingVideos(buildContinueWatchingVideos(watchedHistory));
      watchedIdsRef.current = watchedIds;
      discoveryQueriesRef.current = queryCandidates;
      // The initial discover pool consumes queries 0-3 (queryLimit 4) — load-more starts
      // after them so page one doesn't re-run a query whose results are all session-seen.
      discoveryIndexRef.current = 4;
      loadMoreMissesRef.current = 0;
      loadMoreBackoffUntilRef.current = 0;
      setHasMoreDiscover(true);
      logHomeFeed("initial-inputs", {
        activeTab,
        requestId,
        isRefresh,
        subscriptions: subscriptionIds.length,
        watchHistory: watchedHistory.length,
        watchedIds: watchedIds.size,
        queryCandidates,
        feedQuotas,
      });
      if (requestSequenceRef.current !== requestId) {
        return;
      }
      if (activeTab === "trending") {
        initialDiscoverHydratingRef.current = false;
        const trendingList = preferSessionFreshVideos(
          filterFeedVideos(await fetchTrendingPool(), watchedIds),
          12,
        );
        if (requestSequenceRef.current !== requestId) {
          return;
        }
        logHomeFeed("trending-feed", {
          trendingCount: trendingList.length,
          finalCount: trendingList.length,
          sample: summarizeVideosForLog(trendingList),
        });
        setVideos(trendingList);
        videosRef.current = trendingList;
        rememberSeenVideos(trendingList);
        updateCache("trending", trendingList);
      } else {
        const starterRotationPoolPromise = fetchSubscriptionRotationPool();
        const starterDiscoveryPoolPromise = fetchDiscoveryPool(queryCandidates, "discovery-starter-pool", 2);
        const [starterRotationPool, starterDiscoveryPool] = await Promise.all([
          withTimeout(
            starterRotationPoolPromise,
            STARTER_SUBSCRIPTION_TIMEOUT_MS,
            [] as VideoSummary[],
            "starter-subscription-rotation",
          ),
          withTimeout(
            starterDiscoveryPoolPromise,
            STARTER_DISCOVERY_TIMEOUT_MS,
            [] as VideoSummary[],
            "starter-discovery",
          ),
        ]);

        const starterResult = await buildStarterDiscoverFeed(
          starterRotationPool,
          starterDiscoveryPool,
          watchedIds,
          subscriptionIds,
          feedQuotas,
        );

        if (starterResult.starterFeed.length > 0) {
          if (requestSequenceRef.current !== requestId) {
            return;
          }
          logHomeFeed("discover-starter-feed", {
            starterSubscriptions: starterResult.rankedStarterSubscriptions.length,
            starterDiscovery: starterResult.rankedStarterDiscovery.length,
            starterFeedCount: starterResult.starterFeed.length,
            sample: summarizeVideosForLog(starterResult.starterFeed),
          });
          setVideos(starterResult.starterFeed);
          videosRef.current = starterResult.starterFeed;
          rememberSeenVideos(starterResult.starterFeed);
          renderedInitialFeed = true;
          setLoading(false);
        } else if (requestSequenceRef.current === requestId) {
          logHomeFeed("discover-starter-empty", {
            starterSubscriptions: starterResult.starterSubscriptions.length,
            starterDiscovery: starterResult.starterDiscovery.length,
          });

          if (!renderedInitialFeed && videosRef.current.length === 0) {
            const [lateStarterRotationPool, lateStarterDiscoveryPool] = await Promise.all([
              withTimeout(
                starterRotationPoolPromise,
                STARTER_EMPTY_RESCUE_TIMEOUT_MS,
                [] as VideoSummary[],
                "starter-subscription-rotation-rescue",
              ),
              withTimeout(
                starterDiscoveryPoolPromise,
                STARTER_EMPTY_RESCUE_TIMEOUT_MS,
                [] as VideoSummary[],
                "starter-discovery-rescue",
              ),
            ]);
            const lateStarterResult = await buildStarterDiscoverFeed(
              lateStarterRotationPool,
              lateStarterDiscoveryPool,
              watchedIds,
              subscriptionIds,
              feedQuotas,
              "starter-rescue",
            );

            logHomeFeed("discover-starter-rescue", {
              starterSubscriptions: lateStarterResult.rankedStarterSubscriptions.length,
              starterDiscovery: lateStarterResult.rankedStarterDiscovery.length,
              starterFeedCount: lateStarterResult.starterFeed.length,
              sample: summarizeVideosForLog(lateStarterResult.starterFeed),
            });

            if (requestSequenceRef.current !== requestId) {
              return;
            }
            if (lateStarterResult.starterFeed.length > 0) {
              setVideos(lateStarterResult.starterFeed);
              videosRef.current = lateStarterResult.starterFeed;
              rememberSeenVideos(lateStarterResult.starterFeed);
              renderedInitialFeed = true;
              setLoading(false);
            }
          }
        }

        const subscriptionPoolPromise = fetchSubscriptionPool(subscriptionIds, 3);
        const subscriptionRotationPoolPromise = fetchSubscriptionRotationPool();
        const discoveryPoolPromise = fetchDiscoveryPool(queryCandidates, "discovery-pool", 4);
        const relatedPoolPromise = fetchWatchHistoryRelatedPool(watchedHistory, 2);
        const personalizedMusicPoolPromise = fetchPersonalizedMusicPool();
        const freshSubsPromise = fetchFreshSubscriptionUploads(subscriptionIds, 8);

        const [subscriptionPool, subscriptionRotationPool, discoveryPool, relatedPool, personalizedMusicPool, freshSubs] = await Promise.all([
          withTimeout(subscriptionPoolPromise, FULL_DISCOVER_SOURCE_TIMEOUT_MS, [] as VideoSummary[], "subscriptions"),
          withTimeout(subscriptionRotationPoolPromise, FULL_DISCOVER_SOURCE_TIMEOUT_MS, [] as VideoSummary[], "subscription-rotation"),
          withTimeout(discoveryPoolPromise, FULL_DISCOVER_SOURCE_TIMEOUT_MS, [] as VideoSummary[], "discovery"),
          withTimeout(relatedPoolPromise, FULL_DISCOVER_SOURCE_TIMEOUT_MS, [] as VideoSummary[], "related"),
          withTimeout(personalizedMusicPoolPromise, FULL_DISCOVER_SOURCE_TIMEOUT_MS, [] as VideoSummary[], "personalized-music"),
          withTimeout(freshSubsPromise, VIRAL_FALLBACK_TIMEOUT_MS, [] as VideoSummary[], "fresh-subscriptions"),
        ]);

        const viralPool = feedQuotas.viralLimit > 0
          ? preferSessionFreshVideos(
              filterFeedVideos(
                await withTimeout(fetchTrendingPool(), VIRAL_FALLBACK_TIMEOUT_MS, [] as VideoSummary[], "viral-fallback"),
                watchedIds,
              )
                .filter((video) => !isDiscoverJunkVideo(video)),
              feedQuotas.viralLimit,
            )
          : [];
        const discoverFeed = await buildDiscoverFeedFromPools(
          {
            subscriptionPool,
            subscriptionRotationPool,
            discoveryPool,
            relatedPool,
            personalizedMusicPool,
            viralPool,
          },
          watchedIds,
          subscriptionIds,
          feedQuotas,
          8000,
        );

        logHomeFeed("discover-pools", {
          queryCandidates,
          subscriptionPool: subscriptionPool.length,
          subscriptionRotationPool: subscriptionRotationPool.length,
          discoveryPool: discoveryPool.length,
          relatedPool: relatedPool.length,
          personalizedMusicPool: personalizedMusicPool.length,
          filteredSubscriptions: discoverFeed.filteredSubscriptions.length,
          filteredDiscovery: discoverFeed.filteredDiscovery.length,
          discoverySample: summarizeVideosForLog(discoverFeed.filteredDiscovery),
          subscriptionSample: summarizeVideosForLog(discoverFeed.filteredSubscriptions),
          viralSample: summarizeVideosForLog(viralPool),
          feedQuotas,
        });

        logHomeFeed("discover-ranked", {
          rankedSubscriptions: discoverFeed.rankedLanes[0].length,
          rankedDiscovery: discoverFeed.rankedLanes[1].length,
          rankedViral: discoverFeed.rankedLanes[2].length,
          feedQuotas,
          mixedFeedCount: discoverFeed.mixedFeed.length,
          finalFeedSample: summarizeVideosForLog(discoverFeed.mixedFeed),
        });
        if (requestSequenceRef.current !== requestId) {
          return;
        }
        if (discoverFeed.mixedFeed.length > 0) {
          const finalFeed = composeWithFreshSubs(freshSubs, discoverFeed.mixedFeed);
          setVideos(finalFeed);
          videosRef.current = finalFeed;
          rememberSeenVideos(finalFeed);
          updateCache("discover", finalFeed);
          setHasMoreDiscover(true);
        } else {
          logHomeFeed("discover-ranked-empty-keep-current", {
            queryCandidates,
            feedQuotas,
          });
          if (!renderedInitialFeed && videosRef.current.length === 0) {
            logHomeFeed("discover-empty-rescue-start", {
              queryCandidates,
              timeoutMs: DISCOVER_EMPTY_RESCUE_TIMEOUT_MS,
            });

            const [
              rescuedSubscriptionPool,
              rescuedSubscriptionRotationPool,
              rescuedDiscoveryPool,
              rescuedRelatedPool,
              rescuedPersonalizedMusicPool,
            ] = await Promise.all([
              withTimeout(subscriptionPoolPromise, DISCOVER_EMPTY_RESCUE_TIMEOUT_MS, [] as VideoSummary[], "subscriptions-rescue"),
              withTimeout(subscriptionRotationPoolPromise, DISCOVER_EMPTY_RESCUE_TIMEOUT_MS, [] as VideoSummary[], "subscription-rotation-rescue"),
              withTimeout(discoveryPoolPromise, DISCOVER_EMPTY_RESCUE_TIMEOUT_MS, [] as VideoSummary[], "discovery-rescue"),
              withTimeout(relatedPoolPromise, DISCOVER_EMPTY_RESCUE_TIMEOUT_MS, [] as VideoSummary[], "related-rescue"),
              withTimeout(personalizedMusicPoolPromise, DISCOVER_EMPTY_RESCUE_TIMEOUT_MS, [] as VideoSummary[], "personalized-music-rescue"),
            ]);

            const rescuedViralPool = feedQuotas.viralLimit > 0
              ? preferSessionFreshVideos(
                  filterFeedVideos(
                    await withTimeout(fetchTrendingPool(), VIRAL_FALLBACK_TIMEOUT_MS, [] as VideoSummary[], "viral-fallback-rescue"),
                    watchedIds,
                  )
                    .filter((video) => !isDiscoverJunkVideo(video)),
                  feedQuotas.viralLimit,
                )
              : [];
            const rescuedFeed = await buildDiscoverFeedFromPools(
              {
                subscriptionPool: rescuedSubscriptionPool,
                subscriptionRotationPool: rescuedSubscriptionRotationPool,
                discoveryPool: rescuedDiscoveryPool,
                relatedPool: rescuedRelatedPool,
                personalizedMusicPool: rescuedPersonalizedMusicPool,
                viralPool: rescuedViralPool,
              },
              watchedIds,
              subscriptionIds,
              feedQuotas,
              8000,
              "discover-rescue",
            );

            logHomeFeed("discover-empty-rescue-ranked", {
              subscriptionPool: rescuedSubscriptionPool.length,
              subscriptionRotationPool: rescuedSubscriptionRotationPool.length,
              discoveryPool: rescuedDiscoveryPool.length,
              relatedPool: rescuedRelatedPool.length,
              personalizedMusicPool: rescuedPersonalizedMusicPool.length,
              filteredSubscriptions: rescuedFeed.filteredSubscriptions.length,
              filteredDiscovery: rescuedFeed.filteredDiscovery.length,
              rankedSubscriptions: rescuedFeed.rankedLanes[0].length,
              rankedDiscovery: rescuedFeed.rankedLanes[1].length,
              rankedViral: rescuedFeed.rankedLanes[2].length,
              mixedFeedCount: rescuedFeed.mixedFeed.length,
              sample: summarizeVideosForLog(rescuedFeed.mixedFeed),
            });

            if (requestSequenceRef.current !== requestId) {
              return;
            }
            if (rescuedFeed.mixedFeed.length > 0) {
              setVideos(rescuedFeed.mixedFeed);
              videosRef.current = rescuedFeed.mixedFeed;
              rememberSeenVideos(rescuedFeed.mixedFeed);
              updateCache("discover", rescuedFeed.mixedFeed);
              setHasMoreDiscover(true);
            }
          }
        }
      }
    } catch (e: any) {
      console.error("Failed to load feed. Error:", e?.message || e);
      if (requestSequenceRef.current === requestId) {
        setVideos([]);
        videosRef.current = [];
      }
    } finally {
      if (requestSequenceRef.current === requestId) {
        initialDiscoverHydratingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  const refreshContinueWatching = useCallback(async () => {
    if (!continueWatchingEnabled) {
      setContinueWatchingVideos([]);
      return;
    }

    try {
      const history = await getWatchHistory(200, 0);
      watchHistoryRef.current = history;
      setContinueWatchingVideos(buildContinueWatchingVideos(history));
    } catch (error) {
      console.warn("Failed to load Continue Watching shelf", error);
      setContinueWatchingVideos([]);
    }
  }, [continueWatchingEnabled]);

  useEffect(() => {
    void refreshContinueWatching();
  }, [refreshContinueWatching]);

  useEffect(() => {
    if (!homeFeedEnabled) {
      requestSequenceRef.current += 1;
      initialDiscoverHydratingRef.current = false;
      setVideos([]);
      videosRef.current = [];
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    void fetchFeed();
  }, [activeTab, homeFeedEnabled, hideWatchedVideos]);

  useEffect(() => {
    if (loading || videos.length === 0) {
      return;
    }

    const impressionBatch = videos.filter((video) => !isHidden(video)).slice(0, 24);
    const signature = `${activeTab}:${impressionBatch.map((video) => video.id).join("|")}`;
    if (signature === lastImpressionSignatureRef.current) {
      return;
    }
    lastImpressionSignatureRef.current = signature;

    logHomeFeed("record-impressions", {
      activeTab,
      count: impressionBatch.length,
      sample: summarizeVideosForLog(impressionBatch),
    });

    void recordFeedImpressions(impressionBatch).catch((error) => {
      console.warn("Failed to record feed impressions", error);
    });
  }, [activeTab, loading, videos, isHidden]);

  // handleLoadMore closes over per-render state, so the mount-once observer reaches it
  // through a ref that always points at the latest render's closure.
  useEffect(() => {
    handleLoadMoreRef.current = handleLoadMore;
  });

  // Registered once and left mounted: rebuilding the observer from a dep array meant that
  // any guarded early-return (no setState, no re-render) left an already-intersecting
  // sentinel that could never fire again, permanently killing auto-load (issue #33).
  // Gating state is checked inside handleLoadMore instead.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1];
        sentinelIntersectingRef.current = latest?.isIntersecting ?? false;
        if (sentinelIntersectingRef.current) {
          void handleLoadMoreRef.current?.();
        }
      },
      {
        root: scrollContainerRef.current,
        rootMargin: "0px 0px 320px 0px",
        threshold: 0,
      },
    );

    loadMoreObserverRef.current = observer;
    if (loadMoreSentinelRef.current) {
      observer.observe(loadMoreSentinelRef.current);
    }
    return () => {
      loadMoreObserverRef.current = null;
      sentinelIntersectingRef.current = false;
      observer.disconnect();
      clearLoadMoreRetryTimer();
    };
  }, []);

  // The sentinel div mounts and unmounts with loading/empty states — a callback ref keeps
  // the persistent observer attached to whichever node currently exists.
  const attachLoadMoreSentinel = useCallback((node: HTMLDivElement | null) => {
    const observer = loadMoreObserverRef.current;
    if (loadMoreSentinelRef.current && observer) {
      observer.unobserve(loadMoreSentinelRef.current);
    }
    loadMoreSentinelRef.current = node;
    sentinelIntersectingRef.current = false;
    if (node && observer) {
      observer.observe(node);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "discover" || !homeFeedEnabled || loading || loadingMore || videos.length > 0) {
      return;
    }

    const retry = window.setTimeout(() => {
      void handleLoadMore();
    }, 500);

    return () => window.clearTimeout(retry);
  }, [activeTab, homeFeedEnabled, loading, loadingMore, videos.length]);

  const handlePlayVideo = async (video: VideoSummary) => {
    onPlay(video);
    try {
      await logInteraction(
        video.id,
        video.title,
        video.channelName,
        video.channelId ?? video.id,
        null,
        video.durationSeconds ?? null,
        false,
        (video.durationSeconds ?? 0) <= 60,
        "CLICK",
        0.0
      );
    } catch (err) {
      console.warn("Failed to log interaction", err);
    }
  };

  const handleRemoveFromContinueWatching = (videoId: string) => {
    hideContinueWatchingVideo(videoId);
    setContinueWatchingVideos((current) => current.filter((video) => video.id !== videoId));
  };

  // The render-time cap must scale with feed length: a fixed whole-feed cap made appended
  // videos from any channel already at the cap invisible, so the grid stopped growing even
  // though load-more was succeeding.
  const visibleVideos = capPerChannel(
    videos.filter((video) => !isHidden(video)),
    3 + Math.floor(videos.length / 24),
  );
  const visibleContinueWatchingVideos = continueWatchingEnabled
    ? continueWatchingVideos.filter((video) => !isHidden(video))
    : [];
  const shouldInsertContinueShelf =
    homeFeedEnabled && !loading && visibleVideos.length > 0 && visibleContinueWatchingVideos.length > 0;

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
      {/* Grid List layout */}
      {!homeFeedEnabled ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-chrome-zinc-800 rounded-3xl p-8 bg-chrome-zinc-900/10">
          <h3 className="font-bold text-chrome-zinc-300">{getString("home_feed_disabled_title")}</h3>
          <p className="text-chrome-zinc-500 text-xs mt-1 max-w-sm">
            {getString("home_feed_disabled_body")}
          </p>
        </div>
      ) : loading ? (
        <VideoGrid loading={true} onPlay={handlePlayVideo} />
      ) : visibleVideos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-chrome-zinc-800 rounded-3xl p-8 bg-chrome-zinc-900/10">
          <h3 className="font-bold text-chrome-zinc-300">No content found</h3>
          <p className="text-chrome-zinc-500 text-xs mt-1 max-w-sm">
            Try playing some videos or searching to help the recommendation engine learn your profile
          </p>
        </div>
      ) : (
        <>
          <VideoGrid
            videos={visibleVideos}
            onPlay={handlePlayVideo}
            onAddToQueue={onAddToQueue}
            insertNode={shouldInsertContinueShelf ? (
              <VideoShelf
                title={getString("continue_watching_shelf_title")}
                videos={visibleContinueWatchingVideos}
                onPlay={handlePlayVideo}
                onAddToQueue={onAddToQueue}
                onRemoveFromContinueWatching={handleRemoveFromContinueWatching}
                variant="continue"
              />
            ) : null}
          />

          {activeTab === "discover" && (
            <div className="flex flex-col items-center gap-3 pb-20">
              <div ref={attachLoadMoreSentinel} className="h-px w-full" />
              <button
                onClick={() => void handleLoadMore({ manual: true })}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-2xl border border-chrome-zinc-800 bg-chrome-zinc-900/40 px-5 py-3 text-sm font-semibold text-chrome-zinc-300 transition-all hover:border-chrome-zinc-700 hover:text-chrome-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-chrome-red-400" />
                    Loading more
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    Load more
                  </>
                )}
              </button>
              {!loadingMore && (
                <p className="text-xs text-chrome-zinc-500">
                  More recommendations load automatically as you scroll.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Home;
