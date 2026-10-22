import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import Player from "../player/Player";
import {
  useVideoStream,
  saveLocalWatchProgress,
  clearLocalWatchProgress,
} from "../../lib/useVideoStream";
import { prefetchStreamInfo } from "../../lib/streamResolution";
import { useWatchSession } from "../../lib/useWatchSession";
import { usePlaybackSettled } from "../../lib/usePlaybackSettled";
import { useVideoCategory } from "../../lib/useVideoCategory";
import { addWatchRecord } from "../../lib/api/db";
import { isMusicVideo } from "../../lib/utils";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { shouldRecordWatchHistory } from "../../lib/deepFlow";
import { seekToTime } from "../../lib/linkify";
import { classifyPlayerError } from "../../lib/playerError";
import { copyPlayerReport } from "../../lib/playerDiagnostics";
import { openExternal } from "../../lib/openExternal";
import { youtubeWatchUrl } from "../../lib/youtubeUrl";
import { getString } from "../../lib/i18n/index";
import type { FlowPlayerCoreProps } from "./types";

/** How close to the end the next video is resolved. Long enough to cover a slow
 * client ladder, short enough that a video abandoned early never triggers it. */
const NEXT_VIDEO_PREFETCH_LEAD_SECONDS = 20;

/**
 * Owns stream resolution (via useVideoStream) and all playback feedback —
 * progress persistence + recommendation logging. Reads `currentVideo`/`dearrowData`
 * via granular selectors and writes `currentTime` through an action, so its frequent
 * time updates never re-render sibling slots (metadata / related). The <Player> itself
 * owns its sizing and reads `isTheaterMode` directly.
 */
