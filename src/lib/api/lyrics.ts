import { invokeBackend } from "./errors";

/** The song's cached lyrics entries as JSON, if any were saved. */
export function getCachedLyrics(videoId: string): Promise<string | null> {
  return invokeBackend<string | null>("get_cached_lyrics", { videoId });
}

export function putCachedLyrics(videoId: string, entries: string): Promise<void> {
  return invokeBackend<void>("put_cached_lyrics", { videoId, entries });
}

export function evictCachedLyrics(videoId: string): Promise<void> {
  return invokeBackend<void>("evict_cached_lyrics", { videoId });
}

export function lyricsCacheSize(): Promise<number> {
  return invokeBackend<number>("lyrics_cache_size");
}

export function clearLyricsCache(): Promise<void> {
  return invokeBackend<void>("clear_lyrics_cache");
}

/** Replaces a downloaded song's `.lrc` file; false when the song has no finished download. */
export function saveDownloadLyrics(videoId: string, lrc: string): Promise<boolean> {
  return invokeBackend<boolean>("save_download_lyrics", { videoId, lrc });
}
