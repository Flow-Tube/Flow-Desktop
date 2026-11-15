import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forgetSubscriptionPosts,
  getSubscriptionPosts,
  type SubscriptionPost,
  type SubscriptionPostsChannel,
} from "./api/youtube";
import { cleanChannelId, useFeedActionsStore } from "../store/useFeedActionsStore";
import type { SubscribedChannel } from "../store/useSubscriptionStore";
import type { VideoSummary } from "../types/video";

interface Options {
  /** The followed channels in view: every one, or the selected group's. */
  channels: SubscribedChannel[];
  /** The subscription feed, newest first, which ranks the channels by their latest upload. */
  feed: VideoSummary[];
  /** Nothing loads until the Posts view is shown. */
  enabled: boolean;
}

export interface SubscriptionPostsState {
  items: SubscriptionPost[];
  /** Reading the first posts, with none to show yet. */
  loading: boolean;
  /** Reading more posts below the ones shown. */
  loadingMore: boolean;
  /** Reading again from the top over the posts shown, which stay until the new ones land. */
  refreshing: boolean;
  /** Why the last read failed: the whole view's error with no posts shown, else the footer's. */
  error: unknown;
  /** More channels are left to read. */
  hasMore: boolean;
  /** Every channel was read and none posted in the last 30 days. */
  empty: boolean;
  loadMore: () => void;
  /** Reads the page that failed again. */
  retry: () => void;
  /** Forgets the cached posts and reads every channel again from the most active. */
  refresh: () => void;
}

interface PagingState {
  items: SubscriptionPost[];
  nextPage: number | null;
  /** The page being read, or null when idle. */
  loadingPage: number | null;
  failedPage: number | null;
  error: unknown;
  replacing: boolean;
}

const IDLE: PagingState = {
  items: [],
  nextPage: 0,
  loadingPage: null,
  failedPage: null,
  error: null,
  replacing: false,
};

/** The channel ids of the feed in the order of their latest upload. */
export function recentUploaderIds(feed: VideoSummary[]): string[] {
  const ids = new Set<string>();
  for (const video of feed) {
    const id = cleanChannelId(video.channelId);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Recent community posts of the followed channels, eight channels a page, the most active first,
 * as Flow for Android's Subscriptions Posts view reads them. The channel order is fixed when a
 * read from the top starts, so a feed refresh mid-scroll never reshuffles the pages.
 */
export function useSubscriptionPosts({ channels, feed, enabled }: Options): SubscriptionPostsState {
  const blocked = useFeedActionsStore((state) => state.blockedChannelIds);
  const scope = useMemo(
    () => channels.filter((channel) => !blocked.has(cleanChannelId(channel.id))),
    [blocked, channels],
  );
  const scopeKey = useMemo(() => scope.map((channel) => channel.id).sort().join("|"), [scope]);
  const [state, setState] = useState<PagingState>(IDLE);
  const [refreshCount, setRefreshCount] = useState(0);

  const latest = useRef({ scope, feed });
  const request = useRef<{ channels: SubscriptionPostsChannel[]; uploaders: string[] } | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const seen = useRef(new Set<string>());
  const replacing = useRef(false);
  const startedKey = useRef<string | null>(null);

  useEffect(() => {
    latest.current = { scope, feed };
  });

  const loadFrom = useCallback(async (firstPage: number) => {
    const read = request.current;
    if (!read || busy.current) return;
    const current = generation.current;
    busy.current = true;
    setState((s) => ({ ...s, loadingPage: firstPage, failedPage: null, error: null }));
    let page: number | null = firstPage;
    try {
      // A page whose channels posted nothing recent shows nothing, so the next one is read straight away.
      while (page !== null) {
        const result = await getSubscriptionPosts(read.channels, read.uploaders, page);
        if (current !== generation.current) return;
        if (replacing.current) {
          replacing.current = false;
          seen.current = new Set();
        }
        const fresh = result.posts.filter((item) => !seen.current.has(item.post.id));
        fresh.forEach((item) => seen.current.add(item.post.id));
        const next = result.nextPage;
        const more = fresh.length === 0 && next !== null;
        setState((s) => ({
          ...s,
          items: s.replacing ? fresh : fresh.length > 0 ? [...s.items, ...fresh] : s.items,
          replacing: false,
          nextPage: next,
          loadingPage: more ? next : null,
        }));
        page = more ? next : null;
      }
    } catch (error) {
      if (current !== generation.current) return;
      setState((s) => ({ ...s, loadingPage: null, failedPage: page, error }));
    } finally {
      if (current === generation.current) busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const key = `${scopeKey}#${refreshCount}`;
    if (startedKey.current === key) return;
    // A refresh keeps the posts on screen until the first new page replaces them.
    const keep = startedKey.current?.startsWith(`${scopeKey}#`) ?? false;
    startedKey.current = key;
    generation.current += 1;
    busy.current = false;
    const { scope: channelsInView, feed: currentFeed } = latest.current;
    request.current = {
      channels: channelsInView.map((channel) => ({
        id: channel.id,
        name: channel.name,
        avatarUrl: channel.avatarUrl ?? null,
      })),
      uploaders: recentUploaderIds(currentFeed),
    };
    replacing.current = keep;
    if (!keep) seen.current = new Set();
    setState((s) => (keep ? { ...IDLE, items: s.items, replacing: true } : IDLE));
    void loadFrom(0);
  }, [enabled, loadFrom, refreshCount, scopeKey]);

  const loadMore = useCallback(() => {
    if (state.nextPage === null || state.error != null || state.loadingPage !== null) return;
    void loadFrom(state.nextPage);
  }, [loadFrom, state.error, state.loadingPage, state.nextPage]);

  const retry = useCallback(() => {
    if (state.failedPage !== null) void loadFrom(state.failedPage);
  }, [loadFrom, state.failedPage]);

  const refresh = useCallback(() => {
    void forgetSubscriptionPosts()
      .catch((error) => console.warn("Failed to forget cached subscription posts", error))
      .finally(() => setRefreshCount((count) => count + 1));
  }, []);

  const reading = state.loadingPage !== null;
  return {
    items: state.items,
    loading: reading && state.items.length === 0,
    loadingMore: reading && state.items.length > 0 && !state.replacing,
    refreshing: reading && state.replacing,
    error: state.error,
    hasMore: state.nextPage !== null,
    empty: !reading && state.error == null && state.items.length === 0 && state.nextPage === null,
    loadMore,
    retry,
    refresh,
  };
}
