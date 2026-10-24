import { getMusicStream, type MusicAudioQuality } from "./api/music";
import type { MusicStreamInfo } from "../types/music";

/**
 * Resolution layer for music playback, kept separate from the video one because
 * the two resolve through different backend paths and must never share state.
 *
 * A queue advance used to pay a full resolve before the next track could be
 * handed to the audio element, which is exactly the gap a listener hears.
 * Resolving the upcoming track while the current one plays turns that into a
 * cache read, and a track played again inside the window costs nothing.
 */

/** Music URLs stay valid for hours and the proxy session behind them for one
 * hour. Staying well inside that keeps a link prefetched at the start of a long
 * track usable when the track ends, without ever handing the element a session
 * the proxy has dropped. */
const MUSIC_STREAM_TTL_MS = 50 * 60_000;

/**
 * How long one wait for a link lasts before the player says it failed. The
 * backend's client ladder can take longer (eight clients at six seconds each),
 * so a wait that times out leaves the walk running and the retry joins it
 * instead of starting a second one.
 */
const MUSIC_STREAM_TIMEOUT_MS = 15_000;

/** A queue only ever needs the track playing and the one or two after it. */
const MAX_CACHED_TRACKS = 8;

export interface MusicStreamOptions {
  /** Ask for AAC over Opus, after the element could not decode the first answer. */
  preferAac?: boolean;
}

type CacheKey = string;
type CacheEntry = { info: MusicStreamInfo; resolvedAt: number };

const cache = new Map<CacheKey, CacheEntry>();
/** Backend walks still running, which may outlive the wait that started them. */
const walks = new Map<CacheKey, Promise<MusicStreamInfo>>();

const keyFor = (videoId: string, quality: MusicAudioQuality, options?: MusicStreamOptions): CacheKey =>
  `${videoId}::${quality}${options?.preferAac ? "::aac" : ""}`;

/** The rejection a wait gives when the backend has not answered in time. */
interface ResolveTimeout {
  kind: "streaming";
  message: string;
  timedOut: true;
}

/** Whether `error` is a wait that ran out while the backend walk carries on. */
export const isResolveTimeout = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as Partial<ResolveTimeout>).timedOut === true;

function readCache(key: CacheKey): MusicStreamInfo | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt >= MUSIC_STREAM_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.info;
}

function walk(key: CacheKey, videoId: string, quality: MusicAudioQuality, options?: MusicStreamOptions) {
  const existing = walks.get(key);
  if (existing) return existing;
  const tracked: Promise<MusicStreamInfo> = getMusicStream(videoId, quality, options?.preferAac ?? false)
    .then((info) => {
      // An invalidate while this was in flight means the caller no longer trusts
      // the answer; caching it would hand the dead link straight back.
      if (walks.get(key) !== tracked) return info;
      cache.set(key, { info, resolvedAt: Date.now() });
      while (cache.size > MAX_CACHED_TRACKS) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return info;
    })
    .finally(() => {
      if (walks.get(key) === tracked) walks.delete(key);
    });
  walks.set(key, tracked);
  return tracked;
}

function request(videoId: string, quality: MusicAudioQuality, options?: MusicStreamOptions): Promise<MusicStreamInfo> {
  const pending = walk(keyFor(videoId, quality, options), videoId, quality, options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error: ResolveTimeout = {
        kind: "streaming",
        message: `Timed out resolving the stream for ${videoId}`,
        timedOut: true,
      };
      reject(error);
    }, MUSIC_STREAM_TIMEOUT_MS);
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}

export function resolveMusicStream(
  videoId: string,
  quality: MusicAudioQuality,
  options?: MusicStreamOptions,
): Promise<MusicStreamInfo> {
  const cached = readCache(keyFor(videoId, quality, options));
  if (cached) return Promise.resolve(cached);
  return request(videoId, quality, options);
}

/**
 * Warms the next track while the current one plays. Safe to call repeatedly —
 * an already cached or in-flight track is dropped.
 */
export function prefetchMusicStream(
  videoId: string | null | undefined,
  quality: MusicAudioQuality,
) {
  if (!videoId) return;
  const key = keyFor(videoId, quality);
  if (readCache(key) || walks.has(key)) return;
  void request(videoId, quality).catch(() => {
    // A speculative resolve that fails costs nothing — playing the track will
    // resolve it again and surface the real error then.
  });
}

export function invalidateMusicStream(videoId: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${videoId}::`)) cache.delete(key);
  }
  for (const key of [...walks.keys()]) {
    if (key.startsWith(`${videoId}::`)) walks.delete(key);
  }
}
