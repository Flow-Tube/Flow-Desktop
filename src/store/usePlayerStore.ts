import { create } from "zustand";
import type { CaptionTrack, RelatedContentItem, VideoDetails, VideoSummary } from "../types/video";
import { prefetchStreamInfo } from "../lib/streamResolution";

import type { SponsorBlockSegment, DeArrowOverride, RydData } from "../lib/api/foss";

export type PlaybackRate = number;
export type RepeatMode = "none" | "one" | "all";
export type QueueAddResult = "added" | "duplicate";
export type PlayMode = "video" | "music";
/**
 * `pip` is the mini player surface itself — the in-app floating frame in the
 * main window, and the whole viewport inside the pop-out window. `window` is
 * what the *main* window shows while a pop-out owns playback: no media element
 * of its own, so the two windows never decode the same video at once.
 */
export type VideoPlayerMode = "watch" | "pip" | "window";
export type VideoPipIntent = "auto" | "manual";

export interface WatchPageCache {
  videoId: string;
  videoDetails: VideoDetails | null;
  channelDetails: unknown | null;
  relatedVideos: RelatedContentItem[];
  updatedAt: number;
}

export interface SubtitleStyle {
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  isBold: boolean;
  bottomPadding: number;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 18,
  textColor: "#FFFFFF",
  backgroundColor: "#000000",
  backgroundOpacity: 0.75,
  isBold: true,
  bottomPadding: 32,
};

const getSavedSubtitleStyle = (): SubtitleStyle => {
  try {
    const saved = localStorage.getItem("flow_subtitle_style");
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error("Failed to parse saved subtitle style", e);
  }
  return DEFAULT_SUBTITLE_STYLE;
};

const getSavedTheaterMode = (): boolean => {
  try {
    return localStorage.getItem("flow_theater_mode") === "true";
  } catch (e) {
    console.error("Failed to load saved theater mode", e);
  }
  return false;
};

interface PlayerState {
  currentVideo: VideoSummary | null;
  isPlaying: boolean;
  volume: number;
  playbackRate: PlaybackRate;
  queue: VideoSummary[];
  currentIndex: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  playMode: PlayMode;
  currentTime: number;
  duration: number;
  videoPlayerMode: VideoPlayerMode;
  videoPipIntent: VideoPipIntent | null;
  isVideoFullscreen: boolean;
  /** Playback handed over by the other window, consumed by whichever player
   * mounts next so a handoff resumes exactly where — and how — it left off.
   * Kept in memory rather than written to the saved-progress store, which Deep
   * Flow disables. */
  pipHandoff: { videoId: string; positionSeconds: number; playing: boolean } | null;
  /** True while this window is decoding a video the *other* window is still
   * playing out loud — the pop-out warming up behind a handoff. It silences the
   * media element without touching the user's mute or volume. */
  isHandoffSilent: boolean;
  watchPageCache: WatchPageCache | null;
  autoplayCandidates: VideoSummary[];
  /** The video the media element has actually begun rendering. Work that is not
   * playback — related content, channel info, comments — waits on this so it
   * never competes with the first buffer. */
  playbackStartedVideoId: string | null;

  isTheaterMode: boolean;
  sponsorBlockSegments: SponsorBlockSegment[];
  dearrowData: DeArrowOverride | null;
  rydData: RydData | null;
  captions: CaptionTrack[];

