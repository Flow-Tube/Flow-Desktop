import { create } from "zustand";
import type { CaptionTrack, RelatedContentItem, VideoDetails, VideoSummary } from "../types/video";
import { prefetchStreamInfo } from "../lib/streamResolution";
import { moveAfterId, orderByIds } from "../lib/listOrder";
import { fisherYates } from "../lib/musicShuffle";
import { appendUniqueVideos } from "../lib/playlistPages";
import { queueWith, remoteControl } from "./useRemoteControlStore";
import { profileStorage } from "../lib/storage/profileStorage";

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

/** The playlist a queue was started from, named in the queue panel. */
export interface PlaylistContext {
  id: string;
  title: string;
  /** Removing a video in the panel removes it from the playlist too (Watch Later, the user's own). */
  editable: boolean;
  /** Started in the playlist's Manual order, so a drag in the panel is saved to it too. */
  reorderable: boolean;
}

export interface WatchPageCache {
  videoId: string;
  videoDetails: VideoDetails | null;
  relatedVideos: RelatedContentItem[];
  /** The token for the related lane's next page. */
  relatedContinuation: string | null;
  updatedAt: number;
}

export interface SubtitleStyle {
  /** Percent of YouTube's default caption size, which scales with the player. */
  fontScale: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  isBold: boolean;
  /** Percent of the player's height between its bottom and the captions'. */
  bottomOffset: number;
}

/** YouTube's caption font size options. */
export const SUBTITLE_FONT_SCALES = [50, 75, 100, 150, 200, 300, 400];

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontScale: 100,
  textColor: "#FFFFFF",
  backgroundColor: "#000000",
  backgroundOpacity: 0.75,
  isBold: true,
  // YouTube's: its caption box sits 2% of the player's height above the bottom.
  bottomOffset: 2,
};

