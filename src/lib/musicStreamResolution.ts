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

/** Long enough for the backend to walk every client on a slow link; past this
 * the request is treated as failed rather than left spinning. */
const MUSIC_STREAM_TIMEOUT_MS = 15_000;

/** A queue only ever needs the track playing and the one or two after it. */
const MAX_CACHED_TRACKS = 8;

type CacheKey = string;
type CacheEntry = { info: MusicStreamInfo; resolvedAt: number };

const cache = new Map<CacheKey, CacheEntry>();
const inFlight = new Map<CacheKey, Promise<MusicStreamInfo>>();

const keyFor = (videoId: string, quality: MusicAudioQuality): CacheKey => `${videoId}::${quality}`;

function readCache(key: CacheKey): MusicStreamInfo | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt >= MUSIC_STREAM_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.info;
}

function request(videoId: string, quality: MusicAudioQuality): Promise<MusicStreamInfo> {
  const key = keyFor(videoId, quality);
  const existing = inFlight.get(key);
  if (existing) return existing;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject({ kind: "streaming", message: `Timed out resolving the stream for ${videoId}` }),
      MUSIC_STREAM_TIMEOUT_MS,
    );
  });
  const pending = Promise.race([getMusicStream(videoId, quality), timeout]).then((info) => {
    // An invalidate while this was in flight means the caller no longer trusts
    // the answer; caching it would hand the dead link straight back.
    if (inFlight.get(key) !== tracked) return info;
    cache.set(key, { info, resolvedAt: Date.now() });
    while (cache.size > MAX_CACHED_TRACKS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return info;
  });
  const tracked: Promise<MusicStreamInfo> = pending.finally(() => {
    clearTimeout(timer);
    if (inFlight.get(key) === tracked) inFlight.delete(key);
  });
  inFlight.set(key, tracked);
  return tracked;
}

export function resolveMusicStream(
  videoId: string,
  quality: MusicAudioQuality,
): Promise<MusicStreamInfo> {
  const cached = readCache(keyFor(videoId, quality));
  if (cached) return Promise.resolve(cached);
  return request(videoId, quality);
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
  if (readCache(key) || inFlight.has(key)) return;
  void request(videoId, quality).catch(() => {
    // A speculative resolve that fails costs nothing — playing the track will
    // resolve it again and surface the real error then.
  });
}

export function invalidateMusicStream(videoId: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${videoId}::`)) cache.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(`${videoId}::`)) inFlight.delete(key);
  }
}
