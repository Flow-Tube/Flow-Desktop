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
import {
  getOfflineLyrics,
  OFFLINE_LYRICS_PROVIDER,
  onOfflineLyrics,
  parseOfflineLyrics,
  type OfflineLyrics,
} from "../lib/lyrics/offline";
import { getLyricsSourceChoice, setLyricsSourceChoice } from "../lib/lyrics/sourceChoice";
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
  /** The offset a downloaded song's `.lrc` file asked for, which goes with its lyrics. */
  fileOffsetMs: number;
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

const OFFLINE_PROVIDER = OFFLINE_LYRICS_PROVIDER;

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

const SESSION_RESET = { syncOffsetMs: 0, fileOffsetMs: 0, showSyncControls: false, candidates: [], isBrowsing: false };

/** Saved lyrics, with their file's offset as the starting nudge unless one was already set. */
function offlineView(lyrics: OfflineLyrics, current: { syncOffsetMs: number; fileOffsetMs: number }) {
  const untouched = current.syncOffsetMs === current.fileOffsetMs;
  return {
    ...viewOf({ entries: lyrics.entries, provider: OFFLINE_PROVIDER }),
    fileOffsetMs: lyrics.offsetMs,
    ...(untouched ? { syncOffsetMs: lyrics.offsetMs } : {}),
  };
}

export const useLyricsStore = create<LyricsStore>((set, get) => {
  const run = (request: LyricsRequest) => {
    lookup?.abort();
    browse?.abort();
    const controller = new AbortController();
    lookup = controller;
    const offline = getOfflineLyrics(request.videoId);
    const choice = getLyricsSourceChoice(request.videoId);
    const showSaved = offline !== null && choice !== "online";
    const sameSong = get().videoId === request.videoId;
    const session = sameSong ? get() : SESSION_RESET;
    set({
      videoId: request.videoId,
      request,
      ...(sameSong ? {} : SESSION_RESET),
      ...(showSaved ? offlineView(offline, session) : { ...EMPTY_LYRICS, loading: true }),
    });
    // The user chose the copy saved with the download: no lookup at all.
    if (showSaved && choice === "downloaded") {
      lookup = null;
      return;
    }

    getLyrics(request, controller.signal).then(
      (result) => {
        if (lookup !== controller) return;
        lookup = null;
        const shown = get();
        // Lyrics saved with a download stay unless the providers found something better.
        if (shown.providerName === OFFLINE_PROVIDER && lyricsQuality(result?.entries ?? []) <= lyricsQuality(shown.entries)) {
          return;
        }
        // The file's offset belonged to the saved lyrics, not to the ones replacing them.
        const offset = shown.syncOffsetMs === shown.fileOffsetMs ? { syncOffsetMs: 0, fileOffsetMs: 0 } : { fileOffsetMs: 0 };
        set({ ...(result ? viewOf(result) : EMPTY_LYRICS), ...(shown.providerName === OFFLINE_PROVIDER ? offset : {}) });
      },
      (error: unknown) => {
        if (lookup !== controller || isAbortError(error)) return;
        lookup = null;
        const saved = getOfflineLyrics(request.videoId);
        set((s) => (s.providerName === OFFLINE_PROVIDER ? {} : saved ? offlineView(saved, s) : { ...EMPTY_LYRICS }));
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
      // A refresh asks the providers again, so the song goes back to choosing automatically.
      setLyricsSourceChoice(request.videoId, null);
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
      // The copy saved with the download is always offered first, next to every provider.
      const saved = getOfflineLyrics(request.videoId);
      set({
        isBrowsing: true,
        candidates: saved
          ? [{ providerName: OFFLINE_PROVIDER, entries: saved.entries, synced: entriesAreSynced(saved.entries) }]
          : [],
      });
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
    applyCandidate: (candidate) => {
      const { videoId } = get();
      if (!videoId) return;
      const saved = getOfflineLyrics(videoId);
      if (candidate.providerName === OFFLINE_PROVIDER) {
        if (!saved) return;
        lookup?.abort();
        lookup = null;
        setLyricsSourceChoice(videoId, "downloaded");
        set((s) => ({ ...offlineView(saved, s), loading: false }));
        return;
      }
      if (saved) setLyricsSourceChoice(videoId, "online");
      showManual(candidate.entries, candidate.providerName, false);
    },
    // An edit keeps the timing nudge: it was most likely made to match it.
    applyEdited: (text) => {
      const { videoId } = get();
      if (videoId && getOfflineLyrics(videoId)) setLyricsSourceChoice(videoId, "online");
      showManual(parseOfflineLyrics(text), getString("lyrics_source_edited"), true);
    },
  };
});

onOfflineLyrics((videoId, lyrics) => {
  const state = useLyricsStore.getState();
  if (state.videoId !== videoId) return;
  const choice = getLyricsSourceChoice(videoId);
  if (choice === "downloaded") {
    lookup?.abort();
    lookup = null;
    useLyricsStore.setState({ ...offlineView(lyrics, state), loading: false });
    return;
  }
  // With the providers chosen, the saved copy only fills in when they found nothing.
  if (choice === "online" && (state.loading || state.entries.length > 0)) return;
  if (lyricsQuality(lyrics.entries) <= lyricsQuality(state.entries)) return;
  useLyricsStore.setState(offlineView(lyrics, state));
});