export function FlowPlayerCore({ videoId, videoDetails, onEnded }: FlowPlayerCoreProps) {
  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const dearrowData = usePlayerStore((s) => s.dearrowData);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const playNext = usePlayerStore((s) => s.playNext);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const autoplayEnabled = useAppSettingsStore((s) => s.values[SETTINGS.AUTOPLAY_ENABLED] !== "false");
  const showToast = useUiStore((s) => s.showToast);

  const stream = useVideoStream(videoId);

  const lastProgressPersistedAtRef = useRef(0);
  const latestProgressRef = useRef<{ videoId: string; time: number; duration: number } | null>(null);
  const prefetchedNextForRef = useRef<string | null>(null);

  /** Warm whatever plays after this video, once the end is close enough that it
   * is likely to be reached. An advance then starts from a resolved stream
   * rather than opening one after the current video has already stopped. */
  const prefetchNextVideo = useCallback(
    (time: number, mediaDuration: number) => {
      if (!currentVideo || !autoplayEnabled || repeatMode === "one") return;
      if (prefetchedNextForRef.current === currentVideo.id) return;
      if (!(mediaDuration > 0) || mediaDuration - time > NEXT_VIDEO_PREFETCH_LEAD_SECONDS) return;

      const { queue, currentIndex, autoplayCandidates } = usePlayerStore.getState();
      const upcoming = queue[currentIndex + 1] ?? autoplayCandidates[0] ?? null;
      prefetchedNextForRef.current = currentVideo.id;
      if (upcoming) prefetchStreamInfo(upcoming.id);
    },
    [autoplayEnabled, currentVideo, repeatMode],
  );

  useEffect(() => {
    prefetchedNextForRef.current = null;
  }, [currentVideo?.id]);

  const resolvedChannelId = videoDetails?.channelId || currentVideo?.channelId || "";
  const playbackSettled = usePlaybackSettled(currentVideo?.id);
  const category = useVideoCategory(currentVideo?.id, videoDetails?.category, playbackSettled);
  const watchSubject = useMemo(
    () =>
      currentVideo
        ? {
            videoId: currentVideo.id,
            // A video opened from a link carries only its id until its details load.
            title: currentVideo.title || videoDetails?.title || "",
            channelName: currentVideo.channelName || videoDetails?.channelName || "",
            channelId: resolvedChannelId.replace(/^channel:/, ""),
            description: videoDetails?.description || null,
            isLive: stream.isLive,
            isMusic: isMusicVideo(currentVideo),
            category,
          }
        : null,
    [
      currentVideo,
      resolvedChannelId,
      videoDetails?.title,
      videoDetails?.channelName,
      videoDetails?.description,
      category,
      stream.isLive,
    ],
  );
  const { onTime: reportWatchTime, onEnded: endWatchSession } = useWatchSession(watchSubject);

  const handleTimeUpdate = useCallback(
    (time: number, mediaDuration: number) => {
      const nextDuration = mediaDuration || currentVideo?.durationSeconds || 1;
      setCurrentTime(time);
      setDuration(nextDuration);
      prefetchNextVideo(time, nextDuration);

      if (!currentVideo) return;
      reportWatchTime(time, mediaDuration);
      latestProgressRef.current = { videoId: currentVideo.id, time, duration: nextDuration };
      if (!shouldRecordWatchHistory()) return;

      const now = Date.now();
      if (now - lastProgressPersistedAtRef.current < 5000) return;
      lastProgressPersistedAtRef.current = now;

      // localStorage writes are synchronous main-thread IO; keep them behind
      // the 5s gate instead of every timeupdate tick. The history effect
      // below flushes the exact final position when the video changes.
      saveLocalWatchProgress(currentVideo.id, time, nextDuration);
      void addWatchRecord({
        videoId: currentVideo.id,
        title: currentVideo.title,
        channelName: currentVideo.channelName,
        channelId: currentVideo.channelId ?? null,
        watchDate: new Date().toISOString(),
        watchDurationSeconds: Math.floor(time),
        totalDurationSeconds: Math.floor(nextDuration || 0),
        isMusic: isMusicVideo(currentVideo),
      });
    },
    [currentVideo, prefetchNextVideo, reportWatchTime, setCurrentTime, setDuration],
  );

  // Keyed by video id alone: details or a channel id arriving later must not
  // flush, and the progress written always belongs to the video it is filed under.
  const currentVideoRef = useRef(currentVideo);
  useEffect(() => {
    currentVideoRef.current = currentVideo;
  }, [currentVideo]);
  const currentVideoId = currentVideo?.id ?? null;
  useEffect(() => {
    if (!currentVideoId) return;

    const persistLatestProgress = () => {
      const latest = latestProgressRef.current;
      const video = currentVideoRef.current;
      if (!latest || latest.videoId !== currentVideoId || !video || video.id !== currentVideoId) return;
      if (!shouldRecordWatchHistory()) return;
      saveLocalWatchProgress(video.id, latest.time, latest.duration);
      void addWatchRecord({
        videoId: video.id,
        title: video.title,
        channelName: video.channelName,
        channelId: video.channelId ?? null,
        watchDate: new Date().toISOString(),
        watchDurationSeconds: Math.floor(latest.time),
        totalDurationSeconds: Math.floor(latest.duration || video.durationSeconds || 0),
        isMusic: isMusicVideo(video),
      });
    };

    window.addEventListener("beforeunload", persistLatestProgress);
    return () => {
      window.removeEventListener("beforeunload", persistLatestProgress);
      persistLatestProgress();
    };
  }, [currentVideoId]);

  const handleEnded = useCallback(() => {
    if (!currentVideo) return;
    endWatchSession();
    clearLocalWatchProgress(currentVideo.id);
    if (repeatMode === "one") {
      seekToTime(0);
      setIsPlaying(true);
      onEnded?.();
      return;
    }
    if (autoplayEnabled) {
      playNext(true);
    } else {
      setIsPlaying(false);
    }
    onEnded?.();
  }, [autoplayEnabled, currentVideo, endWatchSession, onEnded, playNext, repeatMode, setIsPlaying]);

  const title = (dearrowData?.title || currentVideo?.title) ?? "";
  const poster =
    dearrowData?.thumbnailUrl || currentVideo?.thumbnailUrl || videoDetails?.thumbnailUrl;

  const errorInfo = useMemo(
    () =>
      stream.streamError
        ? classifyPlayerError({
            message: stream.streamError,
            kind: stream.streamErrorKind ?? "unknown",
            startsAtMs: stream.streamStartsAtMs ?? undefined,
          })
        : null,
    [stream.streamError, stream.streamErrorKind, stream.streamStartsAtMs],
  );

  const watchUrl = videoId ? youtubeWatchUrl(videoId) : null;

  const handleCopyLogs = useCallback(async () => {
    if (!errorInfo) return false;
    const copied = await copyPlayerReport({
      surface: "video",
      error: errorInfo,
      videoId,
      title,
      watchUrl,
      details: {
        sourceMode: stream.sourceMode,
        selectedQualityId: stream.selectedQualityId,
        isLive: stream.isLive,
      },
    });
    if (!copied) {
      showToast({ variant: "error", message: getString("player_error_logs_copy_failed") });
    }
    return copied;
  }, [errorInfo, videoId, title, watchUrl, stream.sourceMode, stream.selectedQualityId, stream.isLive, showToast]);

  const handleOpenInBrowser = useCallback(() => {
    if (watchUrl) void openExternal(watchUrl);
  }, [watchUrl]);

  return (
    <Player
      src={stream.streamUrl}
      title={title}
      poster={poster}
      isLoading={stream.loadingStream}
      error={stream.streamError}
      errorInfo={errorInfo}
      onCopyLogs={handleCopyLogs}
      onOpenInBrowser={handleOpenInBrowser}
      qualities={stream.streamVariants}
      captions={stream.captions}
      audioTracks={stream.audioTracks}
      dashManifestUrl={stream.dashManifestUrl}
      hlsManifestUrl={stream.hlsManifestUrl}
      isLive={stream.isLive}
      selectedQualityId={stream.selectedQualityId}
      resumeTime={stream.resumeTime}
      sourceMode={stream.sourceMode}
      chapters={videoDetails?.chapters}
      onRetrySource={stream.onRetrySource}
      onSelectQuality={stream.onSelectQuality}
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleEnded}
      onRetry={stream.onHardRetry}
    />
  );
}