  setCurrentVideo: (video: VideoSummary | null) => void;
  /** Fill in fields of the playing video that arrived after playback started —
   * a cold open plays from the id alone and gets its title/channel afterwards. */
  enrichCurrentVideo: (videoId: string, patch: Partial<VideoSummary>) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (playbackRate: PlaybackRate) => void;
  setQueue: (queue: VideoSummary[], startIndex?: number) => void;
  addToQueue: (video: VideoSummary) => QueueAddResult;
  removeFromQueue: (index: number) => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  playQueueItem: (index: number) => void;
  playNext: (allowAutoplayFallback?: boolean) => VideoSummary | null;
  playPrevious: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;
  setAutoplayCandidates: (videos: VideoSummary[]) => void;
  clearUpcoming: () => void;
  setPlayMode: (mode: PlayMode) => void;
  clearQueue: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  markPlaybackStarted: (videoId: string) => void;
  enterVideoPip: (intent: VideoPipIntent) => void;
  /** Playback moved to the pop-out OS window; this window stops rendering it. */
  enterVideoWindowPip: () => void;
  expandVideoPlayer: () => void;
  setPipHandoff: (videoId: string, positionSeconds: number, playing: boolean) => void;
  setHandoffSilent: (isHandoffSilent: boolean) => void;
  consumePipHandoff: (videoId: string) => { positionSeconds: number; playing: boolean } | null;
  /** Mirrors playback owned by the other window without taking it over. */
  applyPipRemoteState: (patch: {
    video?: VideoSummary;
    currentTime?: number;
    duration?: number;
    isPlaying?: boolean;
  }) => void;
  dismissVideoPlayer: () => void;
  setIsVideoFullscreen: (fullscreen: boolean) => void;
  setWatchPageCache: (videoId: string, cache: Partial<Omit<WatchPageCache, "videoId" | "updatedAt">>) => void;
  clearWatchPageCache: (videoId?: string) => void;

