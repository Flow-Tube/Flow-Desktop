import { getSetting, setSetting } from "./api/db";
import { cleanChannelId, useFeedActionsStore } from "../store/useFeedActionsStore";
import type { VideoSummary } from "../types/video";

/** The Home feed as last painted in this process, per tab. */
export const homeFeedCache: Record<"discover" | "trending", { videos: VideoSummary[]; timestamp: number }> = {
  discover: { videos: [], timestamp: 0 },
  trending: { videos: [], timestamp: 0 },
};

// Persistent discover feed: survives process restart for an instant cold-start paint and an
// offline floor, unlike the in-memory `homeFeedCache`. Reconciled by the background refresh.
const PERSISTED_FEED_KEY = "home_discover_cache_v1";
const PERSISTED_FEED_TTL_MS = 24 * 60 * 60 * 1000;

export const persistDiscoverFeed = async (videos: VideoSummary[]) => {
  if (videos.length === 0) return;
  try {
    const payload = JSON.stringify({ videos: videos.slice(0, 60), timestamp: Date.now() });
    await setSetting(PERSISTED_FEED_KEY, payload);
  } catch (error) {
    console.warn("Failed to persist discover feed", error);
  }
};

export const loadPersistedDiscoverFeed = async (): Promise<VideoSummary[] | null> => {
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

/** Forgets both caches, so the next Home paint is ranked by the brain as it is now. */
export async function clearHomeFeedCaches() {
  homeFeedCache.discover = { videos: [], timestamp: 0 };
  homeFeedCache.trending = { videos: [], timestamp: 0 };
  await setSetting(PERSISTED_FEED_KEY, "");
}