const getSavedSubtitleStyle = (): SubtitleStyle => {
  try {
    const saved = profileStorage.getItem("flow_subtitle_style");
    if (saved) {
      // A style saved by an older build lacks the newer fields; they take the defaults.
      return { ...DEFAULT_SUBTITLE_STYLE, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error("Failed to parse saved subtitle style", e);
  }
  return DEFAULT_SUBTITLE_STYLE;
};

const getSavedTheaterMode = (): boolean => {
  try {
    return profileStorage.getItem("flow_theater_mode") === "true";
  } catch (e) {
    console.error("Failed to load saved theater mode", e);
  }
  return false;
};

export interface PlayerState {
  currentVideo: VideoSummary | null;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  isVideoFullscreenTransitioning: boolean;
  playbackRate: PlaybackRate;
  queue: VideoSummary[];
  currentIndex: number;
  playlistContext: PlaylistContext | null;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  /** The order turning shuffle off restores; null while shuffle is off. */
  unshuffledQueue: VideoSummary[] | null;
  /** Videos added with Add to queue during a playlist: they play next and are never saved to it. */
  manualQueueIds: Set<string>;
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
  videoAspectRatio: number | null;
  setVideoAspectRatio: (ratio: number | null) => void;

  setCurrentVideo: (video: VideoSummary | null) => void;
  /** Fill in fields of the playing video that arrived after playback started —
   * a cold open plays from the id alone and gets its title/channel afterwards. */
  enrichCurrentVideo: (videoId: string, patch: Partial<VideoSummary>) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean | ((previous: boolean) => boolean)) => void;
  setIsVideoFullscreenTransitioning: (transitioning: boolean) => void;
  setPlaybackRate: (playbackRate: PlaybackRate) => void;
  setQueue: (
    queue: VideoSummary[],
    startIndex?: number,
    playlistContext?: PlaylistContext | null,
    unshuffledQueue?: VideoSummary[] | null,
  ) => void;
  /** Replaces the queue around the video playing, which carries on; it goes first when `videos` leaves it out. */
  replaceQueue: (videos: VideoSummary[]) => void;
  addToQueue: (video: VideoSummary) => QueueAddResult;
  removeFromQueue: (index: number) => void;
  /** Puts a removed video back at its old place, for Undo. */
  restoreQueueItem: (video: VideoSummary, index: number) => void;
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
  /**
   * The side panel shown beside the video in fullscreen. It starts closed on every entry, so a
   * queue panel left open in the sidebar does not shrink the picture; opening chapters or the
   * queue here also leaves it open in the sidebar afterwards. Chat only appears here.
   */
  fullscreenPanel: FullscreenPanel | null;
  setFullscreenPanel: (panel: FullscreenPanel | null) => void;
  /** The watch page has a live chat or chat replay to show. */
  isLiveChatAvailable: boolean;
  setIsLiveChatAvailable: (available: boolean) => void;
}

export type FullscreenPanel = "chapters" | "queue" | "chat";

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentVideo: null,
  isPlaying: false,
  volume: 1,
  muted: false,
  isVideoFullscreenTransitioning: false,
  playbackRate: 1,
  queue: [],
  currentIndex: -1,
  playlistContext: null,
  repeatMode: "none",
  isShuffle: false,
  unshuffledQueue: null,
  manualQueueIds: new Set<string>(),
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
  fullscreenPanel: null,
  isLiveChatAvailable: false,
  videoAspectRatio: null,
  setVideoAspectRatio: (ratio) => set({ videoAspectRatio: ratio }),

  setCurrentVideo: (video) => {
    const isNew = get().currentVideo?.id !== video?.id;
    set({
      currentVideo: video,
      isPlaying: !!video,
      isChaptersPanelOpen: false,
      isQueuePanelOpen: false,
      fullscreenPanel: null,
      ...(isNew ? { videoPlayerMode: "watch", videoPipIntent: null, watchPageCache: null, videoAspectRatio: null } : {}),
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
    // A patch that changes nothing must not hand subscribers a new object: the
    // watch page re-enriches whenever the title is still empty.
    const changes = (Object.keys(patch) as (keyof VideoSummary)[]).some(
      (key) => currentVideo[key] !== patch[key],
    );
    if (!changes) return;
    set({
      currentVideo: { ...currentVideo, ...patch },
      queue: queue.map((item) => (item.id === videoId ? { ...item, ...patch } : item)),
    });
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),

  setMuted: (muted) =>
    set((state) => ({ muted: typeof muted === "function" ? muted(state.muted) : muted })),

  setIsVideoFullscreenTransitioning: (isVideoFullscreenTransitioning) =>
    set({ isVideoFullscreenTransitioning }),

  setPlaybackRate: (playbackRate) => set({ playbackRate: Math.min(4, Math.max(0.25, playbackRate)) }),

  replaceQueue: (videos) => {
    const { currentVideo, isShuffle } = get();
    if (!currentVideo) return;
    const unique = appendUniqueVideos([], videos);
    const at = unique.findIndex((item) => item.id === currentVideo.id);
    const queue = at >= 0 ? unique.map((item, i) => (i === at ? currentVideo : item)) : [currentVideo, ...unique];
    set({
      queue,
      currentIndex: Math.max(0, at),
      playlistContext: null,
      manualQueueIds: new Set<string>(),
      unshuffledQueue: isShuffle ? queue : null,
    });
  },

  setQueue: (rawQueue, startIndex = 0, playlistContext = null, unshuffledQueue = null) => {
    const remote = remoteControl();
    if (remote) return remote.play(rawQueue.map((item) => item.id), startIndex, false);
    // Rows and drag handles are keyed by video id, and a YouTube playlist can list one twice.
    const queue = appendUniqueVideos([], rawQueue);
    const startId = rawQueue[startIndex]?.id;
    const startIdIndex = startId ? queue.findIndex((item) => item.id === startId) : -1;
    const safeIndex = queue.length === 0
      ? -1
      : startIdIndex >= 0
        ? startIdIndex
        : Math.max(0, Math.min(startIndex, queue.length - 1));
    const nextVideo = safeIndex >= 0 ? queue[safeIndex] || null : null;
    const isNew = get().currentVideo?.id !== nextVideo?.id;
    set({
      queue,
      currentIndex: safeIndex,
      playlistContext,
      isShuffle: unshuffledQueue !== null,
      unshuffledQueue: unshuffledQueue && appendUniqueVideos([], unshuffledQueue),
      manualQueueIds: new Set<string>(),
      currentVideo: nextVideo,
      isPlaying: queue.length > 0,
      videoPlayerMode: "watch",
      videoPipIntent: null,
      isChaptersPanelOpen: false,
      isQueuePanelOpen: Boolean(playlistContext) || queue.length > 1,
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
    const remote = remoteControl();
    if (remote) {
      remote.command("queue", { queue: queueWith(remote, [video.id], false) });
      return "added";
    }
    const { queue, currentVideo, currentIndex, playlistContext, manualQueueIds } = get();
    if (queue.some((item) => item.id === video.id) || currentVideo?.id === video.id) {
      return "duplicate";
    }

    // With nothing playing, a queued video would never show, so it plays in the mini player.
    if (queue.length === 0 && !currentVideo) {
      get().setQueue([video], 0);
      get().enterVideoPip("auto");
      return "added";
    }

    // The queue and chapters panels share one slot.
    const openQueuePanel = { isQueuePanelOpen: true, isChaptersPanelOpen: false };

    if (queue.length === 0 && currentVideo) {
      set({ queue: [currentVideo, video], currentIndex: 0, ...openQueuePanel });
      return "added";
    }

    // After the current video and earlier additions, not behind the whole playlist.
    if (playlistContext && currentIndex >= 0) {
      let insertAt = currentIndex + 1;
      while (insertAt < queue.length && manualQueueIds.has(queue[insertAt]?.id ?? "")) {
        insertAt += 1;
      }
      const nextQueue = [...queue.slice(0, insertAt), video, ...queue.slice(insertAt)];
      set({
        queue: nextQueue,
        manualQueueIds: new Set(manualQueueIds).add(video.id),
        ...openQueuePanel,
      });
      return "added";
    }

    const nextQueue = [...queue, video];
    set({
      queue: nextQueue,
      currentIndex: currentVideo && currentIndex < 0 ? 0 : currentIndex,
      ...openQueuePanel,
    });
    return "added";
  },

  removeFromQueue: (index) => {
    const { queue, currentIndex, manualQueueIds } = get();
    const removedId = queue[index]?.id;
    const newQueue = queue.filter((_, i) => i !== index);
    let newIndex = currentIndex;
    if (index < currentIndex) {
      newIndex = currentIndex - 1;
    } else if (index === currentIndex) {
      newIndex = Math.min(currentIndex, newQueue.length - 1);
    }
    const nextManual = new Set(manualQueueIds);
    if (removedId) nextManual.delete(removedId);
    set({
      queue: newQueue,
      currentIndex: newIndex,
      currentVideo: newQueue[newIndex] || null,
      manualQueueIds: nextManual,
    });
  },

  restoreQueueItem: (video, index) => {
    const { queue, currentIndex } = get();
    if (queue.some((item) => item.id === video.id)) return;
    const at = Math.max(0, Math.min(index, queue.length));
    set({
      queue: [...queue.slice(0, at), video, ...queue.slice(at)],
      currentIndex: at <= currentIndex ? currentIndex + 1 : currentIndex,
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
    const remote = remoteControl();
    if (remote) {
      remote.command("next");
      return null;
    }
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
          // Autoplay has gone past the end of the playlist.
          playlistContext: null,
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
    const remote = remoteControl();
    if (remote) return remote.command("previous");
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
    const { queue, currentIndex, currentVideo, unshuffledQueue, manualQueueIds } = get();
    const played = queue.slice(0, currentIndex + 1);
    const upcoming = queue.slice(currentIndex + 1);
    // Videos added during the playlist keep their place right after the current one.
    const pinned = upcoming.filter((item) => manualQueueIds.has(item.id));
    const rest = upcoming.filter((item) => !manualQueueIds.has(item.id));

    if (!unshuffledQueue) {
      set({ isShuffle: true, unshuffledQueue: queue, queue: [...played, ...pinned, ...fisherYates(rest)] });
      return;
    }

    // Matched by id so details filled in meanwhile survive; videos added while shuffled go last.
    const savedIds = new Set(unshuffledQueue.map((item) => item.id));
    let restored = orderByIds([...played, ...rest], [...savedIds]);
    if (currentVideo && !savedIds.has(currentVideo.id)) {
      // Except the one playing now: sent last, it would leave every unplayed video behind it.
      const anchor = played.slice(0, -1).reverse().find((item) => savedIds.has(item.id));
      restored = moveAfterId(restored, currentVideo.id, anchor?.id ?? null);
    }
    const restoredIndex = restored.findIndex((item) => item.id === currentVideo?.id);
    const pinAt = restoredIndex + 1;
    set({
      isShuffle: false,
      unshuffledQueue: null,
      queue: [...restored.slice(0, pinAt), ...pinned, ...restored.slice(pinAt)],
      currentIndex: restoredIndex >= 0 ? restoredIndex : currentIndex,
    });
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
    playlistContext: null,
    isShuffle: false,
    unshuffledQueue: null,
    manualQueueIds: new Set<string>(),
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
    fullscreenPanel: null,
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
        relatedVideos: cache.relatedVideos ?? (previous?.videoId === videoId ? previous.relatedVideos : []),
        relatedContinuation:
          cache.relatedContinuation !== undefined
            ? cache.relatedContinuation
            : previous?.videoId === videoId
              ? previous.relatedContinuation
              : null,
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
    profileStorage.setItem("flow_theater_mode", String(isTheaterMode));
    set({ isTheaterMode });
  },
  setSponsorBlockSegments: (sponsorBlockSegments) => set({ sponsorBlockSegments }),
  setDearrowData: (dearrowData) => set({ dearrowData }),
  setRydData: (rydData) => set({ rydData }),
  setCaptions: (captions) => set({ captions }),
  setIsChaptersPanelOpen: (isChaptersPanelOpen) => set((state) => ({
    isChaptersPanelOpen,
    ...(isChaptersPanelOpen ? { isQueuePanelOpen: false } : {}),
    ...(!isChaptersPanelOpen && state.fullscreenPanel === "chapters" ? { fullscreenPanel: null } : {}),
  })),
  setIsQueuePanelOpen: (isQueuePanelOpen) => set((state) => ({
    isQueuePanelOpen,
    ...(isQueuePanelOpen ? { isChaptersPanelOpen: false } : {}),
    ...(!isQueuePanelOpen && state.fullscreenPanel === "queue" ? { fullscreenPanel: null } : {}),
  })),
  setFullscreenPanel: (fullscreenPanel) => set({
    fullscreenPanel,
    ...(fullscreenPanel === "chapters" ? { isChaptersPanelOpen: true, isQueuePanelOpen: false } : {}),
    ...(fullscreenPanel === "queue" ? { isQueuePanelOpen: true, isChaptersPanelOpen: false } : {}),
  }),
  setIsLiveChatAvailable: (isLiveChatAvailable) => set({ isLiveChatAvailable }),
  subtitleStyle: getSavedSubtitleStyle(),
  setSubtitleStyle: (style) => {
    profileStorage.setItem("flow_subtitle_style", JSON.stringify(style));
    set({ subtitleStyle: style });
  },
}));
