import { create } from "zustand";

import type { MusicStreamInfo, SongItem } from "../types/music";
import type { MusicAudioQuality } from "../lib/api/music";
import { getOfflineStream } from "../lib/api/downloads";
import {
  invalidateMusicStream,
  isResolveTimeout,
  prefetchMusicStream,
  resolveMusicStream,
} from "../lib/musicStreamResolution";
import { seedOfflineLyrics } from "../lib/lyrics/offline";
import { findDownloadedRecord } from "../lib/useDownloads";
import { useDownloadsLibraryStore } from "./useDownloadsLibraryStore";
import { normalizeBackendError } from "../lib/api/errors";
import { recordPlayerEvent } from "../lib/playerDiagnostics";
import { logToBackend } from "../lib/diagnostics";
import { listedSeconds } from "../lib/audio/listedLength";
import { musicAudioEngine } from "../lib/audio/musicAudioEngine";
import { migrateSavedMusicVolume } from "../lib/audio/volumeCurve";
import { preloadTrack } from "../lib/musicPreload";
import { upcomingIndex, type QueueRepeatMode } from "../lib/musicQueueOrder";
import { restoreOriginalOrder, shuffleFrom, shuffleUpcoming } from "../lib/musicShuffle";
import {
  appendTracks,
  insertNext,
  isUpcoming,
  removeAt,
  removeWhere,
  type QueueLists,
} from "../lib/musicQueueEdits";
import { radioSession } from "../lib/musicRadioSession";
import type { RestoredQueue } from "../lib/musicQueuePersistence";
import { isLongTrack, resumePositionFor } from "../lib/musicResume";
import { POOL_LOW_WATER } from "../lib/musicRadioPlanner";
import { SETTINGS } from "../lib/settings/schema";
import { getSettingValue } from "./useAppSettingsStore";
import { shouldSkipUnplayable } from "../lib/musicSkip";
import { MEDIA_FAILURE_KIND, RecoveryLedger, classifyMediaFailure } from "../lib/musicRecoveryPolicy";

export type MusicViewState = "dock" | "full" | "queue" | "lyrics";
export type MusicRepeatMode = QueueRepeatMode;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const videoIdOf = (track: SongItem): string => track.videoId ?? track.id;

// --- persistence ---

const PERSIST_KEY = "flow_music_player";

interface PersistedMusicConfig {
  volume: number;
  isMuted: boolean;
  repeatMode: MusicRepeatMode;
  isShuffle: boolean;
  radioEnabled: boolean;
}

const DEFAULT_CONFIG: PersistedMusicConfig = {
  volume: 1,
  isMuted: false,
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
    };
  } catch (error) {
    console.warn("Failed to load saved music player config", error);
    return { ...DEFAULT_CONFIG };
  }
};

migrateSavedMusicVolume();
const initialConfig = loadConfig();

