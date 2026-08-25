import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../store/usePlayerStore";
import { invalidateStreamInfo, resolveStreamInfo } from "./streamResolution";
import { classifyPlayerError } from "./playerError";
import { recordPlayerEvent } from "./playerDiagnostics";
import { getOfflineStream } from "./api/downloads";
import { findDownloadedRecord } from "./useDownloads";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { addWatchRecord } from "./api/db";
import { isMusicVideo } from "./utils";
import { SETTINGS } from "./settings/schema";
import { filterByPreferredCodec, selectPreferredStreamVariant } from "./settings/playerRuntime";
import { codecRank } from "./codecPreference";
import { shouldRecordWatchHistory } from "./deepFlow";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import type { AudioTrack, CaptionTrack, StreamInfo, StreamVariant, VideoSummary } from "../types/video";

export type SourceMode = "hls" | "dash-native" | "sabr-dash" | "direct" | "unavailable";

const PROGRESS_PREFIX = "flow_watch_progress:";
const getProgressKey = (videoId: string) => `${PROGRESS_PREFIX}${videoId}`;

type SavedWatchProgress = { currentTime: number; duration: number; updatedAt: number };

export const readSavedWatchProgress = (videoId: string, fallbackDuration = 0): number => {
  try {
    const raw = localStorage.getItem(getProgressKey(videoId));
    if (!raw) return 0;
    const progress = JSON.parse(raw) as SavedWatchProgress;
    const duration = progress.duration || fallbackDuration || 0;
    if (!Number.isFinite(progress.currentTime) || progress.currentTime < 5) return 0;
    if (duration > 0 && progress.currentTime >= Math.max(0, duration - 12)) return 0;
    return Math.max(0, progress.currentTime);
  } catch (error) {
    console.warn("Failed to read saved watch progress", error);
    return 0;
  }
};

export const saveLocalWatchProgress = (videoId: string, currentTime: number, duration: number) => {
  if (!Number.isFinite(currentTime) || currentTime < 0) return;
  try {
    if (duration > 0 && currentTime >= Math.max(0, duration - 12)) {
      localStorage.removeItem(getProgressKey(videoId));
      return;
    }
    localStorage.setItem(
      getProgressKey(videoId),
      JSON.stringify({ currentTime, duration, updatedAt: Date.now() } satisfies SavedWatchProgress),
    );
  } catch (error) {
    console.warn("Failed to save watch progress", error);
  }
};

export const clearLocalWatchProgress = (videoId: string) => {
  try {
    localStorage.removeItem(getProgressKey(videoId));
  } catch (error) {
    console.warn("Failed to clear watch progress", error);
  }
};

/**
 * Where playback should pick up, and whether it should be running when it does.
 * A handoff between the main window and the pop-out player wins over saved
 * progress: it is exact, it carries the paused state the user chose, and it
 * survives Deep Flow, which suppresses the saved-progress write entirely.
 */
const resolveHandoff = (video: VideoSummary, isLive: boolean) => {
  const handoff = usePlayerStore.getState().consumePipHandoff(video.id);
  if (handoff) {
    return { resumeTime: isLive ? 0 : handoff.positionSeconds, playing: handoff.playing };
  }
  return {
    resumeTime: isLive ? 0 : readSavedWatchProgress(video.id, video.durationSeconds ?? 0),
    playing: true,
  };
};

