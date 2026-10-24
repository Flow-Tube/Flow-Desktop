import { useEffect } from "react";

import type { SongItem } from "../../types/music";
import type { LyricsRequest } from "./lyricsHelper";
import { EMPTY_LYRICS, useLyricsStore, type LyricsView } from "../../store/useLyricsStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";

// A song without a listed duration waits this long for the audio element's before looking up.
const AUDIO_DURATION_WAIT_MS = 3000;

const videoIdOf = (t: SongItem): string => t.videoId ?? t.id;

export function lyricsRequestFor(track: SongItem, durationSec: number): LyricsRequest {
  return {
    videoId: videoIdOf(track),
    title: track.title,
    // Catalogues file a song under its first credited artist; the joined list matches none of them.
    artist: track.artists.find((a) => a.name)?.name ?? "",
    durationSec: Math.round(durationSec),
    album: track.album?.name ?? null,
  };
}

/**
 * Starts the lyrics lookup when a song starts, so lyrics are usually ready by the time they are
 * opened. Mount once. It follows the player store without re-rendering its host.
 */
export function useLyricsLookup(): void {
  useEffect(() => {
    let currentId: string | null = null;
    let waiting: SongItem | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const start = (track: SongItem, durationSec: number) => {
      waiting = null;
      if (timer) clearTimeout(timer);
      timer = null;
      useLyricsStore.getState().load(lyricsRequestFor(track, durationSec));
    };

    const follow = (state: ReturnType<typeof useMusicPlayerStore.getState>) => {
      const track = state.currentTrack;
      const id = track ? videoIdOf(track) : null;
      if (id !== currentId) {
        currentId = id;
        waiting = null;
        if (timer) clearTimeout(timer);
        timer = null;
        if (!track) {
          useLyricsStore.getState().clear();
        } else if ((track.duration ?? 0) > 0) {
          start(track, track.duration ?? 0);
        } else {
          waiting = track;
          timer = setTimeout(() => start(track, useMusicPlayerStore.getState().duration), AUDIO_DURATION_WAIT_MS);
        }
      } else if (waiting && state.duration > 0) {
        start(waiting, state.duration);
      }
    };

    follow(useMusicPlayerStore.getState());
    const unsubscribe = useMusicPlayerStore.subscribe(follow);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}

/** The lyrics of `track`, as found by the lookup `useLyricsLookup` started. */
export function useLyrics(track: SongItem | null): LyricsView & { refresh: () => void } {
  const state = useLyricsStore();
  const refresh = state.refresh;
  if (!track) return { ...EMPTY_LYRICS, refresh };
  if (state.videoId !== videoIdOf(track)) return { ...EMPTY_LYRICS, loading: true, refresh };
  return {
    entries: state.entries,
    plain: state.plain,
    isSynced: state.isSynced,
    providerName: state.providerName,
    source: state.source,
    loading: state.loading,
    refresh,
  };
}
