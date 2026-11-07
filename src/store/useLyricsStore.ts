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
import { clearSyncOffset, saveSyncOffset, savedSyncOffset } from "../lib/lyrics/syncOffsets";
import { isAbortError } from "../lib/lyrics/inFlight";
import { entriesAreSynced, lyricsQuality } from "../lib/lyrics/sync";
import { getString } from "../lib/i18n/index";
import { isLocalMediaId } from "../lib/localMediaId";

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
  /** Positive shows the lines sooner. Kept for each song once the user nudges it. */
  syncOffsetMs: number;
  /** The offset a downloaded song's `.lrc` file asked for, which goes with its lyrics. */
  fileOffsetMs: number;
  showSyncControls: boolean;
  candidates: LyricsCandidate[];
  isBrowsing: boolean;
  /** `onSettled` runs once this song's lookup has ended, unless another took its place. */
  load: (request: LyricsRequest, onSettled?: () => void) => void;
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

/** A new song starts from the offset the user saved for it, if any. */
const sessionFor = (videoId: string) => ({ ...SESSION_RESET, syncOffsetMs: savedSyncOffset(videoId) ?? 0 });

/** The offset still follows a downloaded file's own, because nobody nudged it. */
const followsFile = (videoId: string, current: { syncOffsetMs: number; fileOffsetMs: number }) =>
  savedSyncOffset(videoId) === null && current.syncOffsetMs === current.fileOffsetMs;

/** Saved lyrics, with their file's offset as the starting nudge unless one was already set. */
function offlineView(videoId: string, lyrics: OfflineLyrics, current: { syncOffsetMs: number; fileOffsetMs: number }) {
  const untouched = followsFile(videoId, current);
  return {
    ...viewOf({ entries: lyrics.entries, provider: lyrics.provider }),
    fileOffsetMs: lyrics.offsetMs,
    ...(untouched ? { syncOffsetMs: lyrics.offsetMs } : {}),
  };
}

export const useLyricsStore = create<LyricsStore>((set, get) => {
  const run = (request: LyricsRequest, onSettled?: () => void) => {
    lookup?.abort();
    browse?.abort();
    const controller = new AbortController();
    lookup = controller;
    const offline = getOfflineLyrics(request.videoId);
    // As on Android, a file's own lyrics are all it gets: its name never goes to a provider.
    if (isLocalMediaId(request.videoId)) {
      lookup = null;
      const session = sessionFor(request.videoId);
      set({
        videoId: request.videoId,
        request,
        ...session,
        ...(offline ? offlineView(request.videoId, offline, session) : EMPTY_LYRICS),
      });
      onSettled?.();
      return;
    }
    const choice = getLyricsSourceChoice(request.videoId);
    const showSaved = offline !== null && choice !== "online";
    const sameSong = get().videoId === request.videoId;
    const session = sameSong ? get() : sessionFor(request.videoId);
    set({
      videoId: request.videoId,
      request,
      ...(sameSong ? {} : session),
      ...(showSaved ? offlineView(request.videoId, offline, session) : { ...EMPTY_LYRICS, loading: true }),
    });
    // The user chose the copy saved with the download: no lookup at all.
    if (showSaved && choice === "downloaded") {
      lookup = null;
      onSettled?.();
      return;
    }

    const present = (result: LyricsResult | null) => {
      const shown = get();
      if (result && result.entries === shown.entries) {
        if (shown.loading) set({ loading: false });
        return;
      }
      // Lyrics saved with a download stay unless the providers found something better.
      if (shown.providerName === OFFLINE_PROVIDER && lyricsQuality(result?.entries ?? []) <= lyricsQuality(shown.entries)) {
        return;
      }
      // The file's offset belonged to the saved lyrics, not to the ones replacing them.
      const offset = followsFile(request.videoId, shown) ? { syncOffsetMs: 0, fileOffsetMs: 0 } : { fileOffsetMs: 0 };
      set({ ...(result ? viewOf(result) : EMPTY_LYRICS), ...(shown.providerName === OFFLINE_PROVIDER ? offset : {}) });
    };

    getLyrics(request, controller.signal, (answer) => {
      if (lookup === controller) present(answer);
    }).then(
      (result) => {
        if (lookup !== controller) return;
        lookup = null;
        present(result);
        onSettled?.();
      },
      (error: unknown) => {
        if (lookup !== controller || isAbortError(error)) return;
        lookup = null;
        const saved = getOfflineLyrics(request.videoId);
        set((s) => (s.providerName === OFFLINE_PROVIDER ? {} : saved ? offlineView(request.videoId, saved, s) : { ...EMPTY_LYRICS }));
        onSettled?.();
      },
    );
  };

  // The timing nudge stays: it belongs to the song, not to one source's lyrics.
  const showManual = (entries: LyricsEntry[], providerName: string) => {
    const { videoId } = get();
    if (!videoId || entries.length === 0) return;
    lookup?.abort();
    lookup = null;
    applyManualLyrics(videoId, entries);
    set(viewOf({ entries, provider: providerName }));
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
    adjustSyncOffset: (deltaMs) => {
      const { videoId, syncOffsetMs } = get();
      const next = Math.max(-MAX_SYNC_OFFSET_MS, Math.min(MAX_SYNC_OFFSET_MS, syncOffsetMs + deltaMs));
      set({ syncOffsetMs: next });
      if (videoId) saveSyncOffset(videoId, next);
    },
    resetSyncOffset: () => {
      const { videoId } = get();
      set({ syncOffsetMs: 0 });
      if (videoId) clearSyncOffset(videoId);
    },
    setShowSyncControls: (show) => set({ showSyncControls: show }),
    browseCandidates: () => {
      const { request } = get();
      if (!request || isLocalMediaId(request.videoId)) return;
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
        set((s) => ({ ...offlineView(videoId, saved, s), loading: false }));
        return;
      }
      if (saved) setLyricsSourceChoice(videoId, "online");
      showManual(candidate.entries, candidate.providerName);
    },
    applyEdited: (text) => {
      const { videoId } = get();
      if (videoId && getOfflineLyrics(videoId)) setLyricsSourceChoice(videoId, "online");
      showManual(parseOfflineLyrics(text), getString("lyrics_source_edited"));
    },
  };
});

onOfflineLyrics((videoId, lyrics) => {
  const state = useLyricsStore.getState();
  if (state.videoId !== videoId) return;
  if (isLocalMediaId(videoId)) {
    useLyricsStore.setState(offlineView(videoId, lyrics, state));
    return;
  }
  const choice = getLyricsSourceChoice(videoId);
  if (choice === "downloaded") {
    lookup?.abort();
    lookup = null;
    useLyricsStore.setState({ ...offlineView(videoId, lyrics, state), loading: false });
    return;
  }
  // With the providers chosen, the saved copy only fills in when they found nothing.
  if (choice === "online" && (state.loading || state.entries.length > 0)) return;
  if (lyricsQuality(lyrics.entries) <= lyricsQuality(state.entries)) return;
  useLyricsStore.setState(offlineView(videoId, lyrics, state));
});
