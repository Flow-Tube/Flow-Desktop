import type { LyricsEntry } from "./types";
import { parseLyrics } from "./lyricsUtils";
import { getString } from "../i18n/index";

export interface OfflineLyrics {
  entries: LyricsEntry[];
  /** The file's `[offset:]` tag in ms; positive shows the lines sooner, as the sync offset does. */
  offsetMs: number;
}

/** The provider name lyrics saved with a download are shown under. */
export const OFFLINE_LYRICS_PROVIDER = "Downloaded";

/** A provider name as the lyrics UI shows it. */
export function lyricsSourceLabel(providerName: string): string {
  return providerName === OFFLINE_LYRICS_PROVIDER ? getString("lyrics_source_downloaded") : providerName;
}

const offline = new Map<string, OfflineLyrics>();
const listeners = new Set<(videoId: string, lyrics: OfflineLyrics) => void>();

const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*]\s*$/im;
const HEADER_TAG = /^\s*\[[a-zA-Z#]+:[^\]]*]\s*$/;

/** An `[offset:+500]` tag in milliseconds, or 0. Port of Android's lrcOffsetMs. */
export function lrcOffsetMs(text: string): number {
  const match = text.match(OFFSET_TAG);
  return match ? Number.parseInt(match[1]!, 10) || 0 : 0;
}

/** Saved lyrics as entries: an LRC file keeps its timings, anything else becomes plain lines. */
export function parseOfflineLyrics(text: string): LyricsEntry[] {
  const parsed = parseLyrics(text).filter((entry) => entry.text.trim());
  if (parsed.length > 0) return parsed;
  return text
    .split(/\r?\n/)
    .filter((line) => !HEADER_TAG.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ time: 0, text: line }));
}

/**
 * Registers the lyrics saved alongside a download.
 *
 * Deliberately kept out of the lyrics cache: a cache hit short-circuits the provider chain, which
 * would permanently lock a downloaded track to its saved copy even when a better version is
 * available online. They are shown at once and replaced only by a better provider result.
 */
export function seedOfflineLyrics(videoId: string, text: string): void {
  if (!videoId || offline.has(videoId)) return;
  const entries = parseOfflineLyrics(text);
  if (entries.length === 0) return;
  const lyrics = { entries, offsetMs: lrcOffsetMs(text) };
  offline.set(videoId, lyrics);
  for (const listener of listeners) listener(videoId, lyrics);
}

/** Lyrics saved with a download, if this track has any. */
export function getOfflineLyrics(videoId: string): OfflineLyrics | null {
  return offline.get(videoId) ?? null;
}

/** The download's lyrics often arrive after the song has started; this hears about them. */
export function onOfflineLyrics(listener: (videoId: string, lyrics: OfflineLyrics) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
