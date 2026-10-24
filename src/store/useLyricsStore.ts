import { create } from "zustand";

import type { LyricsEntry, LyricsResult } from "../lib/lyrics/types";
import { forceRefresh, getLyrics, type LyricsRequest } from "../lib/lyrics/lyricsHelper";
import { getOfflineLyrics, onOfflineLyrics } from "../lib/lyrics/offline";
import { isAbortError } from "../lib/lyrics/inFlight";
import { entriesAreSynced, lyricsQuality } from "../lib/lyrics/sync";

export interface LyricsView {
  entries: LyricsEntry[];
  /** The text of unsynced lyrics, one line per row. */
  plain: string | null;
  isSynced: boolean;
  providerName: string;
  /** The credit the lyrics' source asks to be shown, such as "Source: Musixmatch". */
  source: string | null;
  loading: boolean;
}

interface LyricsStore extends LyricsView {
  /** The song these lyrics belong to. */
  videoId: string | null;
  request: LyricsRequest | null;
  load: (request: LyricsRequest) => void;
  refresh: () => void;
  clear: () => void;
}

export const EMPTY_LYRICS: LyricsView = {
  entries: [],
  plain: null,
  isSynced: false,
  providerName: "",
  source: null,
  loading: false,
};

const OFFLINE_PROVIDER = "Downloaded";

function viewOf(result: LyricsResult): LyricsView {
  const synced = entriesAreSynced(result.entries);
  return {
    entries: result.entries,
    plain: synced ? null : result.entries.map((e) => e.text).join("\n"),
    isSynced: synced,
    providerName: result.provider,
    source: result.source ?? null,
    loading: false,
  };
}

let lookup: AbortController | null = null;

export const useLyricsStore = create<LyricsStore>((set, get) => {
  const run = (request: LyricsRequest) => {
    lookup?.abort();
    const controller = new AbortController();
    lookup = controller;
    const offline = getOfflineLyrics(request.videoId);
    set({
      videoId: request.videoId,
      request,
      ...(offline ? viewOf({ entries: offline, provider: OFFLINE_PROVIDER }) : { ...EMPTY_LYRICS, loading: true }),
    });

    getLyrics(request, controller.signal).then(
      (result) => {
        if (lookup !== controller) return;
        lookup = null;
        const shown = get();
        // Lyrics saved with a download stay unless the providers found something better.
        if (shown.providerName === OFFLINE_PROVIDER && lyricsQuality(result?.entries ?? []) <= lyricsQuality(shown.entries)) {
          return;
        }
        set(result ? viewOf(result) : { ...EMPTY_LYRICS });
      },
      (error: unknown) => {
        if (lookup !== controller || isAbortError(error)) return;
        lookup = null;
        set((s) => (s.providerName === OFFLINE_PROVIDER ? {} : { ...EMPTY_LYRICS }));
      },
    );
  };

  return {
    ...EMPTY_LYRICS,
    videoId: null,
    request: null,
    load: run,
    refresh: () => {
      const { request } = get();
      if (!request) return;
      forceRefresh(request.videoId);
      run(request);
    },
    clear: () => {
      lookup?.abort();
      lookup = null;
      set({ ...EMPTY_LYRICS, videoId: null, request: null });
    },
  };
});

onOfflineLyrics((videoId, entries) => {
  const state = useLyricsStore.getState();
  if (state.videoId !== videoId || lyricsQuality(entries) <= lyricsQuality(state.entries)) return;
  useLyricsStore.setState(viewOf({ entries, provider: OFFLINE_PROVIDER }));
});
