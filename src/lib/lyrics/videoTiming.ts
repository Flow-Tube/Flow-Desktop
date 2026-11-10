import { useEffect, useState } from "react";

import { getNonMusicSegments, type NonMusicSegment } from "../api/foss";
import { isLocalMediaId } from "../localMediaId";
import { useBoolPref } from "../usePreference";
import { SETTINGS } from "../settings/schema";
import { useSettingsStore } from "../../store/useSettingsStore";
import { onVideoClock } from "./nonMusicParts";
import type { LyricsEntry } from "./types";

const CACHE_SIZE = 32;
/** A segment voted on for a cut this far from the playing video's length no longer fits it. */
const MAX_DURATION_GAP_SEC = 5;

const cache = new Map<string, NonMusicSegment[]>();
const inFlight = new Map<string, Promise<NonMusicSegment[] | null>>();

/** Null when the lookup failed: nothing is kept, so the next song or setting change tries again. */
function segmentsFor(videoId: string): Promise<NonMusicSegment[] | null> {
  const cached = cache.get(videoId);
  if (cached) {
    cache.delete(videoId);
    cache.set(videoId, cached);
    return Promise.resolve(cached);
  }
  const running = inFlight.get(videoId);
  if (running) return running;
  const lookup = (async () => {
    try {
      await useSettingsStore.getState().loadSettings();
      const segments = await getNonMusicSegments(videoId, useSettingsStore.getState().serverUrl);
      cache.set(videoId, segments);
      while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
      return segments;
    } catch {
      return null;
    } finally {
      inFlight.delete(videoId);
    }
  })();
  inFlight.set(videoId, lookup);
  return lookup;
}

/** `entries` on the music video's clock, using SponsorBlock's non-music parts; unchanged when there are none. */
export async function fitToVideo(videoId: string, entries: LyricsEntry[], durationSec: number): Promise<LyricsEntry[]> {
  if (entries.length === 0 || isLocalMediaId(videoId)) return entries;
  const segments = await segmentsFor(videoId);
  if (!segments) return entries;
  const fitting = segments.filter(
    (s) => durationSec <= 0 || s.videoDurationSeconds <= 0 || Math.abs(s.videoDurationSeconds - durationSec) <= MAX_DURATION_GAP_SEC,
  );
  const videoSec = durationSec > 0 ? durationSec : Math.max(0, ...fitting.map((s) => s.videoDurationSeconds));
  const parts = fitting.map((s) => ({ startMs: Math.round(s.startSeconds * 1000), endMs: Math.round(s.endSeconds * 1000) }));
  return onVideoClock(entries, parts, Math.round(videoSec * 1000));
}

/**
 * Synced lyrics fitted to the music video playing, while Fit lyrics to music videos is on. They
 * show straight away and move once the lookup answers; turning the setting off puts them back.
 */
export function useVideoFittedLyrics(videoId: string | null, entries: LyricsEntry[], durationSec: number): LyricsEntry[] {
  const [enabled] = useBoolPref(SETTINGS.LYRICS_SPONSORBLOCK_TIMING);
  const [fitted, setFitted] = useState<{ from: LyricsEntry[]; to: LyricsEntry[] } | null>(null);
  const seconds = Math.round(durationSec);
  useEffect(() => {
    if (!enabled || !videoId || entries.length === 0) return;
    let cancelled = false;
    void fitToVideo(videoId, entries, seconds).then((to) => {
      if (!cancelled) setFitted({ from: entries, to });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, videoId, entries, seconds]);
  return enabled && fitted?.from === entries ? fitted.to : entries;
}
