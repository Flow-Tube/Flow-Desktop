import { create } from "zustand";

import type { MusicStreamInfo, SongItem } from "../types/music";
import {
  getMusicQueueContinuation,
  getMusicWatchQueue,
  rankMusicCandidates,
  type MusicAudioQuality,
} from "../lib/api/music";
import { getOfflineStream } from "../lib/api/downloads";
import {
  invalidateMusicStream,
  prefetchMusicStream,
  resolveMusicStream,
} from "../lib/musicStreamResolution";
import { seedOfflineLyrics } from "../lib/lyrics/offline";
import { findDownloadedRecord } from "../lib/useDownloads";
import { useDownloadsLibraryStore } from "./useDownloadsLibraryStore";
import { normalizeBackendError } from "../lib/api/errors";
import { recordPlayerEvent } from "../lib/playerDiagnostics";
import { musicAudioEngine } from "../lib/audio/musicAudioEngine";
import { SETTINGS } from "../lib/settings/schema";
import {
  EQ_FLAT,
  EQ_PRESETS,
  normalizeEqGains,
  type EqPresetName,
} from "../lib/audio/eqBands";
import { getSettingValue } from "./useAppSettingsStore";

export type MusicViewState = "dock" | "full" | "queue" | "lyrics";
export type MusicRepeatMode = "none" | "one" | "all";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const videoIdOf = (track: SongItem): string => track.videoId ?? track.id;

// --- persistence ---

const PERSIST_KEY = "flow_music_player";

interface PersistedMusicConfig {
  volume: number;
  isMuted: boolean;
  eqEnabled: boolean;
  eqGains: number[];
  normalizationEnabled: boolean;
  repeatMode: MusicRepeatMode;
  isShuffle: boolean;
  radioEnabled: boolean;
}

const DEFAULT_CONFIG: PersistedMusicConfig = {
  volume: 1,
  isMuted: false,
  eqEnabled: false,
  eqGains: [...EQ_FLAT],
  normalizationEnabled: true,
  repeatMode: "none",
  isShuffle: false,
  radioEnabled: true,
};

const loadConfig = (): PersistedMusicConfig => {
  try {
    const saved = localStorage.getItem(PERSIST_KEY);
    if (!saved) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(saved) as Partial<PersistedMusicConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      volume: clamp01(parsed.volume ?? DEFAULT_CONFIG.volume),
      eqGains: normalizeEqGains(parsed.eqGains),
    };
  } catch (error) {
    console.warn("Failed to load saved music player config", error);
    return { ...DEFAULT_CONFIG };
  }
};

const initialConfig = loadConfig();