const saveConfig = (get: () => MusicPlayerState) => {
  try {
    const s = get();
    const config: PersistedMusicConfig = {
      volume: s.volume,
      isMuted: s.isMuted,
      repeatMode: s.repeatMode,
      isShuffle: s.isShuffle,
      radioEnabled: s.radioEnabled,
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn("Failed to save music player config", error);
  }
};

// Recoveries each track has had from a media-element failure.
const recovery = new RecoveryLedger();
// The user paused: a stall or a recovery must never start the song again.
let userPaused = false;
let stopWaitingForNetwork: (() => void) | null = null;

const cancelNetworkWait = () => {
  stopWaitingForNetwork?.();
  stopWaitingForNetwork = null;
};

/** Runs `onBack` once the browser reports the connection is back. */
const waitForNetwork = (onBack: () => void) => {
  cancelNetworkWait();
  const handler = () => {
    stopWaitingForNetwork = null;
    onBack();
  };
  window.addEventListener("online", handler, { once: true });
  stopWaitingForNetwork = () => window.removeEventListener("online", handler);
};

// A queue restored at launch shows its song paused without loading it; the
// first play loads it at the saved position.
let awaitingFirstPlay = false;

// Unplayable tracks skipped since the last one that started.
let unplayableSkips = 0;

// When the current load began, for the start-up timing in the diagnostics log.
let loadStartedAt: { videoId: string; at: number } | null = null;

// A stall with no bytes arriving for this long is treated as a dead connection
// and recovered; a slow one that is still receiving is left to finish.
const STALL_CHECK_MS = 5_000;
const STALL_LIMIT_MS = 15_000;
let stallWatch: ReturnType<typeof setInterval> | null = null;

const stopStallWatch = () => {
  if (stallWatch !== null) clearInterval(stallWatch);
  stallWatch = null;
};
const MUSIC_AUDIO_QUALITY_VALUES = new Set(["Auto", "High", "Medium", "Low"]);

// --- radio / autoplay -------------------------------------------------
const RADIO_LOW_WATER = 3;
const RADIO_BATCH = 10;
const RADIO_MAX_PAGES = 4;

let radioInFlight: Promise<void> | null = null;

// Hide predicate pushed in by `useMusicActionsStore` (block list). Kept as a module-level
// ref so radio autoplay can consult it without the store importing the actions store.
let hiddenPredicate: (track: SongItem) => boolean = () => false;

const resetRadioSession = (seedIds: string[] = []) => {
  radioInFlight = null;
  radioSession.reset(seedIds);
};

const queueListsOf = (s: QueueLists): QueueLists => ({
  queue: s.queue,
  unshuffledQueue: s.unshuffledQueue,
  currentIndex: s.currentIndex,
});

/** The station's tracks still waiting to play, which count toward each artist's share. */
const waitingStationTracks = (s: Pick<MusicPlayerState, "queue" | "currentIndex" | "radioQueuedIds">) => {
  const station = new Set(s.radioQueuedIds);
  return s.queue.filter((t, i) => i > s.currentIndex && station.has(videoIdOf(t)));
};

/**
 * A queue replacing the last one, with no station tracks and no undo of the
 * old one. `unshuffled` is the order shuffle restores, or null with shuffle off.
 */
const freshQueue = (queue: SongItem[], unshuffled: SongItem[] | null) => {
  undoSnapshot = null;
  return {
    queue,
    unshuffledQueue: unshuffled,
    radioQueuedIds: [],
    radioLoading: false,
    radioExhausted: false,
  };
};

type UndoSnapshot = Pick<
  MusicPlayerState,
  "queue" | "unshuffledQueue" | "currentIndex" | "radioQueuedIds" | "queueSource"
>;
/** The queue as it stood before the last removal or clear, for its undo toast. */
let undoSnapshot: UndoSnapshot | null = null;

const undoSnapshotOf = (s: UndoSnapshot): UndoSnapshot => ({
  queue: s.queue,
  unshuffledQueue: s.unshuffledQueue,
  currentIndex: s.currentIndex,
  radioQueuedIds: s.radioQueuedIds,
  queueSource: s.queueSource,
});

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

  // --- modes (persisted) ---
  repeatMode: MusicRepeatMode;
  isShuffle: boolean;
  radioEnabled: boolean; // autoplay similar music when the queue runs out
  // A station the user started by name runs until the next queue even with autoplay off.
  // Session only: the saved setting governs queues that run out on their own.
  radioStationActive: boolean;

  /** Where the current queue was started from ("Playing from …"); null for ad-hoc plays. */
  queueSource: string | null;
  /** The order shuffle rearranged, restored when it is turned off; null while shuffle is off. */
  unshuffledQueue: SongItem[] | null;

  // --- radio / autoplay ---
  radioLoading: boolean;
  radioQueuedIds: string[];
  /** The station found nothing more to play, even from its anchor songs. */
  radioExhausted: boolean;

  // --- overlay / surface ---
  viewState: MusicViewState;

  // --- stream resolution ---
  loadingStreamId: string | null;
  streamError: string | null;
  streamErrorKind: string | null;

  // --- intents (called by UI) ---
  playTrack: (track: SongItem) => Promise<void>;
  playQueue: (tracks: SongItem[], startIndex?: number, source?: string | null) => Promise<void>;
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
  /** Puts back the queue as it was before the last removal or clear. */
  undoQueueEdit: () => void;
  /** Shows the queue saved at the last session, paused, unless something already plays. */
  restoreSavedQueue: (restored: RestoredQueue) => void;

  // --- block list integration (driven by useMusicActionsStore) ---
  setHiddenPredicate: (predicate: (track: SongItem) => boolean) => void;
  pruneQueue: (shouldRemove: (track: SongItem) => boolean) => void;

  setViewState: (view: MusicViewState) => void;
  openOverlay: (view?: Exclude<MusicViewState, "dock">) => void;
  closeOverlay: () => void;

  /** Follows the saved music normalization setting (see `bindMusicAudioSettings`). */
  setNormalizationEnabled: (enabled: boolean) => void;

  // --- internal: driven by the root <audio> controller (element → store) ---
  _ensureRadio: () => Promise<void>;
  /** `autoplay: false` loads the track paused, for a recovery while the user had paused. */
  _loadIndex: (index: number, options?: { resumeAt?: number; autoplay?: boolean }) => Promise<void>;
  _prefetchUpcoming: () => void;
  _preloadUpcoming: () => void;
  /** Loads the song playing again as AAC once WebAudio is in use, when it cannot hear it. */
  _reloadForWebAudio: () => void;
  _onPreloadError: () => void;
  _syncTime: (progress: number, duration: number) => void;
  _reflectPlaying: (isPlaying: boolean) => void;
  _setBuffering: (isBuffering: boolean) => void;
  handleEnded: () => void;
  _onPlaybackError: () => void;
}

