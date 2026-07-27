import { useCallback, useEffect, useRef, useState } from "react";

import type { SongItem } from "../../types/music";
import type { LyricsEntry } from "./types";
import { getLyrics, forceRefresh } from "./lyricsHelper";
import { getOfflineLyrics } from "./offline";
import { entriesAreSynced } from "./sync";

interface LyricsState {
  entries: LyricsEntry[];
  plain: string | null;
  isSynced: boolean;
  providerName: string;
  loading: boolean;
}

const EMPTY: LyricsState = {
  entries: [],
  plain: null,
  isSynced: false,
  providerName: "",
  loading: false,
};

const videoIdOf = (t: SongItem): string => t.videoId ?? t.id;
const artistsOf = (t: SongItem): string => t.artists.map((a) => a.name).filter(Boolean).join(", ");

/** Resolves lyrics for the current track via the provider fallback chain. */
export function useLyrics(track: SongItem | null) {
  const [state, setState] = useState<LyricsState>(EMPTY);
  const reqRef = useRef(0);

  const load = useCallback(
    async (t: SongItem) => {
      const req = ++reqRef.current;
      const videoId = videoIdOf(t);
      setState((s) => ({ ...s, loading: true }));
      try {
        const result = await getLyrics(
          videoId,
          t.title,
          artistsOf(t),
          t.duration ?? 0,
          t.album?.name ?? null,
        );
        if (reqRef.current !== req) return;
        if (!result) {
          setState({ ...EMPTY });
          return;
        }
        const synced = entriesAreSynced(result.entries);
        setState({
          entries: result.entries,
          plain: synced ? null : result.entries.map((e) => e.text).join("\n"),
          isSynced: synced,
          providerName: result.provider,
          loading: false,
        });
      } catch {
        if (reqRef.current === req) setState({ ...EMPTY });
      }
    },
    [],
  );

  useEffect(() => {
    if (!track) {
      reqRef.current++;
      setState({ ...EMPTY });
      return;
    }
    // Show lyrics saved with a download immediately instead of making an offline
    // listener wait out the whole provider chain. `load` keeps these visible
    // while it runs, and a synced result still replaces them if one arrives.
    const offline = getOfflineLyrics(videoIdOf(track));
    if (offline) {
      setState({
        entries: offline,
        plain: offline.map((entry) => entry.text).join("\n"),
        isSynced: false,
        providerName: "Downloaded",
        loading: true,
      });
    }
    void load(track);
  }, [track, load]);

  const refresh = useCallback(() => {
    if (!track) return;
    forceRefresh(videoIdOf(track));
    void load(track);
  }, [track, load]);

  return { ...state, refresh };
}