const selectVariantByBandwidth = (
  variants: StreamVariant[],
  canUseAdaptive: boolean,
  preferredCodec: string,
): StreamVariant | null => {
  const connection =
    (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  const downlink = connection && typeof connection.downlink === "number" ? connection.downlink : 10;

  let targetHeight = 240;
  if (downlink > 25) targetHeight = 2160;
  else if (downlink > 15) targetHeight = 1440;
  else if (downlink > 8) targetHeight = 1080;
  else if (downlink > 4) targetHeight = 720;
  else if (downlink > 2) targetHeight = 480;
  else if (downlink > 0.8) targetHeight = 360;

  const playable = filterByPreferredCodec(
    variants.filter((v) => v.isPlayable && (v.hasAudio || canUseAdaptive)),
    preferredCodec,
  );
  if (playable.length === 0) return null;

  return (
    [...playable].sort(
      (a, b) =>
        Math.abs((a.height || 0) - targetHeight) - Math.abs((b.height || 0) - targetHeight) ||
        codecRank(a.mimeType) - codecRank(b.mimeType),
    )[0] ?? null
  );
};

const browserSupportsVP9 = () =>
  typeof MediaSource !== "undefined" &&
  typeof MediaSource.isTypeSupported === "function" &&
  MediaSource.isTypeSupported('video/webm; codecs="vp9"');

const computeAvailableSourceModes = (info: StreamInfo): SourceMode[] => {
  const modes: SourceMode[] = [];
  const isLive = !!info.isLive;

  if (isLive && info.hlsManifestUrl) modes.push("hls");
  if (info.dashManifestUrl && browserSupportsVP9()) modes.push("dash-native");
  if (!isLive) {
    const canUseAdaptive = (info.audioTracks || []).some((track) => !!track.localUrl);
    const hasDirect =
      (info.variants || []).some((v) => v.isPlayable && (v.hasAudio || canUseAdaptive)) || !!info.localUrl;
    if (hasDirect) modes.push("direct");
    if (info.sabr?.available && info.sabr?.manifestUrl) modes.push("sabr-dash");
  }
  if (info.hlsManifestUrl && !modes.includes("hls")) modes.push("hls");
  if (isLive && info.dashManifestUrl && !modes.includes("dash-native")) modes.push("dash-native");
  return modes;
};

const pickDirectVariantUrl = (info: StreamInfo, qualityId: string, preferredCodec: string): string | null => {
  const canUseAdaptive = (info.audioTracks || []).some((track) => !!track.localUrl);
  let chosen: StreamVariant | null = null;
  if (!qualityId || qualityId === "auto") {
    chosen = selectVariantByBandwidth(info.variants || [], canUseAdaptive, preferredCodec);
  } else {
    chosen = info.variants?.find((v) => v.id === qualityId) || null;
  }
  if (!chosen) {
    chosen =
      info.variants?.find((v) => v.isDefault && v.isPlayable && (v.hasAudio || canUseAdaptive)) ||
      info.variants?.find((v) => v.isPlayable && (v.hasAudio || canUseAdaptive)) ||
      null;
  }
  return chosen?.localUrl || info.localUrl || null;
};

export interface VideoStream {
  streamUrl: string | null;
  streamVariants: StreamVariant[];
  captions: CaptionTrack[];
  audioTracks: AudioTrack[];
  dashManifestUrl: string | null;
  hlsManifestUrl: string | null;
  isLive: boolean;
  sourceMode: SourceMode;
  selectedQualityId: string;
  resumeTime: number;
  loadingStream: boolean;
  streamError: string | null;
  streamErrorKind: string | null;
  setResumeTime: (time: number) => void;
  onSelectQuality: (variant: StreamVariant | "auto") => void;
  onRetrySource: (reason: string) => void;
  onHardRetry: () => void;
}

/**
 * Resolves a playable stream for the active video and owns all source-mode
 * fallback / quality-switch logic. Captions are mirrored into the player
 * store so sibling panels (Chapters/transcript) can read them without prop drilling.
 */
export function useVideoStream(videoId: string | undefined): VideoStream {
  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const setCaptionsInStore = usePlayerStore((s) => s.setCaptions);
  const preferredQuality = useAppSettingsStore((s) => s.values[SETTINGS.DEFAULT_QUALITY_WIFI] ?? "1080p");
  const preferredCodec = useAppSettingsStore((s) => s.values[SETTINGS.DEFAULT_VIDEO_CODEC] ?? "H.264");

  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamVariants, setStreamVariants] = useState<StreamVariant[]>([]);
  const [captions, setCaptions] = useState<CaptionTrack[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [dashManifestUrl, setDashManifestUrl] = useState<string | null>(null);
  const [hlsManifestUrl, setHlsManifestUrl] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("unavailable");
  const [selectedQualityId, setSelectedQualityId] = useState<string>("auto");
  const [resumeTime, setResumeTime] = useState(0);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamErrorKind, setStreamErrorKind] = useState<string | null>(null);

  const streamInfoRef = useRef<StreamInfo | null>(null);
  const attemptedModesRef = useRef<Set<SourceMode>>(new Set());
  const stallExhaustedCyclesRef = useRef(0);
  // Resolution is asynchronous and a user can switch videos mid-flight; only the
  // newest load may write state, so a late answer never overwrites a newer one.
  const loadTokenRef = useRef(0);

  const publishCaptions = useCallback(
    (tracks: CaptionTrack[]) => {
      setCaptions(tracks);
      setCaptionsInStore(tracks);
    },
    [setCaptionsInStore],
  );

  useEffect(() => {
    if (!currentVideo || currentVideo.id !== videoId) return;

    const loadToken = ++loadTokenRef.current;
    const isCurrentLoad = () => loadTokenRef.current === loadToken;

    const loadStream = async () => {
      setLoadingStream(true);
      setStreamError(null);
      setStreamErrorKind(null);
      stallExhaustedCyclesRef.current = 0;
      recordPlayerEvent(`video resolve start: ${currentVideo.id}`);
      setStreamUrl(null);
      setDashManifestUrl(null);
      setHlsManifestUrl(null);
      setAudioTracks([]);
      setStreamVariants([]);
      publishCaptions([]);
      setIsLive(false);
      setSourceMode("unavailable");
      setResumeTime(0);
      try {
        // The downloads library is a SQLite read and stream resolution is a
        // network round trip. When the library still has to load, overlap the
        // two instead of paying them back to back — first frame only ever waits
        // on the slower of the pair. Once it is loaded the offline check is
        // synchronous, so a saved video still costs no network at all.
        let streamRequest: Promise<StreamInfo> | null = null;
        if (!useDownloadsLibraryStore.getState().loaded) {
          streamRequest = resolveStreamInfo(currentVideo.id);
          streamRequest.catch(() => {});
          await useDownloadsLibraryStore.getState().ensureLoaded();
          if (!isCurrentLoad()) return;
        }

        // A saved video plays straight from disk — no stream resolution, no
        // network. One progressive source, so source-mode fallback is skipped.
        if (findDownloadedRecord(currentVideo.id, "video")) {
          try {
            const offline = await getOfflineStream(currentVideo.id, "video");
            if (!isCurrentLoad()) return;
            streamInfoRef.current = null;
            attemptedModesRef.current = new Set(["direct"]);
            setSelectedQualityId("auto");
            const offlineHandoff = resolveHandoff(currentVideo, false);
            setResumeTime(offlineHandoff.resumeTime);
            setSourceMode("direct");
            setStreamUrl(offline.url);
            setIsPlaying(offlineHandoff.playing);
            if (shouldRecordWatchHistory()) {
              void addWatchRecord({
                videoId: currentVideo.id,
                title: currentVideo.title,
                channelName: currentVideo.channelName,
                channelId: currentVideo.channelId ?? null,
                watchDate: new Date().toISOString(),
                watchDurationSeconds: 0,
                totalDurationSeconds: currentVideo.durationSeconds ?? 0,
                isMusic: isMusicVideo(currentVideo),
              }).catch((err) => console.warn("Failed to record watch history", err));
            }
            return;
          } catch (offlineError) {
            console.warn("Offline video unavailable, falling back to stream", offlineError);
          }
        }

        const info = await (streamRequest ?? resolveStreamInfo(currentVideo.id));
        if (!isCurrentLoad()) return;
        streamInfoRef.current = info;
        attemptedModesRef.current = new Set();
        setStreamVariants(info.variants || []);
        publishCaptions(info.captions || []);
        setAudioTracks(info.audioTracks || []);
        setIsLive(!!info.isLive);

        const canUseAdaptive = (info.audioTracks || []).some((track) => !!track.localUrl);
        const preferredVariant = selectPreferredStreamVariant(
          info.variants || [],
          preferredQuality,
          preferredCodec,
          canUseAdaptive,
        );
        let initialQualityId = preferredVariant?.id || (preferredQuality === "Auto" ? "auto" : selectedQualityId || "auto");
        if (initialQualityId === "null" || !initialQualityId) initialQualityId = "auto";
        setSelectedQualityId(initialQualityId);

        // A live broadcast has no meaningful resume point.
        const handoff = resolveHandoff(currentVideo, !!info.isLive);
        setResumeTime(handoff.resumeTime);

        const availableModes = computeAvailableSourceModes(info);
        const initialMode: SourceMode = availableModes[0] || "unavailable";
        attemptedModesRef.current.add(initialMode);
        setSourceMode(initialMode);

        if (initialMode === "unavailable") {
          setStreamError(
            info.isLive
              ? "This live broadcast did not return a playable manifest."
              : "No playable source was returned for this video.",
          );
          setStreamErrorKind("streaming");
          recordPlayerEvent(`video resolve produced no source (live=${info.isLive})`);
          return;
        }

        if (initialMode === "hls") {
          setHlsManifestUrl(info.hlsManifestUrl || null);
          setDashManifestUrl(null);
          setStreamUrl(null);
        } else if (initialMode === "dash-native") {
          setHlsManifestUrl(null);
          setDashManifestUrl(info.dashManifestUrl || null);
          setStreamUrl(info.dashManifestUrl || null);
        } else if (initialMode === "sabr-dash") {
          setHlsManifestUrl(null);
          setDashManifestUrl(info.sabr?.manifestUrl || null);
          setStreamUrl(info.sabr?.manifestUrl || null);
        } else {
          setHlsManifestUrl(null);
          setDashManifestUrl(null);
          setStreamUrl(pickDirectVariantUrl(info, initialQualityId, preferredCodec));
        }

        setIsPlaying(handoff.playing);

        // The history write is a SQLite round trip nothing on screen waits for.
        if (shouldRecordWatchHistory()) {
          void addWatchRecord({
            videoId: currentVideo.id,
            title: currentVideo.title,
            channelName: currentVideo.channelName,
            channelId: currentVideo.channelId ?? null,
            watchDate: new Date().toISOString(),
            watchDurationSeconds: Math.floor(
              readSavedWatchProgress(currentVideo.id, currentVideo.durationSeconds ?? 0),
            ),
            totalDurationSeconds: currentVideo.durationSeconds ?? 0,
            isMusic: isMusicVideo(currentVideo),
          }).catch((err) => console.warn("Failed to record watch history", err));
        }
      } catch (err) {
        if (!isCurrentLoad()) return;
        setStreamUrl(null);
        setStreamVariants([]);
        publishCaptions([]);
        setAudioTracks([]);
        setDashManifestUrl(null);
        setHlsManifestUrl(null);
        setIsLive(false);
        setSelectedQualityId("auto");
        const info = classifyPlayerError(err);
        setStreamError(info.rawMessage);
        setStreamErrorKind(info.kind);
        recordPlayerEvent(`video resolve failed: ${info.kind} (${info.rawMessage})`);
        console.error("Failed to load stream URL", err);
      } finally {
        if (isCurrentLoad()) setLoadingStream(false);
      }
    };

    void loadStream();
  }, [currentVideo, videoId, setIsPlaying, publishCaptions, preferredCodec, preferredQuality]);

  const onSelectQuality = useCallback(
    (variant: StreamVariant | "auto") => {
      if (variant === "auto") {
        setSelectedQualityId("auto");
        setIsPlaying(true);
        if (dashManifestUrl) return;
        const canUseAdaptive = audioTracks.some((track) => !!track.localUrl);
        const chosenVariant = selectVariantByBandwidth(streamVariants, canUseAdaptive, preferredCodec);
        if (chosenVariant) {
          setResumeTime(usePlayerStore.getState().currentTime);
          setStreamUrl(chosenVariant.localUrl);
        }
        return;
      }

      if (!variant.isPlayable) return;
      if (!dashManifestUrl && !variant.hasAudio && !audioTracks.some((track) => !!track.localUrl)) return;

      if (dashManifestUrl) {
        setSelectedQualityId(variant.id);
        setIsPlaying(true);
        return;
      }
      setResumeTime(usePlayerStore.getState().currentTime);
      setSelectedQualityId(variant.id);
      setStreamUrl(variant.localUrl);
      setIsPlaying(true);
    },
    [audioTracks, dashManifestUrl, preferredCodec, setIsPlaying, streamVariants],
  );

  const onRetrySource = useCallback(
    (reason: string) => {
      const info = streamInfoRef.current;
      if (!info) return;
      const available = computeAvailableSourceModes(info);
      const resumeAt = usePlayerStore.getState().currentTime || 0;

      attemptedModesRef.current.add(sourceMode);
      const next = available.find((mode) => !attemptedModesRef.current.has(mode));
      console.warn("[Watch] source-mode fallback", { reason, from: sourceMode, next, available });
      recordPlayerEvent(`video source fallback: ${reason} from=${sourceMode} next=${next ?? "none"}`);

      if (!next) {
        if (!reason.startsWith("buffering-stall")) {
          setStreamError("Playback failed on all available sources for this video.");
          setStreamErrorKind("streaming");
          recordPlayerEvent("video playback failed: all sources exhausted");
          return;
        }
        // First exhausted stall cycle: let the last source keep buffering.
        // On repeat, surface a real error instead of an endless spinner.
        stallExhaustedCyclesRef.current += 1;
        if (stallExhaustedCyclesRef.current < 2) {
          console.warn("[Watch] stall on last available source; continuing to buffer", { reason });
          return;
        }
        setStreamError("Playback failed on all available sources for this video.");
        setStreamErrorKind("streaming");
        recordPlayerEvent("video playback failed: repeated stalls with all sources exhausted");
        return;
      }

      attemptedModesRef.current.add(next);
      setResumeTime(info.isLive ? 0 : resumeAt);
      setSourceMode(next);
      if (next === "hls") {
        setHlsManifestUrl(info.hlsManifestUrl || null);
        setDashManifestUrl(null);
        setStreamUrl(null);
      } else if (next === "dash-native") {
        setHlsManifestUrl(null);
        setDashManifestUrl(info.dashManifestUrl || null);
        setStreamUrl(info.dashManifestUrl || null);
      } else if (next === "sabr-dash") {
        setHlsManifestUrl(null);
        setDashManifestUrl(info.sabr?.manifestUrl || null);
        setStreamUrl(info.sabr?.manifestUrl || null);
      } else {
        setHlsManifestUrl(null);
        setDashManifestUrl(null);
        setStreamUrl(pickDirectVariantUrl(info, selectedQualityId || "auto", preferredCodec));
      }
    },
    [sourceMode, selectedQualityId, preferredCodec],
  );

  const onHardRetry = useCallback(() => {
    if (!currentVideo) return;
    setStreamUrl(null);
    setStreamVariants([]);
    publishCaptions([]);
    setAudioTracks([]);
    setSelectedQualityId("auto");
    setStreamError(null);
    setStreamErrorKind(null);
    stallExhaustedCyclesRef.current = 0;
    recordPlayerEvent(`video hard retry: ${currentVideo.id}`);
    // A hard retry exists because the resolved URLs stopped working, so it has
    // to walk a fresh client ladder rather than be handed the same answer again.
    invalidateStreamInfo(currentVideo.id);
    void resolveStreamInfo(currentVideo.id, { refresh: true })
      .then((info) => {
        streamInfoRef.current = info;
        attemptedModesRef.current = new Set();
        setStreamVariants(info.variants || []);
        publishCaptions(info.captions || []);
        setAudioTracks(info.audioTracks || []);
        setIsLive(!!info.isLive);
        const canUseAdaptive = (info.audioTracks || []).some((track) => !!track.localUrl);
        const preferredVariant = selectPreferredStreamVariant(
          info.variants || [],
          preferredQuality,
          preferredCodec,
          canUseAdaptive,
        );
        const initialQualityId = preferredVariant?.id || "auto";
        setSelectedQualityId(initialQualityId);
        setStreamError(null);
        setStreamErrorKind(null);

        const mode = computeAvailableSourceModes(info)[0] || "unavailable";
        attemptedModesRef.current.add(mode);
        setSourceMode(mode);
        if (mode === "hls") {
          setHlsManifestUrl(info.hlsManifestUrl || null);
          setDashManifestUrl(null);
          setStreamUrl(null);
        } else if (mode === "dash-native") {
          setHlsManifestUrl(null);
          setDashManifestUrl(info.dashManifestUrl || null);
          setStreamUrl(info.dashManifestUrl || null);
        } else if (mode === "sabr-dash") {
          setHlsManifestUrl(null);
          setDashManifestUrl(info.sabr?.manifestUrl || null);
          setStreamUrl(info.sabr?.manifestUrl || null);
        } else {
          setHlsManifestUrl(null);
          setDashManifestUrl(null);
          setStreamUrl(pickDirectVariantUrl(info, initialQualityId, preferredCodec));
        }
      })
      .catch((err) => {
        const info = classifyPlayerError(err);
        setStreamError(info.rawMessage);
        setStreamErrorKind(info.kind);
        recordPlayerEvent(`video hard retry failed: ${info.kind} (${info.rawMessage})`);
      });
  }, [currentVideo, preferredCodec, preferredQuality, publishCaptions]);

  return {
    streamUrl,
    streamVariants,
    captions,
    audioTracks,
    dashManifestUrl,
    hlsManifestUrl,
    isLive,
    sourceMode,
    selectedQualityId,
    resumeTime,
    loadingStream,
    streamError,
    streamErrorKind,
    setResumeTime,
    onSelectQuality,
    onRetrySource,
    onHardRetry,
  };
}