  setIsTheaterMode: (isTheaterMode: boolean) => void;
  setSponsorBlockSegments: (segments: SponsorBlockSegment[]) => void;
  setDearrowData: (data: DeArrowOverride | null) => void;
  setRydData: (data: RydData | null) => void;
  setCaptions: (captions: CaptionTrack[]) => void;
  subtitleStyle: SubtitleStyle;
  setSubtitleStyle: (style: SubtitleStyle) => void;
  isChaptersPanelOpen: boolean;
  setIsChaptersPanelOpen: (open: boolean) => void;
  isQueuePanelOpen: boolean;
  setIsQueuePanelOpen: (open: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentVideo: null,
  isPlaying: false,
  volume: 1,
  playbackRate: 1,
  queue: [],
  currentIndex: -1,
  repeatMode: "none",
  isShuffle: false,
  playMode: "video",
  currentTime: 0,
  duration: 0,
  videoPlayerMode: "watch",
  videoPipIntent: null,
  isVideoFullscreen: false,
  pipHandoff: null,
  isHandoffSilent: false,
  watchPageCache: null,
  autoplayCandidates: [],
  playbackStartedVideoId: null,

  isTheaterMode: getSavedTheaterMode(),
  sponsorBlockSegments: [],
  dearrowData: null,
  rydData: null,
  captions: [],
  isChaptersPanelOpen: false,
  isQueuePanelOpen: false,

  setCurrentVideo: (video) => {
    const isNew = get().currentVideo?.id !== video?.id;
    set({
      currentVideo: video,
      isPlaying: !!video,
      isChaptersPanelOpen: false,
      isQueuePanelOpen: false,
      ...(isNew ? { videoPlayerMode: "watch", videoPipIntent: null, watchPageCache: null } : {}),
      ...(isNew ? { autoplayCandidates: [] } : {}),
      ...(isNew ? { currentTime: 0, duration: video?.durationSeconds ?? 0 } : {}),
      ...(isNew ? { playbackStartedVideoId: null } : {}),
    });

    if (video && isNew) {
      const isSong = video.viewCountText === "Song" || video.viewCountText === "Album Track" || video.channelName.toLowerCase().includes("topic") || video.durationSeconds && video.durationSeconds < 360;
      set({ playMode: isSong ? "music" : "video" });
      prefetchStreamInfo(video.id);
    }
  },

  enrichCurrentVideo: (videoId, patch) => {
    const { currentVideo, queue } = get();
    if (!currentVideo || currentVideo.id !== videoId) return;
    set({
      currentVideo: { ...currentVideo, ...patch },
      queue: queue.map((item) => (item.id === videoId ? { ...item, ...patch } : item)),
    });
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),

  setPlaybackRate: (playbackRate) => set({ playbackRate: Math.min(4, Math.max(0.25, playbackRate)) }),

  setQueue: (queue, startIndex = 0) => {
    const safeIndex = queue.length > 0
      ? Math.max(0, Math.min(startIndex, queue.length - 1))
      : -1;
    const nextVideo = safeIndex >= 0 ? queue[safeIndex] || null : null;
    const isNew = get().currentVideo?.id !== nextVideo?.id;
    set({
      queue,
      currentIndex: safeIndex,
      currentVideo: nextVideo,
      isPlaying: queue.length > 0,
      videoPlayerMode: "watch",
      videoPipIntent: null,
      isChaptersPanelOpen: false,
      isQueuePanelOpen: false,
      ...(isNew ? { watchPageCache: null } : {}),
      ...(isNew ? { autoplayCandidates: [] } : {}),
      currentTime: 0,
      duration: nextVideo?.durationSeconds ?? 0,
      ...(isNew ? { playbackStartedVideoId: null } : {}),
    });
    // Every surface that opens a video funnels through here, so warming the
    // stream from this one place lets resolution overlap with the route change
    // and the watch page's own mount instead of following them.
    if (nextVideo) prefetchStreamInfo(nextVideo.id);
  },

  addToQueue: (video) => {
    const { queue, currentVideo, currentIndex } = get();
    if (queue.some((item) => item.id === video.id) || currentVideo?.id === video.id) {
      return "duplicate";
    }

    if (queue.length === 0 && currentVideo) {
      set({ queue: [currentVideo, video], currentIndex: 0 });
      return "added";
    }

    const nextQueue = [...queue, video];
    set({
      queue: nextQueue,
      currentIndex: currentVideo && currentIndex < 0 ? 0 : currentIndex,
    });
    return "added";
  },

  removeFromQueue: (index) => {
    const { queue, currentIndex } = get();
    const newQueue = queue.filter((_, i) => i !== index);
    let newIndex = currentIndex;
    if (index < currentIndex) {
      newIndex = currentIndex - 1;
    } else if (index === currentIndex) {
      newIndex = Math.min(currentIndex, newQueue.length - 1);
    }
    set({
      queue: newQueue,
      currentIndex: newIndex,
      currentVideo: newQueue[newIndex] || null,
    });
  },

  moveQueueItem: (fromIndex, toIndex) => {
    const { queue, currentIndex } = get();
    if (
      fromIndex < 0 ||
      fromIndex >= queue.length ||
      toIndex < 0 ||
      toIndex >= queue.length ||
      fromIndex === toIndex
    ) return;

    const nextQueue = [...queue];
    const [moved] = nextQueue.splice(fromIndex, 1);
    if (!moved) return;
    nextQueue.splice(toIndex, 0, moved);

    let nextCurrentIndex = currentIndex;
    if (fromIndex === currentIndex) {
      nextCurrentIndex = toIndex;
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      nextCurrentIndex = currentIndex - 1;
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      nextCurrentIndex = currentIndex + 1;
    }
    set({ queue: nextQueue, currentIndex: nextCurrentIndex });
  },

  playQueueItem: (index) => {
    const item = get().queue[index];
    if (!item) return;
    set({
      currentIndex: index,
      currentVideo: item,
      isPlaying: true,
      currentTime: 0,
      duration: item.durationSeconds ?? 0,
      watchPageCache: null,
      autoplayCandidates: [],
      playbackStartedVideoId: null,
    });
    prefetchStreamInfo(item.id);
  },

  playNext: (allowAutoplayFallback = false) => {
    const { queue, currentIndex, repeatMode, autoplayCandidates } = get();
    if (queue.length === 0) return null;

    const nextIndex = currentIndex + 1;
    if (nextIndex < queue.length) {
      const nextItem = queue[nextIndex];
      if (nextItem) {
        get().playQueueItem(nextIndex);
        return nextItem;
      }
    } else if (repeatMode === "all") {
      const firstItem = queue[0];
      if (firstItem) {
        get().playQueueItem(0);
        return firstItem;
      }
    }

    if (allowAutoplayFallback) {
      const queuedIds = new Set(queue.map((item) => item.id));
      const nextCandidate = autoplayCandidates.find((item) => !queuedIds.has(item.id));
      if (nextCandidate) {
        const nextQueue = [...queue, nextCandidate];
        set({
          queue: nextQueue,
          autoplayCandidates: autoplayCandidates.filter((item) => item.id !== nextCandidate.id),
        });
        get().playQueueItem(nextQueue.length - 1);
        return nextCandidate;
      }
    }

    set({ isPlaying: false });
    return null;
  },

  playPrevious: () => {
    const { queue, currentIndex, currentTime, repeatMode } = get();
    if (queue.length === 0) return;

    if (currentTime > 3) {
      set({ currentTime: 0 });
      window.dispatchEvent(new CustomEvent("flow-player-seek", { detail: { time: 0 } }));
      return;
    }

    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      const prevItem = queue[prevIndex];
      if (prevItem) {
        set({
          currentIndex: prevIndex,
          currentVideo: prevItem,
          isPlaying: true,
          currentTime: 0,
          duration: prevItem.durationSeconds ?? 0,
          playbackStartedVideoId: null,
        });
        prefetchStreamInfo(prevItem.id);
      }
    } else if (repeatMode === "all") {
      const lastIndex = queue.length - 1;
      const lastItem = queue[lastIndex];
      if (lastItem) {
        set({
          currentIndex: lastIndex,
          currentVideo: lastItem,
          isPlaying: true,
          currentTime: 0,
          duration: lastItem.durationSeconds ?? 0,
          playbackStartedVideoId: null,
        });
        prefetchStreamInfo(lastItem.id);
      }
    } else {
      set({ currentTime: 0 });
      window.dispatchEvent(new CustomEvent("flow-player-seek", { detail: { time: 0 } }));
    }
  },

