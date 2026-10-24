import type { LyricsEntry } from "./types";

const offlineEntries = new Map<string, LyricsEntry[]>();
const listeners = new Set<(videoId: string, entries: LyricsEntry[]) => void>();

/**
 * Registers the lyrics saved alongside a download.
 *
 * Deliberately kept out of the lyrics cache: a cache hit short-circuits the provider chain, which
 * would permanently lock a downloaded track to its saved copy even when a better version is
 * available online. They are shown at once and replaced only by a better provider result.
 */
export function seedOfflineLyrics(videoId: string, text: string): void {
  if (!videoId || offlineEntries.has(videoId)) return;
  const entries: LyricsEntry[] = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ time: 0, text: line }));
  if (entries.length === 0) return;
  offlineEntries.set(videoId, entries);
  for (const listener of listeners) listener(videoId, entries);
}

/** Lyrics saved with a download, if this track has any. */
export function getOfflineLyrics(videoId: string): LyricsEntry[] | null {
  return offlineEntries.get(videoId) ?? null;
}

/** The download's lyrics often arrive after the song has started; this hears about them. */
export function onOfflineLyrics(listener: (videoId: string, entries: LyricsEntry[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
