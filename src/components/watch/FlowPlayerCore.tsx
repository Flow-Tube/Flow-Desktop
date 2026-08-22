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
import { logInteraction } from "../../lib/api/recommendation";
import { addWatchRecord } from "../../lib/api/db";
import { isMusicVideo } from "../../lib/utils";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { shouldRecordWatchHistory } from "../../lib/deepFlow";
import { seekToTime } from "../../lib/linkify";
import { classifyPlayerError } from "../../lib/playerError";
import { copyPlayerReport } from "../../lib/playerDiagnostics";
import { openExternal } from "../../lib/openExternal";
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
  const latestProgressRef = useRef<{ time: number; duration: number } | null>(null);
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

  const resolvedChannelId =
    videoDetails?.channelId || currentVideo?.channelId || currentVideo?.id || "";

  const handleTimeUpdate = useCallback(
    (time: number, mediaDuration: number) => {
      const nextDuration = mediaDuration || currentVideo?.durationSeconds || 1;
      setCurrentTime(time);
      setDuration(nextDuration);
      prefetchNextVideo(time, nextDuration);

      if (!currentVideo) return;
      latestProgressRef.current = { time, duration: nextDuration };
      const recordHistory = shouldRecordWatchHistory();

      const now = Date.now();
      if (now - lastProgressPersistedAtRef.current < 5000) return;
      lastProgressPersistedAtRef.current = now;

      // localStorage writes are synchronous main-thread IO; keep them behind
      // the 5s gate instead of every timeupdate tick. persistLatestProgress
      // below flushes the exact final position on unmount/beforeunload.
      if (recordHistory) {
        saveLocalWatchProgress(currentVideo.id, time, nextDuration);
      }

      const percentWatched = nextDuration > 0 ? Math.min(1, Math.max(0, time / nextDuration)) : 0;
      void logInteraction(
        currentVideo.id,
        currentVideo.title,
        currentVideo.channelName,
        resolvedChannelId || currentVideo.id,
        videoDetails?.description || null,
        Math.floor(nextDuration) || null,
        false,
        nextDuration <= 60,
        "WATCHED",
        percentWatched,
      ).catch((err) => console.warn("Failed to log watch interaction", err));

      if (recordHistory) {
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
      }
    },
    [currentVideo, prefetchNextVideo, resolvedChannelId, setCurrentTime, setDuration, videoDetails],
  );

  useEffect(() => {
    if (!currentVideo) return;

    const persistLatestProgress = () => {
      const latest = latestProgressRef.current;
      if (!latest) return;
      const recordHistory = shouldRecordWatchHistory();
      if (recordHistory) {
        saveLocalWatchProgress(currentVideo.id, latest.time, latest.duration);
      }

      const duration = latest.duration || currentVideo.durationSeconds || 1;
      const percentWatched = duration > 0 ? Math.min(1, Math.max(0, latest.time / duration)) : 0;
      const finalType = latest.time < 15 && percentWatched < 0.15 ? "SKIPPED" : "WATCHED";
      void logInteraction(
        currentVideo.id,
        currentVideo.title,
        currentVideo.channelName,
        resolvedChannelId || currentVideo.id,
        videoDetails?.description || null,
        Math.floor(duration) || null,
        false,
        duration <= 60,
        finalType,
        percentWatched,
      ).catch((err) => console.warn("Failed to log final watch interaction", err));

      if (recordHistory) {
        void addWatchRecord({
          videoId: currentVideo.id,
          title: currentVideo.title,
          channelName: currentVideo.channelName,
          channelId: currentVideo.channelId ?? null,
          watchDate: new Date().toISOString(),
          watchDurationSeconds: Math.floor(latest.time),
          totalDurationSeconds: Math.floor(latest.duration || currentVideo.durationSeconds || 0),
          isMusic: isMusicVideo(currentVideo),
        });
      }
    };

    window.addEventListener("beforeunload", persistLatestProgress);
    return () => {
      window.removeEventListener("beforeunload", persistLatestProgress);
      persistLatestProgress();
    };
  }, [currentVideo, resolvedChannelId, videoDetails]);

  const handleEnded = useCallback(() => {
    if (!currentVideo) return;
    const duration = latestProgressRef.current?.duration || currentVideo.durationSeconds || 1;
    void logInteraction(
      currentVideo.id,
      currentVideo.title,
      currentVideo.channelName,
      resolvedChannelId || currentVideo.id,
      videoDetails?.description || null,
      Math.floor(duration) || null,
      false,
      duration <= 60,
      "WATCHED",
      1,
    ).catch((err) => console.warn("Failed to log watch interaction on ended", err));

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
  }, [autoplayEnabled, currentVideo, onEnded, playNext, repeatMode, resolvedChannelId, setIsPlaying, videoDetails]);

  const title = (dearrowData?.title || currentVideo?.title) ?? "";
  const poster =
    dearrowData?.thumbnailUrl || currentVideo?.thumbnailUrl || videoDetails?.thumbnailUrl;

  const errorInfo = useMemo(
    () =>
      stream.streamError
        ? classifyPlayerError({
            message: stream.streamError,
            kind: stream.streamErrorKind ?? "unknown",
          })
        : null,
    [stream.streamError, stream.streamErrorKind],
  );

  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;

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