  setRepeatMode: (repeatMode) => set({ repeatMode }),
  cycleRepeatMode: () => {
    const order: RepeatMode[] = ["none", "all", "one"];
    const current = order.indexOf(get().repeatMode);
    set({ repeatMode: order[(current + 1) % order.length] ?? "none" });
  },

  toggleShuffle: () => {
    const { isShuffle, queue, currentIndex } = get();
    if (!isShuffle) {
      const fixed = currentIndex >= 0 ? queue.slice(0, currentIndex + 1) : [];
      const upcoming = queue.slice(currentIndex + 1);
      const shuffled = [...upcoming].sort(() => Math.random() - 0.5);
      set({ isShuffle: true, queue: [...fixed, ...shuffled] });
    } else {
      set({ isShuffle: false });
    }
  },
  setAutoplayCandidates: (videos) => {
    const currentId = get().currentVideo?.id;
    const queueIds = new Set(get().queue.map((item) => item.id));
    const seen = new Set<string>();
    const candidates = videos.filter((video) => {
      if (!video.id || video.id === currentId || queueIds.has(video.id) || seen.has(video.id) || video.isLive) {
        return false;
      }
      seen.add(video.id);
      return true;
    });
    set({ autoplayCandidates: candidates });
  },
  clearUpcoming: () => {
    const { queue, currentVideo, currentIndex } = get();
    const retained = currentIndex >= 0 ? queue.slice(0, currentIndex + 1) : [];
    set({
      queue: retained,
      currentIndex: currentVideo ? retained.length - 1 : -1,
    });
  },

  setPlayMode: (playMode) => set({ playMode }),

