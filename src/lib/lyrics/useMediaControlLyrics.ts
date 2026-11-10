import { useEffect, useMemo } from "react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useLyricsStore } from "../../store/useLyricsStore";
import { musicAudioEngine } from "../audio/musicAudioEngine";
import { refreshMediaSession } from "../mediaSessionArbiter";
import { getString } from "../i18n/index";
import { SETTINGS } from "../settings/schema";
import { useBoolPref, useNumberPref } from "../usePreference";
import { MEDIA_LYRICS_DELAY, MediaLyricTimeline } from "./sessionTimeline";
import { useVideoFittedLyrics } from "./videoTiming";
import type { LyricsEntry } from "./types";

const NO_LINES: LyricsEntry[] = [];
const MIN_WAIT_MS = 50;
/** A clock jump bigger than timeupdate's steps is a seek, so the line is worked out again. */
const SEEK_JUMP_SEC = 1.5;

let currentLine: string | null = null;

/** The lyric line the media controls show as the title, or null for the song's own title. */
export const mediaControlLyricLine = (): string | null => currentLine;

/**
 * Port of Android's SessionLyrics: keeps the system media controls' title on the current lyric
 * line while Lyrics in media controls is on. It waits for each next line rather than polling, and
 * uses the lyrics the player shows, with their timing nudge and the setting's own timing. Mount once.
 */
export function useMediaControlLyrics(): void {
  const [enabled] = useBoolPref(SETTINGS.LYRICS_IN_MEDIA_CONTROLS);
  const [delayMs] = useNumberPref(SETTINGS.LYRICS_IN_MEDIA_CONTROLS_DELAY_MS);
  const track = useMusicPlayerStore((s) => s.currentTrack);
  const audioDuration = useMusicPlayerStore((s) => s.duration);
  const videoId = track ? track.videoId ?? track.id : null;
  const lyricsId = useLyricsStore((s) => s.videoId);
  const isSynced = useLyricsStore((s) => s.isSynced);
  const entries = useLyricsStore((s) => s.entries);
  const syncOffsetMs = useLyricsStore((s) => s.syncOffsetMs);
  const shown = enabled && videoId !== null && lyricsId === videoId && isSynced ? entries : NO_LINES;
  const fitted = useVideoFittedLyrics(videoId, shown, track?.duration || audioDuration);
  const delay = MEDIA_LYRICS_DELAY.snap(delayMs);

  const timeline = useMemo(
    () =>
      fitted.length > 0
        ? new MediaLyricTimeline(fitted, syncOffsetMs - delay, (line, count) => getString("media_lyric_repeated", line, count))
        : null,
    [fitted, syncOffsetMs, delay],
  );

  useEffect(() => {
    const show = (line: string | null) => {
      if (line === currentLine) return;
      currentLine = line;
      refreshMediaSession("music");
    };
    if (!timeline) {
      show(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const position = musicAudioEngine.getCurrentTime() * 1000;
      show(timeline.lineAt(position));
      if (!useMusicPlayerStore.getState().isPlaying) return;
      const next = timeline.nextChangeAfter(position);
      if (next === null) return;
      timer = setTimeout(update, Math.max(MIN_WAIT_MS, (next - position) / musicAudioEngine.getSpeed()));
    };
    update();
    const unsubscribe = useMusicPlayerStore.subscribe((state, previous) => {
      if (state.isPlaying !== previous.isPlaying || Math.abs(state.progress - previous.progress) > SEEK_JUMP_SEC) update();
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      show(null);
    };
  }, [timeline]);
}
