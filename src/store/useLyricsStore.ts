import { create } from "zustand";

import type { LyricsEntry, LyricsResult } from "../lib/lyrics/types";
import {
  applyManualLyrics,
  forceRefresh,
  getAllLyrics,
  getLyrics,
  type LyricsCandidate,
  type LyricsRequest,
} from "../lib/lyrics/lyricsHelper";
import { getOfflineLyrics, onOfflineLyrics, parseOfflineLyrics } from "../lib/lyrics/offline";
import { isAbortError } from "../lib/lyrics/inFlight";
import { entriesAreSynced, lyricsQuality } from "../lib/lyrics/sync";
import { getString } from "../lib/i18n/index";

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

/** The lyrics timing nudge is clamped to half a minute either way, as on Android. */
export const MAX_SYNC_OFFSET_MS = 30_000;

interface LyricsStore extends LyricsView {
  /** The song these lyrics belong to. */
  videoId: string | null;
  request: LyricsRequest | null;
  /** Positive shows the lines sooner. Reset for every song. */
  syncOffsetMs: number;
  showSyncControls: boolean;
  candidates: LyricsCandidate[];
  isBrowsing: boolean;
  load: (request: LyricsRequest) => void;
  refresh: () => void;
  clear: () => void;
  adjustSyncOffset: (deltaMs: number) => void;
  resetSyncOffset: () => void;
  setShowSyncControls: (show: boolean) => void;
  browseCandidates: () => void;
  cancelBrowse: () => void;
  applyCandidate: (candidate: LyricsCandidate) => void;
  applyEdited: (text: string) => void;
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
let browse: AbortController | null = null;

const SESSION_RESET = { syncOffsetMs: 0, showSyncControls: false, candidates: [], isBrowsing: false };

export const useLyricsStore = create<LyricsStore>((set, get) => {
  const run = (request: LyricsRequest) => {
    lookup?.abort();
    browse?.abort();
    const controller = new AbortController();
    lookup = controller;
    const offline = getOfflineLyrics(request.videoId);
    set({
      videoId: request.videoId,
      request,
      ...(get().videoId === request.videoId ? {} : SESSION_RESET),
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

  const showManual = (entries: LyricsEntry[], providerName: string, keepOffset: boolean) => {
    const { videoId } = get();
    if (!videoId || entries.length === 0) return;
    lookup?.abort();
    lookup = null;
    applyManualLyrics(videoId, entries);
    set({ ...viewOf({ entries, provider: providerName }), ...(keepOffset ? {} : { syncOffsetMs: 0 }) });
  };

  return {
    ...EMPTY_LYRICS,
    ...SESSION_RESET,
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
      browse?.abort();
      browse = null;
      set({ ...EMPTY_LYRICS, ...SESSION_RESET, videoId: null, request: null });
    },
    adjustSyncOffset: (deltaMs) =>
      set((s) => ({
        syncOffsetMs: Math.max(-MAX_SYNC_OFFSET_MS, Math.min(MAX_SYNC_OFFSET_MS, s.syncOffsetMs + deltaMs)),
      })),
    resetSyncOffset: () => set({ syncOffsetMs: 0 }),
    setShowSyncControls: (show) => set({ showSyncControls: show }),
    browseCandidates: () => {
      const { request } = get();
      if (!request) return;
      browse?.abort();
      const controller = new AbortController();
      browse = controller;
      set({ isBrowsing: true, candidates: [] });
      void getAllLyrics(
        request,
        (candidate) => {
          if (browse === controller) set((s) => ({ candidates: [...s.candidates, candidate] }));
        },
        controller.signal,
      ).finally(() => {
        // Only the browse that is still current may clear the flag.
        if (browse === controller) {
          browse = null;
          set({ isBrowsing: false });
        }
      });
    },
    cancelBrowse: () => {
      browse?.abort();
      browse = null;
      set({ isBrowsing: false });
    },
    applyCandidate: (candidate) => showManual(candidate.entries, candidate.providerName, false),
    // An edit keeps the timing nudge: it was most likely made to match it.
    applyEdited: (text) => showManual(parseOfflineLyrics(text), getString("lyrics_source_edited"), true),
  };
});

onOfflineLyrics((videoId, entries) => {
  const state = useLyricsStore.getState();
  if (state.videoId !== videoId || lyricsQuality(entries) <= lyricsQuality(state.entries)) return;
  useLyricsStore.setState(viewOf({ entries, provider: OFFLINE_PROVIDER }));
});