  clearQueue: () => set({
    queue: [],
    currentIndex: -1,
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    videoPlayerMode: "watch",
    videoPipIntent: null,
    isVideoFullscreen: false,
    pipHandoff: null,
    isHandoffSilent: false,
    watchPageCache: null,
    autoplayCandidates: [],
    playbackStartedVideoId: null,
    isChaptersPanelOpen: false,
    isQueuePanelOpen: false,
  }),
  
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  markPlaybackStarted: (videoId) => {
    if (get().playbackStartedVideoId === videoId) return;
    if (get().currentVideo?.id !== videoId) return;
    set({ playbackStartedVideoId: videoId });
  },
  enterVideoPip: (videoPipIntent) => {
    if (!get().currentVideo) return;
    set({ videoPlayerMode: "pip", videoPipIntent, isVideoFullscreen: false });
  },
  enterVideoWindowPip: () => {
    if (!get().currentVideo) return;
    set({ videoPlayerMode: "window", videoPipIntent: "manual", isVideoFullscreen: false });
  },
  expandVideoPlayer: () => {
    if (!get().currentVideo) return;
    set({ videoPlayerMode: "watch", videoPipIntent: null });
  },
  setPipHandoff: (videoId, positionSeconds, playing) => {
    const safePosition =
      Number.isFinite(positionSeconds) && positionSeconds > 0 ? positionSeconds : 0;
    set({ pipHandoff: { videoId, positionSeconds: safePosition, playing } });
  },
  setHandoffSilent: (isHandoffSilent) => set({ isHandoffSilent }),
  consumePipHandoff: (videoId) => {
    const handoff = get().pipHandoff;
    if (!handoff || handoff.videoId !== videoId) return null;
    set({ pipHandoff: null });
    return { positionSeconds: handoff.positionSeconds, playing: handoff.playing };
  },
  applyPipRemoteState: ({ video, currentTime, duration, isPlaying }) => {
    const { queue } = get();
    const patch: Partial<PlayerState> = {};

    if (video) {
      // An autoplay advance inside the pop-out can pull in a video this window
      // never had, so the queue grows to match rather than losing the entry.
      const existingIndex = queue.findIndex((item) => item.id === video.id);
      if (existingIndex >= 0) {
        patch.queue = queue.map((item, index) => (index === existingIndex ? video : item));
        patch.currentIndex = existingIndex;
      } else {
        patch.queue = [...queue, video];
        patch.currentIndex = queue.length;
      }
      patch.currentVideo = video;
      patch.duration = video.durationSeconds ?? 0;
      patch.watchPageCache = null;
      patch.autoplayCandidates = [];
      patch.playbackStartedVideoId = null;
      patch.currentTime = 0;
    }

    if (currentTime !== undefined) patch.currentTime = currentTime;
    if (duration !== undefined && duration > 0) patch.duration = duration;
    if (isPlaying !== undefined) patch.isPlaying = isPlaying;

    set(patch);
  },
  dismissVideoPlayer: () => get().clearQueue(),
  setIsVideoFullscreen: (isVideoFullscreen) => set({ isVideoFullscreen }),
  setWatchPageCache: (videoId, cache) => {
    const previous = get().watchPageCache;
    set({
      watchPageCache: {
        videoId,
        videoDetails: cache.videoDetails ?? (previous?.videoId === videoId ? previous.videoDetails : null),
        channelDetails: cache.channelDetails ?? (previous?.videoId === videoId ? previous.channelDetails : null),
        relatedVideos: cache.relatedVideos ?? (previous?.videoId === videoId ? previous.relatedVideos : []),
        updatedAt: Date.now(),
      },
    });
  },
  clearWatchPageCache: (videoId) => {
    const previous = get().watchPageCache;
    if (!previous) return;
    if (videoId && previous.videoId !== videoId) return;
    set({ watchPageCache: null });
  },

  setIsTheaterMode: (isTheaterMode) => {
    localStorage.setItem("flow_theater_mode", String(isTheaterMode));
    set({ isTheaterMode });
  },
  setSponsorBlockSegments: (sponsorBlockSegments) => set({ sponsorBlockSegments }),
  setDearrowData: (dearrowData) => set({ dearrowData }),
  setRydData: (rydData) => set({ rydData }),
  setCaptions: (captions) => set({ captions }),
  setIsChaptersPanelOpen: (isChaptersPanelOpen) => set({
    isChaptersPanelOpen,
    ...(isChaptersPanelOpen ? { isQueuePanelOpen: false } : {}),
  }),
  setIsQueuePanelOpen: (isQueuePanelOpen) => set({
    isQueuePanelOpen,
    ...(isQueuePanelOpen ? { isChaptersPanelOpen: false } : {}),
  }),
  subtitleStyle: getSavedSubtitleStyle(),
  setSubtitleStyle: (style) => {
    localStorage.setItem("flow_subtitle_style", JSON.stringify(style));
    set({ subtitleStyle: style });
  },
}));
