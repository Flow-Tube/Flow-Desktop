import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useSubscriptionStore } from '../store/useSubscriptionStore';
import { getChannelDetails } from './api/youtube';

// ─── Shared singleton state ────────────────────────────────────

/** Resolved avatars: channelId → URL | null. */
const avatarCache = new Map<string, string | null>();

/** In-flight fetch promises keyed by channelId – deduplicates. */
const pendingFetches = new Map<string, Promise<string | null>>();

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

function fetchAvatarForChannel(channelId: string): Promise<string | null> {
  const existing = pendingFetches.get(channelId);
  if (existing) return existing;

  const promise = getChannelDetails(channelId)
    .then((details) => {
      const url = isValidAvatarUrl(details.avatarUrl) ? details.avatarUrl : null;
      avatarCache.set(channelId, url);
      notifyChannel(channelId);
      return url;
    })
    .catch(() => {
      avatarCache.set(channelId, null);
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
    if (avatarCache.has(channelId) || pendingFetches.has(channelId)) continue;
    activeFetches += 1;
    fetchAvatarForChannel(channelId);
  }
}

function enqueueAvatarFetch(channelId: string) {
  if (avatarCache.has(channelId) || pendingFetches.has(channelId)) return;
  if (fetchQueue.includes(channelId)) return;
  fetchQueue.push(channelId);

  // Debounce drain to batch rapid mount calls
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = setTimeout(drainQueue, 50);
}

// ─── Public hook ───────────────────────────────────────────────

/**
 * Resolves a channel avatar URL by:
 * 1. Checking the subscription store (instant, free)
 * 2. Checking the in-memory cache
 * 3. Queueing a batched `getChannelDetails()` fetch (max 4 concurrent)
 *
 * Automatically re-renders when the avatar resolves.
 */
export function useChannelAvatar(
  channelId: string | null | undefined,
): string | null {
  const subAvatar = useSubscriptionStore((state) => {
    if (!channelId) return null;
    const sub = state.subscriptions.find((s) => s.id === channelId);
    return sub && isValidAvatarUrl(sub.avatarUrl) ? sub.avatarUrl : null;
  });

  // Re-render only when *this* channel resolves. The snapshot is the URL itself
  // rather than a counter, so an unrelated channel landing is not an update.
  const subscribe = useCallback(
    (cb: () => void) => subscribeToChannel(channelId ?? null, cb),
    [channelId],
  );
  const getSnapshot = useCallback(
    () => (channelId ? avatarCache.get(channelId) ?? null : null),
    [channelId],
  );
  const cachedAvatar = useSyncExternalStore(subscribe, getSnapshot);

  // Enqueue fetch if needed (inside effect to comply with React rules)
  useEffect(() => {
    if (!channelId) return;
    // Already resolved in cache
    if (avatarCache.has(channelId)) return;
    // Already available from subscriptions
    if (subAvatar) return;

    enqueueAvatarFetch(channelId);
  }, [channelId, subAvatar]);

  // ── Resolve synchronously ────────────────────────────────────
  if (!channelId) return null;

  // 1. Avatar from the subscription store
  if (subAvatar) return subAvatar;

  // 2. Whatever the cache holds for this channel (null until it resolves)
  return cachedAvatar;
}