/** Whether the queue refills itself: the saved autoplay setting, or a station started by name. */
export const selectRadioOn = (s: Pick<MusicPlayerState, "radioEnabled" | "radioStationActive">): boolean =>
  s.radioEnabled || s.radioStationActive;

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
  normalizationEnabled: getSettingValue(SETTINGS.MUSIC_LOUDNESS_NORMALIZATION) === "true",

  repeatMode: initialConfig.repeatMode,
  isShuffle: initialConfig.isShuffle,
  radioEnabled: initialConfig.radioEnabled,
  radioStationActive: false,
  queueSource: null,
  unshuffledQueue: null,
  radioLoading: false,
  radioQueuedIds: [],
  radioExhausted: false,

  viewState: "dock",

  loadingStreamId: null,
  streamError: null,
  streamErrorKind: null,

  // --- intents ----------------------------------------------------------

  playTrack: async (track) => {
    resetRadioSession([videoIdOf(track)]);
    set({ ...freshQueue([track], get().isShuffle ? [track] : null), radioStationActive: false, queueSource: null });
    await get()._loadIndex(0);
  },

  playQueue: async (tracks, startIndex = 0, source = null) => {
    if (tracks.length === 0) return;
    resetRadioSession(tracks.map(videoIdOf));
    const start = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const shuffled = get().isShuffle;
    set({
      ...freshQueue(shuffled ? shuffleFrom(tracks, start) : tracks, shuffled ? tracks : null),
      radioStationActive: false,
      queueSource: source,
    });
    await get()._loadIndex(shuffled ? 0 : start);
  },

  _ensureRadio: async () => {
    if (radioInFlight) return radioInFlight;
    const { queue, currentIndex, isShuffle } = get();
    if (!selectRadioOn(get())) return;
    const remaining = queue.length - 1 - currentIndex;
    // Shuffle means "shuffle my queue" while it plays; the station carries on
    // once every shuffled song has had its turn.
    if (remaining > (isShuffle ? 0 : RADIO_LOW_WATER)) return;

    const seed = queue[queue.length - 1] ?? get().currentTrack;
    if (!seed) return;
    const generation = radioSession.generation;

    radioInFlight = (async () => {
      set({ radioLoading: true });
      try {
        const queueIds = () => new Set(get().queue.map(videoIdOf));
        const feedQueue = (): boolean => {
          if (radioSession.generation !== generation) return false;
          const batch = radioSession.take(queueIds(), RADIO_BATCH);
          if (batch.length === 0) return false;
          set({
            ...appendTracks(queueListsOf(get()), batch),
            radioQueuedIds: [...get().radioQueuedIds, ...batch.map(videoIdOf)],
          });
          return true;
        };

        let fed = feedQueue();
        for (
          let page = 0;
          page < RADIO_MAX_PAGES && radioSession.poolSize() < POOL_LOW_WATER && radioSession.canRefill();
          page++
        ) {
          await radioSession.refill({
            seed,
            queueIds: queueIds(),
            stationTracks: waitingStationTracks(get()),
            isHidden: hiddenPredicate,
          });
          if (radioSession.generation !== generation) return;
          if (!fed) fed = feedQueue();
        }
      } catch (error) {
        console.warn("Radio autoplay fetch failed", error);
      } finally {
        if (radioSession.generation === generation) {
          set({ radioLoading: false, radioExhausted: radioSession.isExhausted() });
          radioInFlight = null;
        }
      }
    })();
    return radioInFlight;
  },

  _loadIndex: async (index, options) => {
    const track = get().queue[index];
    if (!track) return;
    const videoId = videoIdOf(track);
    let resumeAt = options?.resumeAt ?? 0;
    const autoplay = options?.autoplay ?? true;
    awaitingFirstPlay = false;
    cancelNetworkWait();
    if (autoplay) userPaused = false;
    const start = async () => {
      if (autoplay) await musicAudioEngine.play();
    };

    set({
      currentTrack: track,
      currentIndex: index,
      progress: resumeAt,
      duration: track.duration ?? 0,
      isPlaying: autoplay,
      isBuffering: autoplay,
      streamError: null,
      streamErrorKind: null,
      loadingStreamId: videoId,
    });
    loadStartedAt = { videoId, at: performance.now() };
    recordPlayerEvent(`music resolve start: ${videoId}`);

    // Radio top-up and next-track warming wait until this track is audible, so
    // they never compete with it for a slow connection.
    const afterStart = () => {
      unplayableSkips = 0;
      void get()._ensureRadio();
      get()._prefetchUpcoming();
    };

    // A fresh play of a long track picks up where it was left (a setting).
    if (options?.resumeAt === undefined && isLongTrack(track.duration ?? 0)) {
      resumeAt = await resumePositionFor(track);
      if (get().loadingStreamId !== videoId) return;
      if (resumeAt > 0) set({ progress: resumeAt });
    }

    // Gapless: the standby element already holds this track, buffered.
    if (resumeAt === 0 && musicAudioEngine.activatePreloaded(videoId)) {
      const loudnessDb = musicAudioEngine.getActiveLoudness();
      set({ loudnessDb, loadingStreamId: null });
      musicAudioEngine.setLoudness(loudnessDb, get().normalizationEnabled);
      await start();
      recordPlayerEvent(`music started from preload: ${videoId}`);
      afterStart();
      return;
    }
    // Whatever the standby element holds is not what plays next any more.
    musicAudioEngine.clearPreload();

    const audioQuality = getMusicAudioQualitySetting();
    const lookup = () =>
      resolveMusicStream(videoId, audioQuality, {
        preferAac: recovery.prefersAac(videoId) || musicAudioEngine.wantsAac(),
      });

    try {
      // The downloads library is a SQLite read and resolution is a network round
      // trip; when the library still has to load, overlap the two rather than
      // paying them in sequence. Once loaded the offline check is synchronous,
      // so a saved track still needs no network.
      let streamRequest: Promise<MusicStreamInfo> | null = null;
      if (!useDownloadsLibraryStore.getState().loaded) {
        streamRequest = lookup();
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
            loudnessDb: offline.loudnessDb,
            loadingStreamId: null,
            ...(offline.artworkUrl
              ? { currentTrack: { ...track, thumbnail: offline.artworkUrl } }
              : {}),
          });
          musicAudioEngine.setLoudness(offline.loudnessDb, get().normalizationEnabled);
          await musicAudioEngine.load(offline.url, offline.contentType, track.duration ?? null);
          musicAudioEngine.seekWhenReady(resumeAt);
          await start();
          afterStart();
          return;
        } catch (offlineError) {
          console.warn("Offline track unavailable, falling back to stream", offlineError);
        }
      }

      let info: MusicStreamInfo;
      try {
        info = await (streamRequest ?? lookup());
      } catch (firstError) {
        // One automatic retry: a timeout or a dropped connection on a slow
        // link usually clears on the second attempt. A wait that timed out
        // left the backend's walk running, so the retry joins it rather than
        // walking the client ladder a second time.
        if (get().loadingStreamId !== videoId) return;
        recordPlayerEvent(`music resolve retry: ${normalizeBackendError(firstError).kind}`);
        if (!isResolveTimeout(firstError)) invalidateMusicStream(videoId);
        info = await lookup();
      }
      if (get().loadingStreamId !== videoId) return;

      set({ loudnessDb: info.loudnessDb, loadingStreamId: null });
      musicAudioEngine.setLoudness(info.loudnessDb, get().normalizationEnabled);
      await musicAudioEngine.load(info.audioUrl, info.mimeType, listedSeconds(info, track));
      musicAudioEngine.seekWhenReady(resumeAt);
      await start();
      afterStart();
    } catch (e) {
      if (get().loadingStreamId !== videoId) return;
      const normalized = normalizeBackendError(e);
      recordPlayerEvent(`music resolve failed: ${normalized.kind} (${normalized.message})`);
      const { queue, currentIndex, repeatMode } = get();
      const hasNext = repeatMode !== "one" && currentIndex + 1 < queue.length;
      if (shouldSkipUnplayable(normalized.kind, unplayableSkips, hasNext)) {
        unplayableSkips += 1;
        recordPlayerEvent(`music skipped an unplayable track (${unplayableSkips} in a row)`);
        set({ loadingStreamId: null });
        get().next();
        return;
      }
      unplayableSkips = 0;
      if (!navigator.onLine) {
        waitForNetwork(() => {
          if (get().queue[get().currentIndex] === track) void get()._loadIndex(index, { resumeAt, autoplay });
        });
      }
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
    if (awaitingFirstPlay) {
      void get()._loadIndex(get().currentIndex, { resumeAt: get().progress });
      return;
    }
    userPaused = false;
    void musicAudioEngine.play();
    set({ isPlaying: true });
  },

  pause: () => {
    userPaused = true;
    stopStallWatch();
    musicAudioEngine.pause();
    set({ isPlaying: false });
  },

  // Tear down the player entirely — stops audio, clears the queue, hides the
  // dock/overlay. (The controller flushes a final history record on track clear.)
  dismiss: () => {
    awaitingFirstPlay = false;
    stopStallWatch();
    cancelNetworkWait();
    musicAudioEngine.stop();
    resetRadioSession();
    set({
      ...freshQueue([], null),
      currentTrack: null,
      queueSource: null,
      radioStationActive: false,
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
    const state = get();
    const index = upcomingIndex(state);
    const upcoming = index >= 0 ? state.queue[index] : null;
    if (!upcoming) return;

    const upcomingId = videoIdOf(upcoming);
    // A downloaded track plays from disk; resolving it would be a wasted request.
    if (findDownloadedRecord(upcomingId, "audio")) return;
    prefetchMusicStream(upcomingId, getMusicAudioQualitySetting(), { preferAac: musicAudioEngine.wantsAac() });
  },

  // Buffers the next track's audio on the standby element near the end of the
  // current one, so the change is a swap with no load in between.
  _preloadUpcoming: () => {
    const state = get();
    const index = upcomingIndex(state);
    const upcoming = index >= 0 ? state.queue[index] : null;
    if (!upcoming) return;
    void preloadTrack(upcoming, getMusicAudioQualitySetting(), (videoId) => {
      const now = get();
      const nowTrack = now.queue[upcomingIndex(now)];
      return !!nowTrack && videoIdOf(nowTrack) === videoId;
    });
  },

  // On macOS WebAudio cannot hear Opus, so a song loaded before the graph existed loads again as
  // AAC from where it is, and a next song buffered as Opus is dropped to be buffered again.
  _reloadForWebAudio: () => {
    if (!musicAudioEngine.wantsAac()) return;
    musicAudioEngine.clearPreload();
    const { currentTrack, currentIndex, loadingStreamId, isPlaying } = get();
    if (!currentTrack || loadingStreamId !== null || !musicAudioEngine.activeBypassesGraph()) return;
    const videoId = videoIdOf(currentTrack);
    if (findDownloadedRecord(videoId, "audio")) return;
    recordPlayerEvent(`music reloading as AAC for the equalizer: ${videoId}`);
    void get()._loadIndex(currentIndex, { resumeAt: musicAudioEngine.getCurrentTime(), autoplay: isPlaying });
  },

  _onPreloadError: () => {
    // The standby element refused its link; forget both so the track resolves
    // afresh when it is reached.
    const videoId = musicAudioEngine.clearPreload();
    if (videoId) invalidateMusicStream(videoId);
  },

  retryCurrentTrack: () => {
    const { currentIndex, queue } = get();
    if (currentIndex < 0) return;
    // The retry exists because the resolved URL stopped working, so it must not
    // be handed the same cached answer again.
    const track = queue[currentIndex];
    if (track) {
      invalidateMusicStream(videoIdOf(track));
      recovery.forgive(videoIdOf(track));
    }
    set({ streamError: null, streamErrorKind: null });
    recordPlayerEvent(`music retry: index ${currentIndex}`);
    // Pick up where it stopped rather than from the start of the track.
    void get()._loadIndex(currentIndex, { resumeAt: get().progress });
  },

  clearStreamError: () => set({ streamError: null, streamErrorKind: null }),

  next: () => {
    const { queue, currentIndex, repeatMode } = get();
    if (queue.length === 0) return;

    // Shuffle has already rearranged the queue, so the next track is always
    // the following entry, and a shuffled queue ends like any other.
    let nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode === "all") {
        nextIndex = 0;
      } else if (selectRadioOn(get())) {
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

  // Shuffle rearranges the queue itself, as Android does, so Next, Previous,
  // Up next and the preload all follow the list; turning it off puts the
  // original order back.
  toggleShuffle: () => {
    const s = get();
    undoSnapshot = null;
    if (s.isShuffle) {
      const restored = s.unshuffledQueue
        ? restoreOriginalOrder(s.unshuffledQueue, s.queue, s.queue[s.currentIndex] ?? null)
        : { queue: s.queue, currentIndex: s.currentIndex };
      set({ isShuffle: false, unshuffledQueue: null, ...restored });
    } else {
      set({ isShuffle: true, unshuffledQueue: s.queue, queue: shuffleUpcoming(s.queue, s.currentIndex) });
    }
    saveConfig(get);
  },

  toggleRadio: () => {
    const radioEnabled = !selectRadioOn(get());
    set({ radioEnabled, radioStationActive: false });
    saveConfig(get);
    if (radioEnabled) void get()._ensureRadio();
  },

  startRadio: async (seed) => {
    const base = seed ?? get().currentTrack;
    if (!base) return;
    resetRadioSession([videoIdOf(base)]);
    set({
      ...freshQueue([base], get().isShuffle ? [base] : null),
      currentIndex: 0,
      radioStationActive: true,
      queueSource: null,
    });
    await get()._loadIndex(0);
  },

  // Each queued entry is its own copy, so a song played earlier can be queued
  // again and shuffle can still tell the two apart.
  addToQueue: (track) => {
    const lists = queueListsOf(get());
    if (isUpcoming(lists, track)) return;
    set(appendTracks(lists, [{ ...track }]));
  },

  playNextInQueue: (track) => {
    const { currentTrack } = get();
    if (!currentTrack) {
      get().addToQueue(track);
      return;
    }
    if (videoIdOf(track) === videoIdOf(currentTrack)) return;
    set(insertNext(queueListsOf(get()), { ...track }));
  },

  removeFromQueue: (index) => {
    const s = get();
    if (index < 0 || index >= s.queue.length || index === s.currentIndex) return;
    undoSnapshot = undoSnapshotOf(s);
    set(removeAt(queueListsOf(s), index));
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

  // A cleared queue starts its station afresh, and the standby element's
  // preload belonged to a song that is no longer coming.
  clearQueue: () => {
    const s = get();
    const playing = s.queue[s.currentIndex];
    const snapshot = undoSnapshotOf(s);
    resetRadioSession(playing ? [videoIdOf(playing)] : []);
    musicAudioEngine.clearPreload();
    const queue = playing ? [playing] : [];
    set({
      ...freshQueue(queue, s.isShuffle ? queue : null),
      currentIndex: playing ? 0 : -1,
      queueSource: null,
    });
    undoSnapshot = snapshot;
  },

  undoQueueEdit: () => {
    const snapshot = undoSnapshot;
    undoSnapshot = null;
    const s = get();
    const playing = s.queue[s.currentIndex];
    if (!snapshot || !playing) return;
    // The song playing now may be a later one than at the edit; it carries on.
    const currentIndex = snapshot.queue.indexOf(playing);
    if (currentIndex < 0) return;
    set({ ...snapshot, currentIndex });
  },

  restoreSavedQueue: (restored) => {
    const track = restored.queue[restored.currentIndex];
    if (get().currentTrack || !track) return;
    resetRadioSession(restored.queue.map(videoIdOf));
    const unshuffled = get().isShuffle ? (restored.unshuffledQueue ?? restored.queue) : null;
    awaitingFirstPlay = true;
    set({
      ...freshQueue(restored.queue, unshuffled),
      radioQueuedIds: restored.radioQueuedIds,
      radioStationActive: restored.radioStationActive,
      queueSource: restored.queueSource,
      currentTrack: track,
      currentIndex: restored.currentIndex,
      progress: restored.resumeAt,
      duration: track.duration ?? 0,
      isPlaying: false,
      isBuffering: false,
    });
  },

  setHiddenPredicate: (predicate) => {
    hiddenPredicate = predicate;
  },

  // Never yanks the track that's playing; drops the rest that are now hidden.
  pruneQueue: (shouldRemove) => {
    const lists = queueListsOf(get());
    const pruned = removeWhere(lists, shouldRemove);
    if (pruned !== lists) set(pruned);
  },

  setViewState: (viewState) => set({ viewState }),
  openOverlay: (view = "full") => set({ viewState: view }),
  closeOverlay: () => set({ viewState: "dock" }),

  setNormalizationEnabled: (enabled) => {
    musicAudioEngine.setLoudness(get().loudnessDb, enabled);
    set({ normalizationEnabled: enabled });
  },

  // --- internal (element → store) --------------------------------------

  // Every store write runs every subscriber's selector, so the clock is only
  // published when the whole second changes; the full player's bar reads the
  // audio element itself for anything finer.
  _syncTime: (progress, duration) => {
    const current = get();
    // While the next song resolves, the element still plays the last one.
    if (current.loadingStreamId !== null) return;
    const seconds = Number.isFinite(progress) ? progress : 0;
    const nextDuration = Number.isFinite(duration) && duration > 0 ? duration : current.duration;
    if (current.currentTrack && current.isPlaying && !current.isBuffering) {
      recovery.notePlaying(videoIdOf(current.currentTrack), Date.now());
    }
    if (Math.floor(seconds) === Math.floor(current.progress) && nextDuration === current.duration) return;
    set({ progress: seconds, duration: nextDuration });
  },

  _reflectPlaying: (isPlaying) => set({ isPlaying }),

  _setBuffering: (isBuffering) => {
    stopStallWatch();
    // A paused song that was still buffering must stay paused, so no watch.
    if (isBuffering && get().loadingStreamId === null && !userPaused) {
      let lastBuffered = musicAudioEngine.getBufferedEnd();
      let quietSince = Date.now();
      stallWatch = setInterval(() => {
        const buffered = musicAudioEngine.getBufferedEnd();
        if (buffered > lastBuffered) {
          lastBuffered = buffered;
          quietSince = Date.now();
          return;
        }
        if (Date.now() - quietSince < STALL_LIMIT_MS) return;
        stopStallWatch();
        recordPlayerEvent("music stalled with no data arriving");
        get()._onPlaybackError();
      }, STALL_CHECK_MS);
    }
    if (!isBuffering && loadStartedAt) {
      const started = loadStartedAt;
      loadStartedAt = null;
      const elapsedMs = Math.round(performance.now() - started.at);
      const audioContext = musicAudioEngine.getContextState();
      recordPlayerEvent(`music first audio: ${started.videoId} after ${elapsedMs} ms (audio context ${audioContext})`);
      // One line per track in the log file, so slow starts can be measured.
      void logToBackend("info", "music first audio", { videoId: started.videoId, elapsedMs, audioContext });
    }
    set({ isBuffering });
  },

  handleEnded: () => {
    const { repeatMode, queue } = get();
    // Repeat-all over one song is a replay; reloading it would fetch it again.
    if (repeatMode === "one" || (repeatMode === "all" && queue.length === 1)) {
      musicAudioEngine.seek(0);
      void musicAudioEngine.play();
      set({ progress: 0, isPlaying: true });
      return;
    }
    get().next();
  },

  _onPlaybackError: () => {
    if (get().loadingStreamId !== null) return;
    const { currentTrack, currentIndex, progress } = get();
    if (!currentTrack) return;
    stopStallWatch();
    const videoId = videoIdOf(currentTrack);
    const code = musicAudioEngine.getErrorCode();
    const failure = classifyMediaFailure(code, navigator.onLine);
    recordPlayerEvent(`music playback error (media element ${code ?? "stall"}, ${failure})`);
    // The element rejected the URL it was given, so drop it rather than let any
    // later attempt be served the same dead one from cache.
    invalidateMusicStream(videoId);
    // Pick up from the same position, and only play if the user had not paused.
    const entry = get().queue[currentIndex];
    const reload = () => {
      const s = get();
      if (!entry || s.queue[s.currentIndex] !== entry) return;
      void s._loadIndex(s.currentIndex, { resumeAt: progress, autoplay: !userPaused });
    };
    const decision = recovery.decide(videoId, failure, Date.now());
    const shown = {
      isPlaying: false,
      isBuffering: false,
      streamError: `media element error ${code ?? "stall"} (${failure})`,
      streamErrorKind: MEDIA_FAILURE_KIND[failure],
    };
    if (decision === "waitForNetwork") {
      set(shown);
      waitForNetwork(reload);
      return;
    }
    if (decision === "retry") {
      recordPlayerEvent(`music playback recovery: ${videoId} at ${Math.round(progress)}s`);
      reload();
      return;
    }
    set(shown);
  },
}));

// Radio additions, queue edits and reorders all change what plays next, so warm
// its link whenever the queue does. A queue restored at launch warms nothing
// until it is played, so startup makes no network request for it.
useMusicPlayerStore.subscribe((state, previous) => {
  if (state.queue !== previous.queue && state.currentTrack && state.loadingStreamId === null && !awaitingFirstPlay) {
    state._prefetchUpcoming();
  }
});

