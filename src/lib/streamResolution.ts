import { getStreamInfo } from "./api/youtube";
import type { StreamInfo } from "../types/video";

/**
 * One resolver for every playback surface — the watch page, the Shorts pager and
 * the prefetch fired when a video is opened.
 *
 * Two things make playback start sooner. Asking for a video that is already
 * being resolved joins that request instead of opening a second client ladder,
 * so a prefetch on click is free to the player that follows it. And a resolved
 * result stays reusable for a few minutes, so returning to a video the user just
 * left plays immediately.
 */

/** Resolved stream URLs stay valid for hours; the backend proxy session backing
 * them expires after an hour. A window far inside both bounds keeps a reuse from
 * ever handing the player a session the proxy has already dropped. */
const STREAM_INFO_TTL_MS = 4 * 60_000;

/** Nothing beyond the handful of videos around the current one is reopened. */
const MAX_CACHED_STREAMS = 12;

/** Prefetches are speculative, so they must never crowd out the resolve the user
 * is actually waiting on. */
const MAX_CONCURRENT_PREFETCH = 2;

type CacheEntry = { info: StreamInfo; resolvedAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<StreamInfo>>();

const prefetchQueue: string[] = [];
let activePrefetches = 0;

function readCache(videoId: string): StreamInfo | null {
  const entry = cache.get(videoId);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt >= STREAM_INFO_TTL_MS) {
    cache.delete(videoId);
    return null;
  }
  return entry.info;
}

function writeCache(videoId: string, info: StreamInfo, resolvedAt = Date.now()) {
  cache.set(videoId, { info, resolvedAt });
  for (const [key, entry] of cache) {
    if (Date.now() - entry.resolvedAt >= STREAM_INFO_TTL_MS) cache.delete(key);
  }
  while (cache.size > MAX_CACHED_STREAMS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** The underlying request, shared by every caller asking for the same video. */
function requestStreamInfo(videoId: string): Promise<StreamInfo> {
  const existing = inFlight.get(videoId);
  if (existing) return existing;

  const request = getStreamInfo(videoId).then((info) => {
    writeCache(videoId, info);
    return info;
  });
  const tracked = request.finally(() => {
    if (inFlight.get(videoId) === tracked) inFlight.delete(videoId);
  });
  inFlight.set(videoId, tracked);
  return tracked;
}

export interface ResolveStreamOptions {
  /** Reject after this long. The request itself keeps running, so a late answer
   * still lands in the cache and a retry gets it for free. */
  timeoutMs?: number;
  /** Walk a fresh client ladder instead of reusing a cached response. */
  refresh?: boolean;
}

export function resolveStreamInfo(
  videoId: string,
  { timeoutMs, refresh = false }: ResolveStreamOptions = {},
): Promise<StreamInfo> {
  if (refresh) invalidateStreamInfo(videoId);

  const cached = refresh ? null : readCache(videoId);
  if (cached) return Promise.resolve(cached);

  const request = refresh
    ? getStreamInfo(videoId, true).then((info) => {
        writeCache(videoId, info);
        return info;
      })
    : requestStreamInfo(videoId);
  if (!timeoutMs) return request;

  return Promise.race([
    request,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("stream resolve timed out")), timeoutMs),
    ),
  ]);
}

function drainPrefetchQueue() {
  while (activePrefetches < MAX_CONCURRENT_PREFETCH && prefetchQueue.length > 0) {
    const videoId = prefetchQueue.shift();
    if (!videoId || readCache(videoId) || inFlight.has(videoId)) continue;
    activePrefetches += 1;
    void requestStreamInfo(videoId)
      .catch(() => {
        // A speculative resolve that fails costs nothing — the surface that
        // actually needs the video will resolve it again and report the error.
      })
      .finally(() => {
        activePrefetches -= 1;
        drainPrefetchQueue();
      });
  }
}

/**
 * Starts resolving [videoId] ahead of the surface that will play it.
 *
 * Safe to call on every open: an id already cached or already in flight is
 * dropped, and the player's own resolve joins whatever this started rather than
 * paying for a second one.
 */
export function prefetchStreamInfo(videoId: string | null | undefined) {
  if (!videoId) return;
  if (readCache(videoId) || inFlight.has(videoId)) return;
  if (prefetchQueue.includes(videoId)) return;
  // Only the most recent intent is worth warming — an abandoned one would
  // compete for bandwidth with the video actually being opened.
  prefetchQueue.unshift(videoId);
  if (prefetchQueue.length > MAX_CONCURRENT_PREFETCH * 2) prefetchQueue.length = MAX_CONCURRENT_PREFETCH * 2;
  drainPrefetchQueue();
}

/** The cached resolve for [videoId], with the age needed to hand it to another
 * window without resetting its TTL. */
export function readStreamInfoEntry(videoId: string): CacheEntry | null {
  const entry = cache.get(videoId);
  if (!entry) return null;
  return Date.now() - entry.resolvedAt >= STREAM_INFO_TTL_MS ? null : entry;
}

/**
 * Adopts a resolve performed by another window. The pop-out player runs in its
 * own JS context with a cold cache, and re-resolving would walk the whole client
 * ladder again for a stream the main window already holds. The original
 * `resolvedAt` travels with it so an inherited entry expires on schedule instead
 * of being revived.
 */
export function primeStreamInfo(videoId: string, info: StreamInfo, resolvedAt: number) {
  if (!Number.isFinite(resolvedAt)) return;
  if (Date.now() - resolvedAt >= STREAM_INFO_TTL_MS) return;
  writeCache(videoId, info, resolvedAt);
}

export function invalidateStreamInfo(videoId: string) {
  cache.delete(videoId);
  inFlight.delete(videoId);
}

export function clearStreamInfoCache() {
  cache.clear();
  inFlight.clear();
  prefetchQueue.length = 0;
}
