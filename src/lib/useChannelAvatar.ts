import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSubscriptionStore } from '../store/useSubscriptionStore';
import { getChannelDetails } from './api/youtube';
import { isStatsString } from './videoStats';

// ─── Shared singleton state ────────────────────────────────────

export interface CachedChannelMeta {
  name: string | null;
  avatarUrl: string | null;
  verified: boolean;
}

/** Resolved avatars: channelId → URL | null. */
const avatarCache = new Map<string, string | null>();

/** Resolved channel metadata: channelId → CachedChannelMeta. */
const metaCache = new Map<string, CachedChannelMeta>();

/** In-flight fetch promises keyed by channelId – deduplicates. */
const pendingFetches = new Map<string, Promise<CachedChannelMeta | null>>();

/** Queue of channelIds waiting to be fetched. */
let fetchQueue: string[] = [];

/** Drain timer handle. */
let drainTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Listeners keyed by channelId.
 *
 * This used to be one flat set behind a global version counter, which meant a
 * single avatar resolving re-rendered *every* card in the feed rather than the
 * one waiting on it — on a feed of several hundred cards, each of a few dozen
 * resolutions cost a full pass.
 */
const listeners = new Map<string, Set<() => void>>();

function notifyChannel(channelId: string) {
  const subscribers = listeners.get(channelId);
  if (!subscribers) return;
  for (const listener of subscribers) {
    listener();
  }
}

function subscribeToChannel(channelId: string | null, cb: () => void) {
  if (!channelId) return () => {};

  let subscribers = listeners.get(channelId);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(channelId, subscribers);
  }
  subscribers.add(cb);

  return () => {
    subscribers.delete(cb);
    // Drop the bucket with its last listener so a long session browsing many
    // channels does not accumulate empty sets.
    if (subscribers.size === 0) listeners.delete(channelId);
  };
}

// ─── Validation ────────────────────────────────────────────────

function isValidAvatarUrl(url?: string | null): url is string {
  if (!url || !url.startsWith('http')) return false;
  // Reject video thumbnails that were accidentally stored as avatars
  if (/ytimg\.com\/vi\//i.test(url)) return false;
  return true;
}

// ─── Batch fetcher ─────────────────────────────────────────────

const MAX_CONCURRENT = 4;
let activeFetches = 0;

function fetchMetadataForChannel(channelId: string): Promise<CachedChannelMeta | null> {
  const existing = pendingFetches.get(channelId);
  if (existing) return existing;

  const promise = getChannelDetails(channelId)
    .then((details) => {
      const url = isValidAvatarUrl(details.avatarUrl) ? details.avatarUrl : null;
      const rawName = details.name?.trim();
      const cleanName = rawName && !isStatsString(rawName) && rawName !== "Unknown Channel" ? rawName : null;
      const meta: CachedChannelMeta = {
        name: cleanName,
        avatarUrl: url,
        verified: Boolean(details.verified),
      };
      avatarCache.set(channelId, url);
      metaCache.set(channelId, meta);
      notifyChannel(channelId);
      return meta;
    })
    .catch(() => {
      const fallback: CachedChannelMeta = { name: null, avatarUrl: null, verified: false };
      avatarCache.set(channelId, null);
      metaCache.set(channelId, fallback);
      notifyChannel(channelId);
      return null;
    })
    .finally(() => {
      pendingFetches.delete(channelId);
      activeFetches = Math.max(0, activeFetches - 1);
      drainQueue();
    });

  pendingFetches.set(channelId, promise);
  return promise;
}

function drainQueue() {
  while (fetchQueue.length > 0 && activeFetches < MAX_CONCURRENT) {
    const channelId = fetchQueue.shift()!;
    // Skip if already resolved or in-flight
    if (metaCache.has(channelId) || pendingFetches.has(channelId)) continue;
    activeFetches += 1;
    void fetchMetadataForChannel(channelId);
  }
}

function enqueueFetch(channelId: string) {
  if (metaCache.has(channelId) || pendingFetches.has(channelId)) return;
  if (fetchQueue.includes(channelId)) return;
  fetchQueue.push(channelId);

  // Debounce drain to batch rapid mount calls
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = setTimeout(drainQueue, 50);
}

// ─── Public hooks ──────────────────────────────────────────────

const EMPTY_META: CachedChannelMeta = { name: null, avatarUrl: null, verified: false };

/**
 * Resolves a channel's metadata (name, avatarUrl, verified status) by:
 * 1. Checking the subscription store (instant, free)
 * 2. Checking the in-memory cache
 * 3. Queueing a batched `getChannelDetails()` fetch (max 4 concurrent)
 *
 * Automatically re-renders when the channel resolves.
 */
export function useChannelMetadata(
  channelId: string | null | undefined,
): CachedChannelMeta {
  const sub = useSubscriptionStore((state) =>
    channelId ? state.subscriptions.find((s) => s.id === channelId) : undefined,
  );
  const rawSubName = sub?.name?.trim();
  const cleanSubName = rawSubName && !isStatsString(rawSubName) && rawSubName !== "Unknown Channel" ? rawSubName : null;
  const cleanSubAvatar = isValidAvatarUrl(sub?.avatarUrl) ? sub!.avatarUrl! : null;

  const subscribe = useCallback(
    (cb: () => void) => subscribeToChannel(channelId ?? null, cb),
    [channelId],
  );
  const getSnapshot = useCallback(
    () => (channelId ? metaCache.get(channelId) ?? null : null),
    [channelId],
  );
  const cachedMeta = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!channelId) return;
    if (metaCache.has(channelId)) return;
    if (cleanSubName && cleanSubAvatar) return;

    enqueueFetch(channelId);
  }, [channelId, cleanSubName, cleanSubAvatar]);

  return useMemo(() => {
    if (!channelId) return EMPTY_META;
    return {
      name: cleanSubName ?? cachedMeta?.name ?? null,
      avatarUrl: cleanSubAvatar ?? cachedMeta?.avatarUrl ?? null,
      verified: cachedMeta?.verified ?? false,
    };
  }, [channelId, cleanSubName, cleanSubAvatar, cachedMeta]);
}

/**
 * Resolves a channel avatar URL by using `useChannelMetadata`.
 * Automatically re-renders when the avatar resolves.
 */
export function useChannelAvatar(
  channelId: string | null | undefined,
): string | null {
  const meta = useChannelMetadata(channelId);
  return meta.avatarUrl;
}
