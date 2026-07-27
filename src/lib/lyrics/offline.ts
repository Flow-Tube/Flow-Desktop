import type { LyricsEntry } from "./types";

const UNSYNCED = 0;

const offlineEntries = new Map<string, LyricsEntry[]>();

/**
 * Registers the plain lyrics saved alongside a download.
 *
 * Deliberately kept out of the lyrics cache: a cache hit short-circuits the
 * provider chain, which would permanently lock a downloaded track to unsynced
 * text even when a word/line-synced version is available online. These entries
 * are only consulted once every provider has come up empty.
 */
export function seedOfflineLyrics(videoId: string, text: string): void {
  if (!videoId || offlineEntries.has(videoId)) return;

  const entries: LyricsEntry[] = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ time: UNSYNCED, text: line }));

  if (entries.length > 0) offlineEntries.set(videoId, entries);
}

/** Plain lyrics saved with a download, if this track has any. */
export function getOfflineLyrics(videoId: string): LyricsEntry[] | null {
  return offlineEntries.get(videoId) ?? null;
}