const saveConfig = (get: () => MusicPlayerState) => {
  try {
    const s = get();
    const config: PersistedMusicConfig = {
      volume: s.volume,
      isMuted: s.isMuted,
      eqEnabled: s.eqEnabled,
      eqGains: s.eqGains,
      normalizationEnabled: s.normalizationEnabled,
      repeatMode: s.repeatMode,
      isShuffle: s.isShuffle,
      radioEnabled: s.radioEnabled,
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn("Failed to save music player config", error);
  }
};

const pickRandomIndex = (length: number, exclude: number): number => {
  if (length <= 1) return 0;
  let next = exclude;
  while (next === exclude) next = Math.floor(Math.random() * length);
  return next;
};

const PLAYBACK_ERROR_FALLBACK = "Playback failed";
const MUSIC_AUDIO_QUALITY_VALUES = new Set(["Auto", "High", "Medium", "Low"]);

// --- radio / autoplay -------------------------------------------------
const RADIO_LOW_WATER = 3;
const RADIO_BATCH = 10;
const RADIO_MAX_PAGES = 4;

let radioContinuation: string | null = null;
let radioPlaylistId: string | null = null;
const radioSessionSeen = new Set<string>();
let radioInFlight: Promise<void> | null = null;

// Hide predicate pushed in by `useMusicActionsStore` (block list). Kept as a module-level
// ref so radio autoplay can consult it without the store importing the actions store.
let hiddenPredicate: (track: SongItem) => boolean = () => false;

const resetRadioSession = (seedIds: string[] = []) => {
  radioContinuation = null;
  radioPlaylistId = null;
  radioInFlight = null;
  radioSessionSeen.clear();
  for (const id of seedIds) radioSessionSeen.add(id);
};

const stationIdFor = (videoId: string): string => `RDAMVM${videoId}`;

const isPlayableAudio = (s: SongItem): boolean => {
  const vt = s.musicVideoType;
  const isVideoSong = !!vt && vt !== "MUSIC_VIDEO_TYPE_ATV";
  const dur = s.duration ?? 0;
  const okDuration = dur === 0 || (dur >= 30 && dur <= 1200);
  return !isVideoSong && okDuration && !!(s.videoId ?? s.id);
};

const getMusicAudioQualitySetting = (): MusicAudioQuality => {
  const value = getSettingValue(SETTINGS.MUSIC_AUDIO_QUALITY);
  return MUSIC_AUDIO_QUALITY_VALUES.has(value) ? (value as MusicAudioQuality) : "Auto";
};

interface MusicPlayerState {
  // --- now playing ---
  currentTrack: SongItem | null;
  queue: SongItem[];
  currentIndex: number;
  isPlaying: boolean;
  progress: number; // seconds
  duration: number; // seconds
  isBuffering: boolean;

  // --- audio config (persisted) ---
  volume: number; // 0..1
  isMuted: boolean;
  loudnessDb: number | null;
  normalizationEnabled: boolean;
  eqEnabled: boolean;
  eqGains: number[]; // 10 bands, dB

  // --- modes (persisted) ---
  repeatMode: MusicRepeatMode;
  isShuffle: boolean;
  radioEnabled: boolean; // autoplay similar music when the queue runs out

  // --- radio / autoplay ---
  radioLoading: boolean;
  radioQueuedIds: string[];

  // --- overlay / surface ---
  viewState: MusicViewState;

  // --- stream resolution ---
  loadingStreamId: string | null;
  streamError: string | null;
  streamErrorKind: string | null;

  // --- intents (called by UI) ---
  playTrack: (track: SongItem) => Promise<void>;
  playQueue: (tracks: SongItem[], startIndex?: number) => Promise<void>;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  dismiss: () => void;
  retryCurrentTrack: () => void;
  clearStreamError: () => void;

  setVolume: (volume: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  toggleRadio: () => void;
  startRadio: (seed?: SongItem) => Promise<void>;

  addToQueue: (track: SongItem) => void;
  playNextInQueue: (track: SongItem) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  clearQueue: () => void;

  // --- block list integration (driven by useMusicActionsStore) ---
  setHiddenPredicate: (predicate: (track: SongItem) => boolean) => void;
  pruneQueue: (shouldRemove: (track: SongItem) => boolean) => void;

  setViewState: (view: MusicViewState) => void;
  openOverlay: (view?: Exclude<MusicViewState, "dock">) => void;
  closeOverlay: () => void;

  setEqEnabled: (enabled: boolean) => void;
  setEqBand: (index: number, gainDb: number) => void;
  setEqGains: (gains: number[]) => void;
  applyEqPreset: (name: EqPresetName) => void;
  setNormalizationEnabled: (enabled: boolean) => void;

  // --- internal: driven by the root <audio> controller (element → store) ---
  _ensureRadio: () => Promise<void>;
  _loadIndex: (index: number) => Promise<void>;
  _prefetchUpcoming: () => void;
  _syncTime: (progress: number, duration: number) => void;
  _reflectPlaying: (isPlaying: boolean) => void;
  _setBuffering: (isBuffering: boolean) => void;
  handleEnded: () => void;
  _onPlaybackError: () => void;
}

export const useMusicPlayerStore = create<MusicPlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  progress: 0,
  duration: 0,
  isBuffering: false,

  volume: initialConfig.volume,
  isMuted: initialConfig.isMuted,
  loudnessDb: null,
  normalizationEnabled: initialConfig.normalizationEnabled,
  eqEnabled: initialConfig.eqEnabled,
  eqGains: initialConfig.eqGains,

  repeatMode: initialConfig.repeatMode,
  isShuffle: initialConfig.isShuffle,
  radioEnabled: initialConfig.radioEnabled,
  radioLoading: false,
  radioQueuedIds: [],

  viewState: "dock",

  loadingStreamId: null,
  streamError: null,
  streamErrorKind: null,

  // --- intents ----------------------------------------------------------

  playTrack: async (track) => {
    resetRadioSession([videoIdOf(track)]);
    set({ queue: [track], radioQueuedIds: [] });
    await get()._loadIndex(0);
  },

  playQueue: async (tracks, startIndex = 0) => {
    if (tracks.length === 0) return;
    resetRadioSession(tracks.map(videoIdOf));
    set({ queue: tracks, radioQueuedIds: [] });
    await get()._loadIndex(Math.max(0, Math.min(startIndex, tracks.length - 1)));
  },

  _ensureRadio: async () => {
    if (radioInFlight) return radioInFlight;
    const { queue, currentIndex, radioEnabled, isShuffle } = get();
    if (!radioEnabled || isShuffle) return;
    if (queue.length - 1 - currentIndex > RADIO_LOW_WATER) return;

    const seed = queue[queue.length - 1] ?? get().currentTrack;
    if (!seed) return;

    radioInFlight = (async () => {
      set({ radioLoading: true });
      try {
        const seedId = videoIdOf(seed);
        const collected: SongItem[] = [];

        for (let page = 0; page < RADIO_MAX_PAGES && collected.length < RADIO_BATCH; page++) {
          let result: Awaited<ReturnType<typeof getMusicWatchQueue>>;
          if (radioContinuation) {
            result = await getMusicQueueContinuation(radioContinuation);
          } else {
            result = await getMusicWatchQueue(seedId, radioPlaylistId ?? stationIdFor(seedId));
          }
          radioContinuation = result.continuation;
          if (result.radioPlaylistId) radioPlaylistId = result.radioPlaylistId;

          const seen = new Set([
            ...get().queue.map(videoIdOf),
            ...collected.map(videoIdOf),
          ]);
          for (const t of result.items) {
            const id = videoIdOf(t);
            if (isPlayableAudio(t) && !seen.has(id) && !radioSessionSeen.has(id) && !hiddenPredicate(t)) {
              collected.push(t);
              seen.add(id);
            }
          }

          if (!radioContinuation) break;
        }

        const ordered = await rankMusicCandidates(collected, "radio").catch(() => collected);
        const batch = ordered.slice(0, RADIO_BATCH);
        if (batch.length > 0) {
          for (const t of batch) radioSessionSeen.add(videoIdOf(t));
          set({
            queue: [...get().queue, ...batch],
            radioQueuedIds: [...get().radioQueuedIds, ...batch.map(videoIdOf)],
          });
        }
      } catch (error) {
        console.warn("Radio autoplay fetch failed", error);
      } finally {
        set({ radioLoading: false });
        radioInFlight = null;
      }
    })();
    return radioInFlight;
  },

  _loadIndex: async (index) => {
    const track = get().queue[index];
    if (!track) return;
    const videoId = videoIdOf(track);

    set({
      currentTrack: track,
      currentIndex: index,
      progress: 0,
      duration: track.duration ?? 0,
      isPlaying: true,
      isBuffering: true,
      streamError: null,
      streamErrorKind: null,
      loadingStreamId: videoId,
    });
    recordPlayerEvent(`music resolve start: ${videoId}`);

    // Prefetch the radio station ahead of time so the queue never dead-ends.
    void get()._ensureRadio();

    const audioQuality = getMusicAudioQualitySetting();

    try {
      // The downloads library is a SQLite read and resolution is a network round
      // trip; when the library still has to load, overlap the two rather than
      // paying them in sequence. Once loaded the offline check is synchronous,
      // so a saved track still needs no network.
      let streamRequest: Promise<MusicStreamInfo> | null = null;
      if (!useDownloadsLibraryStore.getState().loaded) {
        streamRequest = resolveMusicStream(videoId, audioQuality);
        streamRequest.catch(() => {});
        await useDownloadsLibraryStore.getState().ensureLoaded();
        if (get().loadingStreamId !== videoId) return;
      }

      if (findDownloadedRecord(videoId, "audio")) {
        try {
          const offline = await getOfflineStream(videoId, "music");
          if (get().loadingStreamId !== videoId) return;
          // Cover art and lyrics were saved next to the audio at download time —
          // use them so an offline track needs no network at all to display.
          if (offline.lyrics) seedOfflineLyrics(videoId, offline.lyrics);
          set({
            loudnessDb: null,
            loadingStreamId: null,
            ...(offline.artworkUrl
              ? { currentTrack: { ...track, thumbnail: offline.artworkUrl } }
              : {}),
          });
          musicAudioEngine.setLoudness(null, get().normalizationEnabled);
          await musicAudioEngine.load(offline.url);
          await musicAudioEngine.play();
          get()._prefetchUpcoming();
          return;
        } catch (offlineError) {
          console.warn("Offline track unavailable, falling back to stream", offlineError);
        }
      }

      const info = await (streamRequest ?? resolveMusicStream(videoId, audioQuality));
      if (get().loadingStreamId !== videoId) return;

      set({ loudnessDb: info.loudnessDb, loadingStreamId: null });
      musicAudioEngine.setLoudness(info.loudnessDb, get().normalizationEnabled);
      await musicAudioEngine.load(info.audioUrl);
      await musicAudioEngine.play();
      get()._prefetchUpcoming();
    } catch (e) {
      if (get().loadingStreamId !== videoId) return;
      const normalized = normalizeBackendError(e);
      recordPlayerEvent(`music resolve failed: ${normalized.kind} (${normalized.message})`);
      set({
        streamError: normalized.message,
        streamErrorKind: normalized.kind,
        loadingStreamId: null,
        isPlaying: false,
        isBuffering: false,
      });
    }
  },

  togglePlay: () => {
    if (get().isPlaying) get().pause();
    else get().play();
  },

  play: () => {
    if (!get().currentTrack) return;
    void musicAudioEngine.play();
    set({ isPlaying: true });
  },

  pause: () => {
    musicAudioEngine.pause();
    set({ isPlaying: false });
  },

  // Tear down the player entirely — stops audio, clears the queue, hides the
  // dock/overlay. (The controller flushes a final history record on track clear.)
  dismiss: () => {
    musicAudioEngine.stop();
    resetRadioSession();
    set({
      currentTrack: null,
      queue: [],
      radioQueuedIds: [],
      currentIndex: -1,
      isPlaying: false,
      isBuffering: false,
      progress: 0,
      duration: 0,
      loudnessDb: null,
      loadingStreamId: null,
      streamError: null,
      streamErrorKind: null,
      viewState: "dock",
    });
  },

  // Which track plays next depends on shuffle and repeat, so ask the same
  // question the transport does rather than assuming the following index.
  _prefetchUpcoming: () => {
    const { queue, currentIndex, isShuffle, repeatMode } = get();
    if (queue.length === 0 || currentIndex < 0) return;
    // Shuffle picks its next track at random on advance, so there is nothing to
    // warm; repeat-one replays what is already loaded.
    if (isShuffle || repeatMode === "one") return;

    const nextIndex = currentIndex + 1;
    const upcoming =
      nextIndex < queue.length
        ? queue[nextIndex]
        : repeatMode === "all"
          ? queue[0]
          : null;
    if (!upcoming) return;

    const upcomingId = videoIdOf(upcoming);
    // A downloaded track plays from disk; resolving it would be a wasted request.
    if (findDownloadedRecord(upcomingId, "audio")) return;
    prefetchMusicStream(upcomingId, getMusicAudioQualitySetting());
  },

  retryCurrentTrack: () => {
    const { currentIndex, queue } = get();
    if (currentIndex < 0) return;
    // The retry exists because the resolved URL stopped working, so it must not
    // be handed the same cached answer again.
    const track = queue[currentIndex];
    if (track) invalidateMusicStream(videoIdOf(track));
    set({ streamError: null, streamErrorKind: null });
    recordPlayerEvent(`music retry: index ${currentIndex}`);
    void get()._loadIndex(currentIndex);
  },

  clearStreamError: () => set({ streamError: null, streamErrorKind: null }),

  next: () => {
    const { queue, currentIndex, isShuffle, repeatMode } = get();
    if (queue.length === 0) return;

    let nextIndex: number;
    if (isShuffle && queue.length > 1) {
      nextIndex = pickRandomIndex(queue.length, currentIndex);
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeatMode === "all") {
          nextIndex = 0;
        } else if (get().radioEnabled) {
          void (async () => {
            await get()._ensureRadio();
            const s = get();
            if (s.currentIndex + 1 < s.queue.length) {
              void s._loadIndex(s.currentIndex + 1);
            } else {
              musicAudioEngine.pause();
              set({ isPlaying: false });
            }
          })();
          return;
        } else {
          musicAudioEngine.pause();
          set({ isPlaying: false });
          return;
        }
      }
    }
    void get()._loadIndex(nextIndex);
  },

  previous: () => {
    const { queue, currentIndex, progress, repeatMode } = get();
    if (queue.length === 0) return;
    if (progress > 3) {
      get().seek(0);
      return;
    }
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) prevIndex = repeatMode === "all" ? queue.length - 1 : 0;
    void get()._loadIndex(prevIndex);
  },

  seek: (seconds) => {
    musicAudioEngine.seek(seconds);
    set({ progress: Math.max(0, seconds) });
  },

  setVolume: (volume) => {
    const vol = clamp01(volume);
    musicAudioEngine.setVolume(vol);
    set({ volume: vol, isMuted: vol === 0 ? get().isMuted : false });
    saveConfig(get);
  },

  toggleMute: () => {
    const isMuted = !get().isMuted;
    musicAudioEngine.setMuted(isMuted);
    set({ isMuted });
    saveConfig(get);
  },

  cycleRepeat: () => {
    const order: MusicRepeatMode[] = ["none", "all", "one"];
    const repeatMode = order[(order.indexOf(get().repeatMode) + 1) % order.length];
    set({ repeatMode });
    saveConfig(get);
  },

  toggleShuffle: () => {
    set({ isShuffle: !get().isShuffle });
    saveConfig(get);
  },

  toggleRadio: () => {
    const radioEnabled = !get().radioEnabled;
    set({ radioEnabled });
    saveConfig(get);
    if (radioEnabled) void get()._ensureRadio();
  },

  startRadio: async (seed) => {
    const base = seed ?? get().currentTrack;
    if (!base) return;
    resetRadioSession([videoIdOf(base)]);
    set({ queue: [base], radioQueuedIds: [], currentIndex: 0, radioEnabled: true });
    saveConfig(get);
    await get()._loadIndex(0);
  },

  addToQueue: (track) => {
    const { queue } = get();
    if (queue.some((t) => videoIdOf(t) === videoIdOf(track))) return;
    set({ queue: [...queue, track] });
  },

  playNextInQueue: (track) => {
    const { currentTrack, queue } = get();
    if (!currentTrack) {
      get().addToQueue(track);
      return;
    }

    const currentId = videoIdOf(currentTrack);
    const trackId = videoIdOf(track);
    if (trackId === currentId) return;

    const next = queue.filter((item) => videoIdOf(item) !== trackId);
    let currentIndex = next.findIndex((item) => videoIdOf(item) === currentId);
    if (currentIndex < 0) {
      next.unshift(currentTrack);
      currentIndex = 0;
    }

    next.splice(currentIndex + 1, 0, track);
    set({ queue: next, currentIndex });
  },

  removeFromQueue: (index) => {
    const { queue, currentIndex } = get();
    if (index < 0 || index >= queue.length) return;
    const next = queue.filter((_, i) => i !== index);
    let nextCurrent = currentIndex;
    if (index < currentIndex) nextCurrent = currentIndex - 1;
    set({ queue: next, currentIndex: nextCurrent });
  },

  reorderQueue: (from, to) => {
    const { queue, currentIndex } = get();
    if (from === to) return;
    if (from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
    if (from <= currentIndex || to <= currentIndex) return;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    set({ queue: next });
  },

  clearQueue: () => {
    const { currentTrack, currentIndex } = get();
    if (currentTrack) set({ queue: [currentTrack], currentIndex: 0 });
    else set({ queue: [], currentIndex: -1 });
    void currentIndex;
  },

  setHiddenPredicate: (predicate) => {
    hiddenPredicate = predicate;
  },

  pruneQueue: (shouldRemove) => {
    const { queue, currentIndex } = get();
    if (queue.length === 0) return;
    // Never yank the track that's playing; drop the rest that are now hidden.
    const current = queue[currentIndex];
    const kept = queue.filter((track, i) => i === currentIndex || !shouldRemove(track));
    if (kept.length === queue.length) return;
    const nextIndex = current ? Math.max(0, kept.indexOf(current)) : Math.min(currentIndex, kept.length - 1);
    set({ queue: kept, currentIndex: nextIndex });
  },

  setViewState: (viewState) => set({ viewState }),
  openOverlay: (view = "full") => set({ viewState: view }),
  closeOverlay: () => set({ viewState: "dock" }),

  setEqEnabled: (enabled) => {
    musicAudioEngine.setEqEnabled(enabled);
    set({ eqEnabled: enabled });
    saveConfig(get);
  },

  setEqBand: (index, gainDb) => {
    const next = [...get().eqGains];
    next[index] = gainDb;
    const gains = normalizeEqGains(next);
    musicAudioEngine.setEqGains(gains);
    set({ eqGains: gains });
    saveConfig(get);
  },

  setEqGains: (gains) => {
    const normalized = normalizeEqGains(gains);
    musicAudioEngine.setEqGains(normalized);
    set({ eqGains: normalized });
    saveConfig(get);
  },

  applyEqPreset: (name) => {
    get().setEqGains([...(EQ_PRESETS[name] ?? EQ_FLAT)]);
  },

  setNormalizationEnabled: (enabled) => {
    musicAudioEngine.setLoudness(get().loudnessDb, enabled);
    set({ normalizationEnabled: enabled });
    saveConfig(get);
  },

  // --- internal (element → store) --------------------------------------

  _syncTime: (progress, duration) => {
    const next: Partial<MusicPlayerState> = {
      progress: Number.isFinite(progress) ? progress : 0,
    };
    if (Number.isFinite(duration) && duration > 0) next.duration = duration;
    set(next);
  },

  _reflectPlaying: (isPlaying) => set({ isPlaying }),

  _setBuffering: (isBuffering) => set({ isBuffering }),

  handleEnded: () => {
    if (get().repeatMode === "one") {
      musicAudioEngine.seek(0);
      void musicAudioEngine.play();
      set({ progress: 0, isPlaying: true });
      return;
    }
    get().next();
  },

  _onPlaybackError: () => {
    if (get().loadingStreamId !== null) return;
    recordPlayerEvent("music playback error (media element)");
    // The element rejected the URL it was given, so drop it rather than let any
    // later attempt be served the same dead one from cache.
    const track = get().currentTrack;
    if (track) invalidateMusicStream(videoIdOf(track));
    set({ isPlaying: false, streamError: PLAYBACK_ERROR_FALLBACK, streamErrorKind: "streaming" });
  },
}));
