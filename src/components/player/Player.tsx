import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as dashjs from "dashjs";
import Hls from "hls.js";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { PlayerErrorState } from "../ui/PlayerErrorState";
import type { PlayerErrorInfo } from "../../lib/playerError";
import { getString } from "../../lib/i18n/index";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore, type SponsorBlockCategory, type SponsorBlockAction } from "../../store/useSettingsStore";
import type { AudioTrack, CaptionTrack, StreamVariant, VideoChapter } from "../../types/video";
import { FlowPlayerControls } from "./FlowPlayerControls";
import { MiniPlayerControls } from "./MiniPlayerControls";
import { PlayerGestureOverlay, type PlayerSeekFeedback } from "./gesture/overlay";
import { SubtitleOverlay } from "./SubtitleOverlay";
import { SETTINGS } from "../../lib/settings/schema";
import { IS_LINUX_RUNTIME } from "../../lib/platform";
import {
  AUDIO_DRIFT_TOLERANCE_SECONDS,
  AUDIO_RESYNC_MIN_INTERVAL_MS,
  decideExternalAudioSync,
} from "../../lib/externalAudioSync";
import { useSubtitleSettingsSync } from "../../lib/useSubtitleSettingsSync";
import {
  formatPlaybackRate,
  normalizePlaybackRate,
  parseCustomSpeedPresets,
  selectPreferredAudioTrackId,
  selectPreferredCaptionId,
} from "../../lib/settings/playerRuntime";
import { setSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import {
  createWindowFullscreenController,
  watchNativeFullscreenExit,
  type WindowFullscreenController,
} from "../../lib/windowFullscreen";

type PlayerProps = {
  src?: string | null;
  dashManifestUrl?: string | null;
  hlsManifestUrl?: string | null;
  isLive?: boolean;
  title?: string;
  poster?: string | null;
  isLoading?: boolean;
  error?: string | null;
  errorInfo?: PlayerErrorInfo | null;
  qualities?: StreamVariant[];
  captions?: CaptionTrack[];
  audioTracks?: AudioTrack[];
  selectedQualityId?: string | null;
  resumeTime?: number;
  onSelectQuality?: (variant: StreamVariant | "auto") => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onRetry?: () => void;
  onCopyLogs?: () => Promise<boolean> | boolean | void;
  onOpenInBrowser?: () => void;
  onRetrySource?: (reason: string) => void;
  sourceMode?: string;
  className?: string;
  chapters?: VideoChapter[];
};

type DashBitrateInfo = {
  qualityIndex: number;
  height?: number;
  bitrate?: number;
};

type DashRepresentationInfo = {
  id: string;
  absoluteIndex?: number;
  bandwidth?: number;
  codecs?: string | null;
  frameRate?: number;
  height?: number;
  mimeType?: string | null;
  width?: number;
};

type DashTrackInfo = {
  id?: string;
  index?: number;
  lang?: string;
  labels?: Array<{ text?: string; lang?: string }>;
  roles?: Array<{ value?: string }>;
  audioChannelConfiguration?: Array<{ audioChannelConfiguration?: string }>;
  [key: string]: unknown;
};

type DashPlayerController = {
  initialize: (element: HTMLMediaElement, source: string, autoPlay: boolean) => void;
  destroy: () => void;
  off: (type: string, listener: (event: unknown) => void, scope?: object) => void;
  on: (type: string, listener: (event: unknown) => void, scope?: object) => void;
  updateSettings: (settings: unknown) => void;
  getBitrateInfoListFor: (type: string) => DashBitrateInfo[];
  getRepresentationsByType: (type: string) => DashRepresentationInfo[];
  setRepresentationForTypeById: (type: string, id: string, forceReplace?: boolean) => void;
  extend?: (parentNameString: string, childInstance: () => unknown, override: boolean) => void;
  getQualityFor: (type: string) => number;
  getCurrentRepresentationForType: (type: string) => DashRepresentationInfo | null;
  getTracksFor?: (type: string) => DashTrackInfo[];
  getCurrentTrackFor?: (type: string) => DashTrackInfo | null;
  setCurrentTrack?: (track: DashTrackInfo) => void;
};

type QualitySwitchSnapshot = {
  appliedAt: number;
  corrected: boolean;
  fromTime: number;
  targetQualityId: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type AmbientSample = {
  top: string;
  right: string;
  bottom: string;
  left: string;
  center: string;
  key: string;
};

const AMBIENT_SAMPLE_WIDTH = 36;
const AMBIENT_SAMPLE_HEIGHT = 20;
const AMBIENT_SAMPLE_INTERVAL_MS = 520;
const DEFAULT_AMBIENT_SAMPLE: AmbientSample = {
  top: "var(--color-player-ambient-1)",
  right: "var(--color-player-ambient-2)",
  bottom: "var(--color-player-ambient-1)",
  left: "var(--color-player-ambient-2)",
  center: "var(--color-player-ambient-3)",
  key: "default",
};

function ambientRgba([r, g, b]: [number, number, number], alpha: number) {
  const lift = 1.08;
  return `rgba(${Math.round(clamp(r * lift, 0, 255))}, ${Math.round(clamp(g * lift, 0, 255))}, ${Math.round(clamp(b * lift, 0, 255))}, ${alpha})`;
}

function sampleRegion(
  imageData: ImageData,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): [number, number, number] {
  const { data, width, height } = imageData;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(startX)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(startY)));
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(endX)));
  const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(endY)));

  let red = 0;
  let green = 0;
  let blue = 0;
  let totalWeight = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const weight = (0.2 + saturation * 1.35) * (0.35 + clamp(luminance, 0, 1) * 0.65);

      red += r * weight;
      green += g * weight;
      blue += b * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0) return [10, 10, 10];
  return [red / totalWeight, green / totalWeight, blue / totalWeight];
}

function extractAmbientSample(context: CanvasRenderingContext2D): AmbientSample {
  const imageData = context.getImageData(0, 0, AMBIENT_SAMPLE_WIDTH, AMBIENT_SAMPLE_HEIGHT);
  const edgeHeight = Math.max(4, Math.floor(AMBIENT_SAMPLE_HEIGHT * 0.32));
  const edgeWidth = Math.max(6, Math.floor(AMBIENT_SAMPLE_WIDTH * 0.26));
  const centerX = AMBIENT_SAMPLE_WIDTH * 0.22;
  const centerY = AMBIENT_SAMPLE_HEIGHT * 0.22;
  const centerWidth = AMBIENT_SAMPLE_WIDTH * 0.56;
  const centerHeight = AMBIENT_SAMPLE_HEIGHT * 0.56;

  const top = sampleRegion(imageData, 0, 0, AMBIENT_SAMPLE_WIDTH, edgeHeight);
  const right = sampleRegion(imageData, AMBIENT_SAMPLE_WIDTH - edgeWidth, 0, AMBIENT_SAMPLE_WIDTH, AMBIENT_SAMPLE_HEIGHT);
  const bottom = sampleRegion(imageData, 0, AMBIENT_SAMPLE_HEIGHT - edgeHeight, AMBIENT_SAMPLE_WIDTH, AMBIENT_SAMPLE_HEIGHT);
  const left = sampleRegion(imageData, 0, 0, edgeWidth, AMBIENT_SAMPLE_HEIGHT);
  const center = sampleRegion(imageData, centerX, centerY, centerX + centerWidth, centerY + centerHeight);

  const key = [top, right, bottom, left, center]
    .flatMap((color) => color.map((channel) => Math.round(channel / 6) * 6))
    .join(",");

  return {
    top: ambientRgba(top, 0.92),
    right: ambientRgba(right, 0.82),
    bottom: ambientRgba(bottom, 0.92),
    left: ambientRgba(left, 0.82),
    center: ambientRgba(center, 0.5),
    key,
  };
}

function extractCodecMimeType(mimeType?: string | null) {
  if (!mimeType) return null;
  const [baseType, ...rest] = mimeType.split(";");
  const codecMatch = rest.join(";").match(/codecs\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  if (!baseType) return null;
  const trimmedBaseType = baseType.trim();
  let codecsValue = codecMatch?.[1] || codecMatch?.[2];
  if (codecsValue === "vp9") {
    codecsValue = "vp09.00.10.08";
  }
  return codecsValue ? `${trimmedBaseType}; codecs="${codecsValue}"` : trimmedBaseType;
}

// A minimal Linux install often ships the audio decoders but not H.264/VP9/AV1,
// so audio plays while video hangs. This failure mode is Linux-only — gate the
// probe there to avoid firing on transient first-frame delays elsewhere.
const CODEC_PROBE_SECONDS = 4;

const MAX_EXTERNAL_AUDIO_RECOVERIES = 2;

// Per media identity; reset once a fragment or manifest actually loads.
const MAX_HLS_FATAL_RECOVERY_ATTEMPTS = 3;

function isVariantSupported(mimeType?: string | null) {
  const codecMimeType = extractCodecMimeType(mimeType);
  if (!codecMimeType) return true;
  if (typeof MediaSource !== "undefined" && typeof MediaSource.isTypeSupported === "function") {
    return MediaSource.isTypeSupported(codecMimeType);
  }
  const probe = document.createElement("video");
  return probe.canPlayType(codecMimeType) !== "";
}

function formatPlayerLogPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const Player: React.FC<PlayerProps> = ({
  src,
  dashManifestUrl,
  hlsManifestUrl,
  isLive = false,
  title,
  poster,
  isLoading = false,
  error,
  errorInfo,
  qualities = [],
  captions = [],
  audioTracks = [],
  selectedQualityId,
  resumeTime = 0,
  onSelectQuality,
  onEnded,
  onTimeUpdate,
  onRetry,
  onCopyLogs,
  onOpenInBrowser,
  onRetrySource,
  sourceMode,
  className,
  chapters = [],
}) => {
  const [activeQualityLabel, setActiveQualityLabel] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skippedSegmentsRef = useRef<Set<string>>(new Set());
  const undoSkippedSegmentsRef = useRef<Set<string>>(new Set());
  const mutedSegmentsRecordedRef = useRef<Set<string>>(new Set());
  const notifiedSegmentsRef = useRef<Set<string>>(new Set());
  const lastMediaIdentityRef = useRef<string>(src || dashManifestUrl || hlsManifestUrl || "");
  const desiredPlayingRef = useRef(false);
  const pendingResumeTimeRef = useRef(0);
  const sourceSwitchingRef = useRef(false);
  const dashPlayerRef = useRef<DashPlayerController | null>(null);
  const dashReadyRef = useRef(false);
  const hlsPlayerRef = useRef<Hls | null>(null);
  const qualitySwitchSnapshotRef = useRef<QualitySwitchSnapshot | null>(null);
  const qualitySwitchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaBufferingRef = useRef(false);
  const seekFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ambientCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ambientSampleKeyRef = useRef(DEFAULT_AMBIENT_SAMPLE.key);
  // Stall watchdog / source-fallback bookkeeping.
  const waitingSinceRef = useRef<number | null>(null);
  const stallCountRef = useRef(0);
  const retrySourceFiredRef = useRef(false);
  const playbackStartAtRef = useRef<number | null>(null);
  const lastSeekAtRef = useRef<number | null>(null);
  const onRetrySourceRef = useRef(onRetrySource);
  // Missing-video-codec probe (Linux/WebKitGTK): baseline playback position and dismissal.
  const codecProbeBaselineRef = useRef<number | null>(null);
  const codecWarningDismissedRef = useRef(false);
  // External-audio clock bookkeeping (see AUDIO_DRIFT_TOLERANCE_SECONDS).
  const lastAudioResyncAtRef = useRef(0);
  const audioHoldRef = useRef(false);
  // A source swap stamps lastAudioResyncAtRef several times (seek, attach,
  // loadedmetadata hard-sync), which used to rate-limit away the one realign
  // that matters when the new source finally reaches canplay.
  const postSwitchRealignPendingRef = useRef(false);
  const audioRecoveryAttemptsRef = useRef(0);
  const attachedAudioIdentityRef = useRef<string | null>(null);
  const videoProgressSampleRef = useRef<{ time: number; at: number } | null>(null);

  const {
    isPlaying,
    setIsPlaying,
    volume,
    setVolume,
    playbackRate,
    setPlaybackRate,
    currentTime,
    duration,
    setCurrentTime,
    setDuration,
    playNext,
    isTheaterMode,
    setIsTheaterMode,
    sponsorBlockSegments,
    videoPlayerMode,
    enterVideoPip,
    expandVideoPlayer,
    isVideoFullscreen: isFullscreen,
    setIsVideoFullscreen: setIsFullscreen,
  } = usePlayerStore();

  const autoplayEnabled = useAppSettingsStore((state) => state.values[SETTINGS.AUTOPLAY_ENABLED] !== "false");
  const videoLoopEnabled = useAppSettingsStore((state) => state.values[SETTINGS.VIDEO_LOOP_ENABLED] === "true");
  const rememberPlaybackSpeed = useAppSettingsStore((state) => state.values[SETTINGS.REMEMBER_PLAYBACK_SPEED] === "true");
  const playbackSpeedSetting = useAppSettingsStore((state) => state.values[SETTINGS.PLAYBACK_SPEED] ?? "1.0");
  const customSpeedsEnabled = useAppSettingsStore((state) => state.values[SETTINGS.CUSTOM_SPEEDS_ENABLED] === "true");
  const customSpeedPresets = useAppSettingsStore((state) => state.values[SETTINGS.CUSTOM_SPEED_PRESETS] ?? "");
  const longPressSpeedSetting = useAppSettingsStore((state) => state.values[SETTINGS.LONG_PRESS_PLAYBACK_SPEED] ?? "2.0");
  const speedSliderEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SPEED_SLIDER_ENABLED] === "true");
  const seekIntervalSetting = useAppSettingsStore((state) => state.values[SETTINGS.DOUBLE_TAP_SEEK_SECONDS] ?? "10");
  const subtitlesEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SUBTITLES_ENABLED] === "true");
  const preferredSubtitleLanguage = useAppSettingsStore((state) => state.values[SETTINGS.PREFERRED_SUBTITLE_LANGUAGE] ?? "en");
  const manualPipButtonEnabled = useAppSettingsStore((state) => state.values[SETTINGS.MANUAL_PIP_BUTTON_ENABLED] !== "false");
  const miniPlayerShowSkipControls = useAppSettingsStore((state) => state.values[SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS] !== "false");
  const miniPlayerShowNextPrevControls = useAppSettingsStore((state) => state.values[SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS] !== "false");
  const showFullscreenTitle = useAppSettingsStore((state) => state.values[SETTINGS.SHOW_FULLSCREEN_TITLE] === "true");
  const bufferProfile = useAppSettingsStore((state) => state.values[SETTINGS.BUFFER_PROFILE] ?? "STABLE");
  const minBufferSetting = useAppSettingsStore((state) => state.values[SETTINGS.MIN_BUFFER_MS] ?? "30000");
  const maxBufferSetting = useAppSettingsStore((state) => state.values[SETTINGS.MAX_BUFFER_MS] ?? "50000");
  const startupBufferSetting = useAppSettingsStore((state) => state.values[SETTINGS.BUFFER_FOR_PLAYBACK_MS] ?? "2500");
  const rebufferSetting = useAppSettingsStore((state) => state.values[SETTINGS.BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS] ?? "5000");

  const defaultPlaybackRate = useMemo(
    () => normalizePlaybackRate(playbackSpeedSetting),
    [playbackSpeedSetting],
  );
  const longPressPlaybackRate = useMemo(
    () => normalizePlaybackRate(longPressSpeedSetting, 2),
    [longPressSpeedSetting],
  );
  const configuredSpeedOptions = useMemo(
    () => parseCustomSpeedPresets(customSpeedPresets, customSpeedsEnabled),
    [customSpeedPresets, customSpeedsEnabled],
  );
  const seekIntervalSeconds = useMemo(() => {
    const parsed = Number(seekIntervalSetting);
    return Number.isFinite(parsed) ? Math.min(30, Math.max(5, parsed)) : 10;
  }, [seekIntervalSetting]);
  const bufferConfig = useMemo(() => {
    const custom = {
      minMs: Number(minBufferSetting),
      maxMs: Number(maxBufferSetting),
      startupMs: Number(startupBufferSetting),
      rebufferMs: Number(rebufferSetting),
    };
    const stable = { minMs: 30000, maxMs: 50000, startupMs: 2500, rebufferMs: 5000 };
    const profiles: Record<string, typeof custom> = {
      AGGRESSIVE: { minMs: 5000, maxMs: 30000, startupMs: 500, rebufferMs: 2500 },
      STABLE: stable,
      DATASAVER: { minMs: 12000, maxMs: 25000, startupMs: 1500, rebufferMs: 5000 },
      CUSTOM: custom,
    };
    const selected = profiles[bufferProfile] ?? stable;
    const minMs = Number.isFinite(selected.minMs) ? selected.minMs : stable.minMs;
    const maxMs = Number.isFinite(selected.maxMs) ? selected.maxMs : stable.maxMs;
    const startupMs = Number.isFinite(selected.startupMs) ? selected.startupMs : stable.startupMs;
    const rebufferMs = Number.isFinite(selected.rebufferMs) ? selected.rebufferMs : stable.rebufferMs;
    const normalizedMinMs = Math.min(120000, Math.max(5000, minMs));
    const normalizedMaxMs = Math.min(120000, Math.max(25000, Math.max(maxMs, normalizedMinMs)));

    return {
      minSeconds: normalizedMinMs / 1000,
      maxSeconds: normalizedMaxMs / 1000,
      startupSeconds: Math.min(5, Math.max(0.5, startupMs / 1000)),
      rebufferSeconds: Math.min(10, Math.max(2.5, rebufferMs / 1000)),
    };
  }, [bufferProfile, maxBufferSetting, minBufferSetting, rebufferSetting, startupBufferSetting]);

  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ambientMode] = useState(true);
  const [ambientSample, setAmbientSample] = useState<AmbientSample>(DEFAULT_AMBIENT_SAMPLE);
  const {
    sponsorBlockEnabled,
    sponsorBlockActions,
    incrementStats,
    loadSettings
  } = useSettingsStore();
  const [sbMuted, setSbMuted] = useState(false);
  const [notifyToast, setNotifyToast] = useState<{ segment: any; categoryName: string; visible: boolean } | null>(null);
  const notifyTimeoutRef = useRef<number | null>(null);
  const [currentSBMuteSegment, setCurrentSBMuteSegment] = useState<string | null>(null);
  const [isPip, setIsPip] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string>("off");
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [isSourceSwitching, setIsSourceSwitching] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState<PlayerSeekFeedback | null>(null);
  const [videoCodecUnsupported, setVideoCodecUnsupported] = useState(false);

  const isDashPlayback = !!dashManifestUrl;
  const isHlsPlayback = !!hlsManifestUrl && !isDashPlayback;
  const dashProxyPrefix = useMemo(() => {
    if (!dashManifestUrl) return null;
    const marker = "?url=";
    const markerIndex = dashManifestUrl.indexOf(marker);
    if (markerIndex < 0) return null;
    return dashManifestUrl.slice(0, markerIndex + marker.length);
  }, [dashManifestUrl]);
  const hlsProxyPrefix = useMemo(() => {
    if (!hlsManifestUrl) return null;
    const marker = "?url=";
    const markerIndex = hlsManifestUrl.indexOf(marker);
    if (markerIndex < 0) return null;
    return hlsManifestUrl.slice(0, markerIndex + marker.length);
  }, [hlsManifestUrl]);

  const supportedQualities = useMemo(() => {
    if (!isDashPlayback) return qualities;
    return qualities.filter((quality) => isVariantSupported(quality.mimeType));
  }, [isDashPlayback, qualities]);

  const selectedQuality = useMemo(() => {
    return (
      supportedQualities.find((quality) => quality.id === selectedQualityId) ||
      supportedQualities.find((quality) => quality.isDefault) ||
      supportedQualities[0] ||
      null
    );
  }, [selectedQualityId, supportedQualities]);

  const selectedAudioTrack = audioTracks.find((track) => track.id === selectedAudioTrackId)
    || audioTracks.find((track) => track.isDefault)
    || audioTracks[0]
    || null;

  const hasSelectedAlternateAudio =
    !!selectedAudioTrackId && !!selectedAudioTrack && !selectedAudioTrack.isDefault;
  const usesExternalAudio =
    !!selectedAudioTrack?.localUrl &&
    selectedAudioTrack.available !== false &&
    !isDashPlayback &&
    !isHlsPlayback &&
    (hasSelectedAlternateAudio || (!!selectedQuality && !selectedQuality.hasAudio));

  const isPipMode = videoPlayerMode === "pip";
  const isTheaterSurface = isTheaterMode && !isPipMode;
  const shouldShowControls = controlsVisible || !isPlaying || settingsOpen || isScrubbing;
  const showAmbient = ambientMode && isTheaterSurface && !error;
  const effectivePoster = hasStartedPlayback || resumeTime > 0 || isSourceSwitching ? undefined : poster || undefined;
  const ambientBackdropStyle = useMemo<React.CSSProperties>(() => ({
    background: [
      `radial-gradient(ellipse at 50% -6%, ${ambientSample.top} 0%, transparent 58%)`,
      `radial-gradient(ellipse at 50% 106%, ${ambientSample.bottom} 0%, transparent 58%)`,
      `radial-gradient(ellipse at -6% 50%, ${ambientSample.left} 0%, transparent 54%)`,
      `radial-gradient(ellipse at 106% 50%, ${ambientSample.right} 0%, transparent 54%)`,
      `radial-gradient(circle at 50% 50%, ${ambientSample.center} 0%, transparent 46%)`,
      "linear-gradient(180deg, color-mix(in srgb, var(--color-chrome-black) 88%, transparent) 0%, color-mix(in srgb, var(--color-chrome-black) 50%, transparent) 45%, color-mix(in srgb, var(--color-chrome-black) 88%, transparent) 100%)",
    ].join(", "),
  }), [ambientSample]);

  useEffect(() => {
    if (!showAmbient || IS_LINUX_RUNTIME) {
      ambientSampleKeyRef.current = DEFAULT_AMBIENT_SAMPLE.key;
      setAmbientSample(DEFAULT_AMBIENT_SAMPLE);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let frameHandle: number | null = null;
    let intervalId: number | null = null;
    let lastSampleAt = 0;
    let samplingBlocked = false;
    const frameVideo = video as {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    const sampleFrame = () => {
      if (
        cancelled ||
        samplingBlocked ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        return;
      }

      const now = performance.now();
      if (now - lastSampleAt < AMBIENT_SAMPLE_INTERVAL_MS) return;
      lastSampleAt = now;

      const canvas = ambientCanvasRef.current ?? document.createElement("canvas");
      ambientCanvasRef.current = canvas;
      if (canvas.width !== AMBIENT_SAMPLE_WIDTH) canvas.width = AMBIENT_SAMPLE_WIDTH;
      if (canvas.height !== AMBIENT_SAMPLE_HEIGHT) canvas.height = AMBIENT_SAMPLE_HEIGHT;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

      try {
        context.drawImage(video, 0, 0, AMBIENT_SAMPLE_WIDTH, AMBIENT_SAMPLE_HEIGHT);
        const nextSample = extractAmbientSample(context);
        if (nextSample.key !== ambientSampleKeyRef.current) {
          ambientSampleKeyRef.current = nextSample.key;
          setAmbientSample(nextSample);
        }
      } catch (error) {
        samplingBlocked = true;
        ambientSampleKeyRef.current = DEFAULT_AMBIENT_SAMPLE.key;
        setAmbientSample(DEFAULT_AMBIENT_SAMPLE);
        console.warn("Video ambient sampling unavailable; using neutral backdrop", error);
      }
    };

    const scheduleNextFrame = () => {
      if (!frameVideo.requestVideoFrameCallback || cancelled) return;
      frameHandle = frameVideo.requestVideoFrameCallback(() => {
        sampleFrame();
        scheduleNextFrame();
      });
    };

    sampleFrame();
    if (frameVideo.requestVideoFrameCallback) {
      scheduleNextFrame();
    } else {
      intervalId = window.setInterval(sampleFrame, AMBIENT_SAMPLE_INTERVAL_MS);
    }

    video.addEventListener("loadeddata", sampleFrame);
    video.addEventListener("seeked", sampleFrame);
    video.addEventListener("play", sampleFrame);

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", sampleFrame);
      video.removeEventListener("seeked", sampleFrame);
      video.removeEventListener("play", sampleFrame);
      if (intervalId !== null) window.clearInterval(intervalId);
      if (frameHandle !== null) frameVideo.cancelVideoFrameCallback?.(frameHandle);
    };
  }, [dashManifestUrl, hlsManifestUrl, showAmbient, src]);

  const logPlayerEvent = useCallback((event: string, payload: Record<string, unknown> = {}) => {
    const entry = formatPlayerLogPayload({
      currentTime: videoRef.current?.currentTime,
      duration: videoRef.current?.duration,
      isDashPlayback,
      selectedQualityId,
      ...payload,
    });
    console.log(`[Player] ${event}`, entry);
    const globalWindow = window as Window & {
      __FLOW_PLAYER_LOGS__?: Array<{ event: string; payload: Record<string, unknown>; at: string }>;
    };
    globalWindow.__FLOW_PLAYER_LOGS__ = globalWindow.__FLOW_PLAYER_LOGS__ || [];
    globalWindow.__FLOW_PLAYER_LOGS__.push({
      event,
      payload: entry,
      at: new Date().toISOString(),
    });
    if (globalWindow.__FLOW_PLAYER_LOGS__.length > 200) {
      globalWindow.__FLOW_PLAYER_LOGS__.shift();
    }
  }, [isDashPlayback, selectedQualityId]);
  const logPlayerEventRef = useRef(logPlayerEvent);

  const applyDashQualitySelection = useCallback(() => {
    const player = dashPlayerRef.current;
    const video = videoRef.current;
    if (!player || !video || !dashReadyRef.current) return;

    if (selectedQualityId === "auto") {
      player.updateSettings({
        streaming: {
          abr: {
            autoSwitchBitrate: {
              video: true,
              audio: false,
            },
          },
        },
      });
      logPlayerEvent("dash-quality-auto-requested", {
        switchTime: video.currentTime,
      });

      const currentRep = player.getCurrentRepresentationForType("video");
      if (currentRep && currentRep.height) {
        setActiveQualityLabel(`${currentRep.height}p`);
      }
      return;
    }

    if (!selectedQuality) return;

    const representations = player.getRepresentationsByType("video") || [];
    const targetRepresentation = representations.find((representation) => representation.id === selectedQuality.id)
      || representations
        .filter((representation) => typeof representation.height === "number")
        .sort((left, right) => Math.abs((left.height || 0) - (selectedQuality.height || 0)) - Math.abs((right.height || 0) - (selectedQuality.height || 0)))[0];

    if (!targetRepresentation) {
      logPlayerEvent("dash-quality-target-missing", {
        requestedQualityId: selectedQuality.id,
        requestedHeight: selectedQuality.height,
        availableRepresentations: representations.map((representation) => ({
          id: representation.id,
          height: representation.height,
          codecs: representation.codecs,
          mimeType: representation.mimeType,
        })),
      });
      return;
    }

    const currentRepresentation = player.getCurrentRepresentationForType("video");
    if (currentRepresentation?.id === targetRepresentation.id) {
      player.updateSettings({
        streaming: {
          abr: {
            autoSwitchBitrate: {
              video: false,
              audio: false,
            },
          },
        },
      });
      if (currentRepresentation.height) {
        setActiveQualityLabel(`${currentRepresentation.height}p`);
      }
      logPlayerEvent("dash-quality-already-selected", {
        targetRepresentationId: targetRepresentation.id,
      });
      return;
    }

    qualitySwitchSnapshotRef.current = {
      appliedAt: performance.now(),
      corrected: false,
      fromTime: video.currentTime,
      targetQualityId: targetRepresentation.id,
    };
    if (qualitySwitchTimeoutRef.current) {
      clearTimeout(qualitySwitchTimeoutRef.current);
    }
    qualitySwitchTimeoutRef.current = setTimeout(() => {
      if (qualitySwitchSnapshotRef.current) {
        logPlayerEvent("dash-quality-switch-timeout", {
          snapshot: qualitySwitchSnapshotRef.current,
        });
        qualitySwitchSnapshotRef.current = null;
      }
    }, 8000);

    try {
      player.updateSettings({
        streaming: {
          abr: {
            autoSwitchBitrate: {
              video: false,
              audio: false,
            },
          },
        },
      });
      player.setRepresentationForTypeById("video", targetRepresentation.id, false);
    } catch (switchError) {
      qualitySwitchSnapshotRef.current = null;
      if (qualitySwitchTimeoutRef.current) {
        clearTimeout(qualitySwitchTimeoutRef.current);
        qualitySwitchTimeoutRef.current = null;
      }
      logPlayerEvent("dash-quality-switch-rejected", {
        requestedQualityId: selectedQuality.id,
        targetRepresentationId: targetRepresentation.id,
        error: switchError instanceof Error ? switchError.message : String(switchError),
      });
      return;
    }
    logPlayerEvent("dash-quality-switch-requested", {
      requestedQualityId: selectedQuality.id,
      selectedMimeType: selectedQuality.mimeType,
      targetRepresentationId: targetRepresentation.id,
      targetHeight: targetRepresentation.height,
      targetCodecs: targetRepresentation.codecs,
      targetMimeType: targetRepresentation.mimeType,
      switchTime: video.currentTime,
    });
  }, [logPlayerEvent, selectedQuality, selectedQualityId]);
  const applyDashQualitySelectionRef = useRef(applyDashQualitySelection);

  const applyDashAudioSelection = useCallback(() => {
    const player = dashPlayerRef.current;
    if (
      !dashReadyRef.current ||
      !player?.getTracksFor ||
      !player.getCurrentTrackFor ||
      !player.setCurrentTrack
    ) return;

    const dashAudioTracks = player.getTracksFor("audio") || [];
    if (dashAudioTracks.length === 0) return;

    const normalizedSelectedId = (selectedAudioTrack?.id || "").toLowerCase();
    const normalizedSelectedLang = (selectedAudioTrack?.languageCode || "").toLowerCase();
    const normalizedSelectedLabel = (selectedAudioTrack?.label || "").toLowerCase();

    const trackLabel = (track: DashTrackInfo) =>
      (track.labels || [])
        .map((label) => label.text || "")
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    const targetTrack = selectedAudioTrack
      ? dashAudioTracks.find((track) => String(track.id || "").toLowerCase().includes(normalizedSelectedId))
        || dashAudioTracks.find((track) => normalizedSelectedLang && String(track.lang || "").toLowerCase() === normalizedSelectedLang)
        || dashAudioTracks.find((track) => normalizedSelectedLabel && trackLabel(track).includes(normalizedSelectedLabel))
      : dashAudioTracks.find((track) => (track.roles || []).some((role) => role.value === "main"))
        || dashAudioTracks[0];

    if (!targetTrack) return;

    const currentTrack = player.getCurrentTrackFor("audio");
    const isCurrentTrack =
      currentTrack === targetTrack ||
      (!!currentTrack?.id && !!targetTrack.id && String(currentTrack.id) === String(targetTrack.id)) ||
      (
        currentTrack?.index !== undefined &&
        targetTrack.index !== undefined &&
        currentTrack.index === targetTrack.index &&
        String(currentTrack.lang || "") === String(targetTrack.lang || "")
      );

    if (isCurrentTrack) {
      logPlayerEvent("dash-audio-track-already-selected", {
        selectedAudioTrackId,
        dashTrackId: targetTrack.id,
        dashTrackIndex: targetTrack.index,
      });
      return;
    }

    try {
      player.setCurrentTrack(targetTrack);
    } catch (trackError) {
      logPlayerEvent("dash-audio-track-selection-rejected", {
        selectedAudioTrackId,
        dashTrackId: targetTrack.id,
        error: trackError instanceof Error ? trackError.message : String(trackError),
      });
      return;
    }
    logPlayerEvent("dash-audio-track-selected", {
      selectedAudioTrackId,
      selectedAudioLabel: selectedAudioTrack?.label,
      selectedAudioLanguage: selectedAudioTrack?.languageCode,
      dashTrack: {
        id: targetTrack.id,
        index: targetTrack.index,
        lang: targetTrack.lang,
        labels: targetTrack.labels,
        roles: targetTrack.roles,
      },
      availableDashAudioTracks: dashAudioTracks.map((track) => ({
        id: track.id,
        index: track.index,
        lang: track.lang,
        labels: track.labels,
        roles: track.roles,
      })),
    });
  }, [logPlayerEvent, selectedAudioTrack, selectedAudioTrackId]);
  const applyDashAudioSelectionRef = useRef(applyDashAudioSelection);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const mediaIdentity = src || dashManifestUrl || hlsManifestUrl || "";
  const appliedInitialRateForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mediaIdentity || appliedInitialRateForRef.current === mediaIdentity) return;
    appliedInitialRateForRef.current = mediaIdentity;
    setPlaybackRate(defaultPlaybackRate);
  }, [defaultPlaybackRate, mediaIdentity, setPlaybackRate]);

  const selectPlaybackRate = useCallback((nextRate: number) => {
    const normalizedRate = normalizePlaybackRate(nextRate);
    setPlaybackRate(normalizedRate);
    if (rememberPlaybackSpeed) {
      void setSettingValue(SETTINGS.PLAYBACK_SPEED, formatPlaybackRate(normalizedRate));
    }
  }, [rememberPlaybackSpeed, setPlaybackRate]);

  const toggleLoopSetting = useCallback(() => {
    void setSettingValue(SETTINGS.VIDEO_LOOP_ENABLED, String(!videoLoopEnabled));
  }, [videoLoopEnabled]);

  useSubtitleSettingsSync();

  useEffect(() => {
    if (!subtitlesEnabled) {
      setSelectedCaptionId("off");
      return;
    }

    const preferredCaptionId = selectPreferredCaptionId(captions, preferredSubtitleLanguage);
    setSelectedCaptionId(preferredCaptionId ?? "off");
  }, [captions, preferredSubtitleLanguage, subtitlesEnabled]);

  useEffect(() => {
    setSelectedAudioTrackId(selectPreferredAudioTrackId(audioTracks, "original"));
  }, [audioTracks]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.loop = videoLoopEnabled && !isLive;
  }, [isLive, videoLoopEnabled]);

  useEffect(() => {
    return () => {
      if (notifyTimeoutRef.current !== null) {
        window.clearTimeout(notifyTimeoutRef.current);
      }
      if (seekFeedbackTimerRef.current) {
        clearTimeout(seekFeedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    applyDashQualitySelectionRef.current = applyDashQualitySelection;
  }, [applyDashQualitySelection]);

  useEffect(() => {
    applyDashAudioSelectionRef.current = applyDashAudioSelection;
  }, [applyDashAudioSelection]);

  useEffect(() => {
    if (!isDashPlayback) return;
    applyDashAudioSelection();
  }, [applyDashAudioSelection, isDashPlayback, selectedAudioTrackId]);

  useEffect(() => {
    logPlayerEventRef.current = logPlayerEvent;
  }, [logPlayerEvent]);

  useEffect(() => {
    onRetrySourceRef.current = onRetrySource;
  }, [onRetrySource]);

  const fireRetrySource = useCallback((reason: string) => {
    if (retrySourceFiredRef.current && !reason.startsWith("buffering-stall")) return;
    retrySourceFiredRef.current = true;
    logPlayerEventRef.current("source-mode-fallback", { reason, sourceMode });
    onRetrySourceRef.current?.(reason);
  }, [sourceMode]);
  const fireRetrySourceRef = useRef(fireRetrySource);
  useEffect(() => {
    fireRetrySourceRef.current = fireRetrySource;
  }, [fireRetrySource]);

  useEffect(() => {
    retrySourceFiredRef.current = false;
    stallCountRef.current = 0;
    waitingSinceRef.current = null;
    playbackStartAtRef.current = null;
    logPlayerEventRef.current("source-mode-selected", {
      sourceMode,
      hasDash: isDashPlayback,
      hasHls: isHlsPlayback,
    });
  }, [src, dashManifestUrl, hlsManifestUrl, isDashPlayback, isHlsPlayback, sourceMode]);

  // Detect the WebKitGTK "audio plays, video frozen" state (missing system video codecs)
  // so the user gets an actionable hint instead of an endless spinner. Non-destructive:
  // playback is left running; only a dismissible banner is shown.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !IS_LINUX_RUNTIME || !mediaIdentity) return;

    codecProbeBaselineRef.current = null;
    codecWarningDismissedRef.current = false;
    setVideoCodecUnsupported(false);

    const evaluate = () => {
      // A decoded frame gives the element real dimensions — the codec works.
      if (video.videoWidth > 0) {
        codecProbeBaselineRef.current = null;
        setVideoCodecUnsupported(false);
        return;
      }
      if (codecWarningDismissedRef.current) return;
      // Only meaningful once media is actually advancing (i.e. audio is decoding/playing).
      if (video.paused || video.readyState < 2) return;
      if (codecProbeBaselineRef.current === null || video.currentTime < codecProbeBaselineRef.current) {
        codecProbeBaselineRef.current = video.currentTime;
        return;
      }
      if (video.currentTime - codecProbeBaselineRef.current >= CODEC_PROBE_SECONDS) {
        logPlayerEventRef.current("video-codec-unsupported", {
          currentTime: video.currentTime,
          readyState: video.readyState,
          videoWidth: video.videoWidth,
        });
        setVideoCodecUnsupported(true);
      }
    };

    const interval = window.setInterval(evaluate, 1000);
    video.addEventListener("timeupdate", evaluate);
    return () => {
      window.clearInterval(interval);
      video.removeEventListener("timeupdate", evaluate);
    };
  }, [mediaIdentity]);

  useEffect(() => {
    if (!isPlaying || !!error) return;

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || isScrubbing) return;

      const sinceSeek = lastSeekAtRef.current ? Date.now() - lastSeekAtRef.current : Infinity;
      if (sinceSeek < 12000) return;

      let bufferedAhead = 0;
      const t = video.currentTime;
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (video.buffered.start(i) <= t && t <= video.buffered.end(i) + 0.25) {
          bufferedAhead = Math.max(0, video.buffered.end(i) - t);
          break;
        }
      }

      const waitingSince = waitingSinceRef.current;
      // Startup gets a much longer leash than a mid-playback stall: live
      // manifests + init + first segments arrive through the loopback proxy
      // (one TCP connection per request) and can take well over 12s before
      // the first frame without anything being wrong.
      const started = playbackStartAtRef.current !== null;
      const stallThresholdMs = started ? 12000 : 45000;
      const stalledLongEnough = waitingSince !== null && Date.now() - waitingSince > stallThresholdMs;

      if (stalledLongEnough && bufferedAhead < 0.5 && video.readyState < 3) {
        logPlayerEventRef.current("source-watchdog-trip", {
          bufferedAhead,
          waitedMs: waitingSince ? Date.now() - waitingSince : 0,
          stallCount: stallCountRef.current,
          phase: started ? "playback" : "startup",
        });
        waitingSinceRef.current = Date.now();
        fireRetrySourceRef.current("buffering-stall");
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isPlaying, error, isScrubbing]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 2400);
  }, []);

  const showSeekFeedback = useCallback((direction: PlayerSeekFeedback["direction"], seconds: number) => {
    setSeekFeedback({
      id: Date.now(),
      direction,
      seconds,
    });
    if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
    seekFeedbackTimerRef.current = setTimeout(() => {
      setSeekFeedback(null);
    }, 1200);
  }, []);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    const nextTime = Math.min(Math.max(time, 0), video.duration || duration || 0);
    video.currentTime = nextTime;
    if (audio) {
      audioHoldRef.current = false;
      lastAudioResyncAtRef.current = performance.now();
      try {
        audio.currentTime = nextTime;
      } catch {
      }
    }
    setCurrentTime(nextTime);
  }, [duration, setCurrentTime]);

  const seekBy = useCallback((delta: number) => {
    seekTo(currentTime + delta);
    showSeekFeedback(delta > 0 ? "forward" : "backward", Math.abs(delta));
  }, [currentTime, seekTo, showSeekFeedback]);

  useEffect(() => {
    const handleExternalSeek = (e: Event) => {
      const customEvent = e as CustomEvent<{ time: number }>;
      if (customEvent.detail && typeof customEvent.detail.time === "number") {
        seekTo(customEvent.detail.time);
      }
    };
    window.addEventListener("flow-player-seek", handleExternalSeek);
    return () => {
      window.removeEventListener("flow-player-seek", handleExternalSeek);
    };
  }, [seekTo]);

  const setPlaybackDesired = useCallback((shouldPlay: boolean) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    desiredPlayingRef.current = shouldPlay;
    setIsPlaying(shouldPlay);

    if (!video) return;
    if (shouldPlay && (isDashPlayback || isHlsPlayback || src) && !error) {
      void video.play().catch((cause) => {
        if ((cause as DOMException | null)?.name === "AbortError") return;
        desiredPlayingRef.current = false;
        setIsPlaying(false);
      });
      if (usesExternalAudio && audio) {
        void audio.play().catch(() => {});
      }
    } else {
      video.pause();
      audio?.pause();
    }
  }, [error, isDashPlayback, setIsPlaying, src, usesExternalAudio]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    setPlaybackDesired(video ? video.paused : !isPlaying);
    revealControls();
  }, [isPlaying, revealControls, setPlaybackDesired]);

  const windowFullscreenControllerRef = useRef<WindowFullscreenController | null>(null);
  if (!windowFullscreenControllerRef.current) {
    windowFullscreenControllerRef.current = createWindowFullscreenController();
  }

  const syncNativeFullscreen = useCallback((active: boolean) => {
    return windowFullscreenControllerRef.current?.sync(active) ?? Promise.resolve();
  }, []);

  useEffect(() => {
    const controller = windowFullscreenControllerRef.current;
    if (!controller) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    watchNativeFullscreenExit(
      controller,
      () => usePlayerStore.getState().isVideoFullscreen,
      () => usePlayerStore.getState().setIsVideoFullscreen(false),
    )
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        // Not running under Tauri (tests/dev shells): fullscreen still works,
        // only OS-initiated exits go untracked.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const active = !isFullscreen;
    setIsFullscreen(active);
    void syncNativeFullscreen(active);
  }, [isFullscreen, setIsFullscreen, syncNativeFullscreen]);

  const togglePictureInPicture = useCallback(() => {
    if (videoPlayerMode === "pip") {
      expandVideoPlayer();
      window.dispatchEvent(new CustomEvent("flow-video-expand-request"));
      return;
    }
    if (isFullscreen) {
      setIsFullscreen(false);
      void syncNativeFullscreen(false);
    }
    enterVideoPip("manual");
  }, [enterVideoPip, expandVideoPlayer, isFullscreen, setIsFullscreen, syncNativeFullscreen, videoPlayerMode]);

  const updateBuffered = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || video.buffered.length === 0) {
      setBufferedPct(0);
      return;
    }

    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    setBufferedPct(Math.min(100, (bufferedEnd / video.duration) * 100));
  }, []);

  const realignExternalAudioClock = useCallback(
    (audio: HTMLAudioElement, video: HTMLVideoElement, force: boolean) => {
      const now = performance.now();
      if (!force) {
        if (now - lastAudioResyncAtRef.current < AUDIO_RESYNC_MIN_INTERVAL_MS) return false;
        if (audio.seeking || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
      }
      lastAudioResyncAtRef.current = now;
      try {
        audio.currentTime = video.currentTime;
      } catch {
        return false;
      }
      return true;
    },
    [],
  );

  const resumeExternalAudioPlayback = useCallback((audio: HTMLAudioElement, video: HTMLVideoElement) => {
    if (!desiredPlayingRef.current || video.paused || video.ended) return;
    void audio.play().catch(() => {});
  }, []);

  const isVideoAdvancing = useCallback((video: HTMLVideoElement, rate: number) => {
    const now = performance.now();
    const sample = videoProgressSampleRef.current;
    if (!sample || now - sample.at < 400) {
      if (!sample) videoProgressSampleRef.current = { time: video.currentTime, at: now };
      return sample ? video.currentTime > sample.time : true;
    }
    const expected = ((now - sample.at) / 1000) * rate;
    const advanced = video.currentTime - sample.time;
    videoProgressSampleRef.current = { time: video.currentTime, at: now };
    return advanced > expected * 0.5;
  }, []);

  const syncExternalAudio = useCallback((hard = false) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || !usesExternalAudio) return;

    // WebKitGTK flushes the GStreamer audio pipeline on every playbackRate
    // assignment, so each write is an audible glitch there. Never write a
    // value that is already set, and skip micro rate-nudging on Linux
    // entirely — a rarer hard resync keeps sync without continuous glitches.
    const applyAudioRate = (rate: number) => {
      if (Math.abs(audio.playbackRate - rate) > 0.001) {
        audio.playbackRate = rate;
      }
    };

    if (hard) {
      audioHoldRef.current = false;
      realignExternalAudioClock(audio, video, true);
      applyAudioRate(playbackRate);
      resumeExternalAudioPlayback(audio, video);
      return;
    }

    const videoStarved = video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    if (mediaBufferingRef.current && !video.paused && !videoStarved) {
      mediaBufferingRef.current = false;
      setIsBuffering(false);
    }

    const drift = audio.currentTime - video.currentTime;
    const action = decideExternalAudioSync({
      drift,
      held: audioHoldRef.current,
      videoAdvancing: isVideoAdvancing(video, playbackRate),
      videoStarved,
      audioSeeking: audio.seeking,
      audioReadyState: audio.readyState,
      msSinceLastRealign: performance.now() - lastAudioResyncAtRef.current,
    });

    switch (action) {
      case "steady":
        if (!IS_LINUX_RUNTIME && Math.abs(drift) > 0.08 && !video.paused && !video.ended) {
          applyAudioRate(clamp(playbackRate - drift * 0.12, playbackRate - 0.05, playbackRate + 0.05));
        } else {
          applyAudioRate(playbackRate);
        }
        return;
      case "hold":
        audioHoldRef.current = true;
        audio.pause();
        logPlayerEventRef.current("external-audio-hold", {
          drift,
          videoReadyState: video.readyState,
        });
        return;
      case "resume":
        audioHoldRef.current = false;
        applyAudioRate(playbackRate);
        resumeExternalAudioPlayback(audio, video);
        return;
      case "realign":
        realignExternalAudioClock(audio, video, true);
        applyAudioRate(playbackRate);
        resumeExternalAudioPlayback(audio, video);
        return;
      case "wait":
        return;
    }
  }, [
    isVideoAdvancing,
    playbackRate,
    realignExternalAudioClock,
    resumeExternalAudioPlayback,
    usesExternalAudio,
  ]);

  useEffect(() => {
    if (!usesExternalAudio || isSourceSwitching) return;
    const interval = window.setInterval(() => syncExternalAudio(false), 250);
    return () => window.clearInterval(interval);
  }, [isSourceSwitching, syncExternalAudio, usesExternalAudio]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!isDashPlayback || !dashManifestUrl) {
      dashReadyRef.current = false;
      dashPlayerRef.current?.destroy();
      dashPlayerRef.current = null;
      return;
    }

    dashReadyRef.current = false;
    const player = dashjs.MediaPlayer().create() as unknown as DashPlayerController;
    if (dashProxyPrefix) {
      player.extend?.("RequestModifier", () => ({
        modifyRequestURL: (url: string) => {
          if (url.startsWith("http://127.0.0.1:") || url.startsWith("blob:")) {
            return url;
          }
          return `${dashProxyPrefix}${encodeURIComponent(url)}`;
        },
        modifyRequestHeader: (xhr: XMLHttpRequest) => xhr,
      }), true);
    }
    player.updateSettings({
      streaming: {
        capabilities: {
          useMediaCapabilitiesApi: false,
        },
        abr: {
          autoSwitchBitrate: {
            video: false,
            audio: false,
          },
        },
        buffer: {
          fastSwitchEnabled: false,
          bufferToKeep: Math.max(60, bufferConfig.maxSeconds),
          bufferPruningInterval: 120,
          bufferTimeDefault: bufferConfig.minSeconds,
          bufferTimeAtTopQuality: bufferConfig.maxSeconds,
          bufferTimeAtTopQualityLongForm: bufferConfig.maxSeconds,
          longFormContentDurationThreshold: 600,
        },
      },
    });
    logPlayerEventRef.current("dash-initialize", {
      dashManifestUrl,
      usesProxyModifier: !!dashProxyPrefix,
    });

    const dashEvents = dashjs.MediaPlayer.events;
    const onPlaybackWaiting = () => {
      logPlayerEventRef.current("dash-playback-waiting", {
        readyState: video.readyState,
        networkState: video.networkState,
      });
    };
    const onBufferStateChanged = (event: unknown) => {
      logPlayerEventRef.current("dash-buffer-state", event as Record<string, unknown>);
    };
    const onQualityChangeRequested = (event: unknown) => {
      logPlayerEventRef.current("dash-quality-change-requested", event as Record<string, unknown>);
    };
    const onQualityChangeRendered = (event: unknown) => {
      const snapshot = qualitySwitchSnapshotRef.current;
      const qualityEvent = (event || {}) as Record<string, unknown>;
      logPlayerEventRef.current("dash-quality-change-rendered", {
        ...qualityEvent,
        snapshotFromTime: snapshot?.fromTime,
        snapshotAgeMs: snapshot ? Math.round(performance.now() - snapshot.appliedAt) : undefined,
      });

      const currentRep = player.getCurrentRepresentationForType("video");
      if (currentRep && currentRep.height) {
        setActiveQualityLabel(`${currentRep.height}p`);
      }

      if (snapshot && video.currentTime < Math.max(1, snapshot.fromTime - 2)) {
        const rewindTime = snapshot.fromTime;
        video.currentTime = rewindTime;
        snapshot.corrected = true;
        logPlayerEventRef.current("dash-quality-rewind-corrected", {
          rewindTime,
        });
      }
      if (qualitySwitchTimeoutRef.current) {
        clearTimeout(qualitySwitchTimeoutRef.current);
        qualitySwitchTimeoutRef.current = null;
      }
      qualitySwitchSnapshotRef.current = null;
    };
    const classifyDashError = (event: unknown): { label: string; fatal: boolean } => {
      const outer = (event || {}) as {
        error?: unknown;
        event?: unknown;
        message?: string;
      };
      const err = outer.error ?? outer.event ?? event;
      const code = Number((err as { code?: number })?.code);
      const rawMessage =
        typeof err === "string"
          ? err
          : (err as { message?: string })?.message ||
            outer.message ||
            String(err);
      const message = rawMessage.toLowerCase();
      if (code === 17 || code === 27 || code === 28) {
        return { label: "fragment-load-failure", fatal: true };
      }
      if (code === 25) {
        return { label: "manifest-load-failure", fatal: true };
      }
      if (message.includes("segmentbase") || message.includes("webm")) {
        return { label: "webm-segmentbase-loader", fatal: true };
      }
      if (message.includes("manifest")) {
        return { label: "manifest-parse", fatal: true };
      }
      if (message.includes("timeout") || message.includes("non-computable")) {
        return { label: "fragment-load-timeout", fatal: true };
      }
      if (message.includes("decode") || code === 3) {
        return { label: "media-decode", fatal: true };
      }
      if (message.includes("buffer")) {
        return { label: "buffer-stalled", fatal: false };
      }
      return { label: "dash-unknown", fatal: false };
    };
    const onPlaybackError = (event: unknown) => {
      const { label, fatal } = classifyDashError(event);
      logPlayerEventRef.current("dash-playback-error", { event, errorClass: label, fatal });
      if (fatal) fireRetrySourceRef.current(`dash:${label}`);
    };
    const onDashError = (event: unknown) => {
      const { label, fatal } = classifyDashError(event);
      logPlayerEventRef.current("dash-error", { event, errorClass: label, fatal });
      if (fatal) fireRetrySourceRef.current(`dash:${label}`);
    };
    const onCapabilitiesDrop = (event: unknown) => {
      logPlayerEventRef.current("dash-capabilities-dropped", { event });
      fireRetrySourceRef.current("dash:capabilities-dropped");
    };
    const onStreamInitialized = () => {
      dashReadyRef.current = true;
      logPlayerEventRef.current("dash-stream-initialized", {
        representations: player.getRepresentationsByType("video").map((representation) => ({
          id: representation.id,
          height: representation.height,
          width: representation.width,
          codecs: representation.codecs,
          mimeType: representation.mimeType,
          bandwidth: representation.bandwidth,
        })),
      });
      applyDashQualitySelectionRef.current();
      applyDashAudioSelectionRef.current();

      const currentRep = player.getCurrentRepresentationForType("video");
      if (currentRep && currentRep.height) {
        setActiveQualityLabel(`${currentRep.height}p`);
      }
    };

    player.on(dashEvents.PLAYBACK_WAITING, onPlaybackWaiting);
    player.on(dashEvents.BUFFER_LEVEL_STATE_CHANGED, onBufferStateChanged);
    player.on(dashEvents.QUALITY_CHANGE_REQUESTED, onQualityChangeRequested);
    player.on(dashEvents.QUALITY_CHANGE_RENDERED, onQualityChangeRendered);
    player.on(dashEvents.PLAYBACK_ERROR, onPlaybackError);
    player.on(dashEvents.ERROR, onDashError);
    player.on(dashEvents.ADAPTATION_SET_REMOVED_NO_CAPABILITIES, onCapabilitiesDrop);
    player.on(dashEvents.STREAM_INITIALIZED, onStreamInitialized);

    dashPlayerRef.current = player;
    player.initialize(video, dashManifestUrl, desiredPlayingRef.current || isPlaying);

    return () => {
      dashReadyRef.current = false;
      player.off(dashEvents.PLAYBACK_WAITING, onPlaybackWaiting);
      player.off(dashEvents.BUFFER_LEVEL_STATE_CHANGED, onBufferStateChanged);
      player.off(dashEvents.QUALITY_CHANGE_REQUESTED, onQualityChangeRequested);
      player.off(dashEvents.QUALITY_CHANGE_RENDERED, onQualityChangeRendered);
      player.off(dashEvents.PLAYBACK_ERROR, onPlaybackError);
      player.off(dashEvents.ERROR, onDashError);
      player.off(dashEvents.ADAPTATION_SET_REMOVED_NO_CAPABILITIES, onCapabilitiesDrop);
      player.off(dashEvents.STREAM_INITIALIZED, onStreamInitialized);
      if (qualitySwitchTimeoutRef.current) {
        clearTimeout(qualitySwitchTimeoutRef.current);
        qualitySwitchTimeoutRef.current = null;
      }
      player.destroy();
      if (dashPlayerRef.current === player) {
        dashPlayerRef.current = null;
      }
    };
  }, [bufferConfig, dashManifestUrl, dashProxyPrefix, isDashPlayback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!isHlsPlayback || !hlsManifestUrl) {
      hlsPlayerRef.current?.destroy();
      hlsPlayerRef.current = null;
      return;
    }

    const rewrite = (url: string) =>
      hlsProxyPrefix && !url.startsWith("http://127.0.0.1:") && !url.startsWith("blob:")
        ? `${hlsProxyPrefix}${encodeURIComponent(url)}`
        : url;

    if (!Hls.isSupported()) {
      logPlayerEventRef.current("hls-mse-unsupported", { hlsManifestUrl });
      fireRetrySourceRef.current("hls:mse-unsupported");
      return;
    }

    const DefaultLoader = Hls.DefaultConfig.loader as any;
    class ProxyLoader extends DefaultLoader {
      load(context: any, config: any, callbacks: any) {
        if (context?.url) context.url = rewrite(context.url);
        super.load(context, config, callbacks);
      }
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: bufferConfig.maxSeconds,
      maxMaxBufferLength: bufferConfig.maxSeconds,
      backBufferLength: Math.max(30, bufferConfig.maxSeconds),
      liveSyncDurationCount: 4,
      liveMaxLatencyDurationCount: 12,
      liveDurationInfinity: isLive,
      loader: ProxyLoader as unknown as typeof Hls.DefaultConfig.loader,
    });
    hlsPlayerRef.current = hls;
    let fatalRecoveryAttempts = 0;
    let destroyedAfterFatal = false;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      fatalRecoveryAttempts = 0;
      logPlayerEventRef.current("hls-manifest-parsed", { levels: hls.levels.length });
      if (desiredPlayingRef.current) void video.play().catch(() => {});
    });
    hls.on(Hls.Events.FRAG_LOADED, () => {
      fatalRecoveryAttempts = 0;
    });
    hls.on(Hls.Events.FRAG_CHANGED, (_event, data) => {
      const frag = data?.frag;
      if (!frag || !Number.isFinite(frag.sn as number) || !(frag.duration > 0)) return;
      const offset = (frag.sn as number) * frag.duration - frag.start;
      if (Number.isFinite(offset)) video.dataset.liveOffset = String(offset);
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      logPlayerEventRef.current("hls-error", {
        type: data.type,
        details: data.details,
        fatal: data.fatal,
      });
      if (!data.fatal) {
        if (isLive && data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          const syncPos = hls.liveSyncPosition;
          const seekable = video.seekable;
          const target =
            syncPos != null && Number.isFinite(syncPos)
              ? syncPos
              : seekable.length
                ? seekable.end(seekable.length - 1) - 4
                : null;
          if (target != null && Number.isFinite(target) && target > video.currentTime) {
            video.currentTime = target;
            if (desiredPlayingRef.current) void video.play().catch(() => {});
          }
        }
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR || data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        fatalRecoveryAttempts += 1;
        if (fatalRecoveryAttempts > MAX_HLS_FATAL_RECOVERY_ATTEMPTS) {
          // startLoad()/recoverMediaError() were looping unbounded on a dead
          // stream; give up and let the normal source fallback run.
          logPlayerEventRef.current("hls-fatal-recovery-exhausted", {
            details: data.details,
            attempts: fatalRecoveryAttempts,
          });
          destroyedAfterFatal = true;
          if (hlsPlayerRef.current === hls) hlsPlayerRef.current = null;
          hls.destroy();
          fireRetrySourceRef.current(`hls:fatal:${data.details}`);
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else {
          hls.recoverMediaError();
        }
      } else {
        fireRetrySourceRef.current(`hls:${data.details}`);
      }
    });

    hls.loadSource(hlsManifestUrl);
    hls.attachMedia(video);

    return () => {
      if (!destroyedAfterFatal) hls.destroy();
      if (hlsPlayerRef.current === hls) hlsPlayerRef.current = null;
    };
  }, [bufferConfig, hlsManifestUrl, hlsProxyPrefix, isHlsPlayback, isLive]);

  useEffect(() => {
    if (!isDashPlayback) return;
    applyDashQualitySelection();
  }, [applyDashQualitySelection, isDashPlayback, selectedQualityId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onVideoWaiting = () => {
      mediaBufferingRef.current = true;
      setIsBuffering(true);
      if (waitingSinceRef.current === null) waitingSinceRef.current = Date.now();
      stallCountRef.current += 1;
      if (usesExternalAudio) {
        // Record the pause as a hold so the drift policy agrees with the event
        // path and releases it through its resume rules.
        audioHoldRef.current = true;
        audioRef.current?.pause();
      }
      logPlayerEvent("html-video-waiting", {
        readyState: video.readyState,
        networkState: video.networkState,
        audioTime: audioRef.current?.currentTime,
      });
    };
    const onVideoStalled = () => {
      mediaBufferingRef.current = true;
      setIsBuffering(true);
      if (waitingSinceRef.current === null) waitingSinceRef.current = Date.now();
      stallCountRef.current += 1;
      if (usesExternalAudio) {
        audioHoldRef.current = true;
        audioRef.current?.pause();
      }
      logPlayerEvent("html-video-stalled", {
        readyState: video.readyState,
        networkState: video.networkState,
        audioTime: audioRef.current?.currentTime,
      });
    };
    const resumeExternalAudio = (eventName: string) => {
      mediaBufferingRef.current = false;
      setIsBuffering(false);
      waitingSinceRef.current = null;
      if (playbackStartAtRef.current === null) playbackStartAtRef.current = Date.now();
      const audio = audioRef.current;
      if (!usesExternalAudio || !audio) {
        logPlayerEvent(eventName, {
          readyState: video.readyState,
          networkState: video.networkState,
        });
        return;
      }

      audioHoldRef.current = false;
      if (Math.abs(audio.currentTime - video.currentTime) > AUDIO_DRIFT_TOLERANCE_SECONDS) {
        realignExternalAudioClock(audio, video, postSwitchRealignPendingRef.current);
      }
      postSwitchRealignPendingRef.current = false;
      if (Math.abs(audio.playbackRate - playbackRate) > 0.001) {
        audio.playbackRate = playbackRate;
      }
      resumeExternalAudioPlayback(audio, video);

      logPlayerEvent(eventName, {
        readyState: video.readyState,
        networkState: video.networkState,
        audioTime: audio.currentTime,
      });
    };
    const onVideoCanPlay = () => resumeExternalAudio("html-video-canplay");
    const onVideoPlaying = () => resumeExternalAudio("html-video-playing");
    const onVideoSeeking = () => {
      lastSeekAtRef.current = Date.now();
      waitingSinceRef.current = null;
      stallCountRef.current = 0;
      videoProgressSampleRef.current = null;
      const snapshot = qualitySwitchSnapshotRef.current;
      logPlayerEvent("html-video-seeking", {
        snapshotFromTime: snapshot?.fromTime,
        snapshotTargetQualityId: snapshot?.targetQualityId,
      });
      if (
        snapshot
        && !snapshot.corrected
        && performance.now() - snapshot.appliedAt < 10_000
        && video.currentTime < Math.max(1, snapshot.fromTime - 2)
      ) {
        const rewindTime = snapshot.fromTime;
        snapshot.corrected = true;
        requestAnimationFrame(() => {
          video.currentTime = rewindTime;
          logPlayerEvent("html-video-rewind-corrected", { rewindTime });
        });
      }
    };
    const onVideoError = () => {
      mediaBufferingRef.current = false;
      setIsBuffering(false);
      const code = video.error?.code;
      logPlayerEvent("html-video-error", {
        mediaError: video.error ? {
          code,
          message: video.error.message,
        } : null,
      });
      if (code && code !== 1) {
        fireRetrySourceRef.current(`media-error:${code}`);
      }
    };

    video.addEventListener("waiting", onVideoWaiting);
    video.addEventListener("stalled", onVideoStalled);
    video.addEventListener("canplay", onVideoCanPlay);
    video.addEventListener("playing", onVideoPlaying);
    video.addEventListener("seeking", onVideoSeeking);
    video.addEventListener("error", onVideoError);

    return () => {
      video.removeEventListener("waiting", onVideoWaiting);
      video.removeEventListener("stalled", onVideoStalled);
      video.removeEventListener("canplay", onVideoCanPlay);
      video.removeEventListener("playing", onVideoPlaying);
      video.removeEventListener("seeking", onVideoSeeking);
      video.removeEventListener("error", onVideoError);
    };
  }, [
    logPlayerEvent,
    playbackRate,
    realignExternalAudioClock,
    resumeExternalAudioPlayback,
    usesExternalAudio,
  ]);

  useEffect(() => {
    if (lastMediaIdentityRef.current === mediaIdentity) return;

    const video = videoRef.current;
    const audio = audioRef.current;
    const targetTime = Math.max(0, resumeTime || 0);

    pendingResumeTimeRef.current = targetTime;
    skippedSegmentsRef.current.clear();
    undoSkippedSegmentsRef.current.clear();
    mutedSegmentsRecordedRef.current.clear();
    notifiedSegmentsRef.current.clear();
    lastMediaIdentityRef.current = mediaIdentity;

    mediaBufferingRef.current = false;
    setIsBuffering(false);
    videoProgressSampleRef.current = null;
    postSwitchRealignPendingRef.current = true;

    if (targetTime > 0) {
      sourceSwitchingRef.current = true;
      setIsSourceSwitching(true);
      video?.pause();
      audio?.pause();
    } else {
      sourceSwitchingRef.current = false;
      setHasStartedPlayback(false);
      setIsSourceSwitching(false);
      if (video && Number.isFinite(video.currentTime) && video.currentTime !== 0) {
        try {
          video.currentTime = 0;
        } catch {
        }
      }
      if (audio && Number.isFinite(audio.currentTime) && audio.currentTime !== 0) {
        try {
          audio.currentTime = 0;
        } catch {
        }
      }
    }
  }, [mediaIdentity, resumeTime]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;

    if (isSourceSwitching || sourceSwitchingRef.current) return;

    desiredPlayingRef.current = isPlaying;
    if (isPlaying && (isDashPlayback || isHlsPlayback || src) && !error) {
      void video.play().catch((cause) => {
        if ((cause as DOMException | null)?.name === "AbortError") return;
        desiredPlayingRef.current = false;
        setIsPlaying(false);
      });
      if (usesExternalAudio && audio) {
        void audio.play().catch(() => {});
      }
    } else {
      video.pause();
      audio?.pause();
    }
  }, [error, isDashPlayback, isPlaying, isSourceSwitching, setIsPlaying, src, usesExternalAudio]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!audio || !video || !usesExternalAudio || isSourceSwitching) return;

    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
    audio.volume = muted ? 0 : volume;
    audio.muted = muted || volume === 0;

    const audioIdentity = `${mediaIdentity}|${selectedAudioTrack?.localUrl ?? ""}`;
    if (attachedAudioIdentityRef.current !== audioIdentity) {
      attachedAudioIdentityRef.current = audioIdentity;
      audioHoldRef.current = false;
      audioRecoveryAttemptsRef.current = 0;
      lastAudioResyncAtRef.current = performance.now();
      try {
        audio.currentTime = video.currentTime;
      } catch {
      }
    }

    if (isPlaying && !error) {
      void audio.play().catch(() => {});
    }
  }, [
    error,
    isPlaying,
    isSourceSwitching,
    mediaIdentity,
    muted,
    playbackRate,
    selectedAudioTrack?.localUrl,
    usesExternalAudio,
    volume,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    const effectiveMuted = muted || sbMuted;
    video.volume = usesExternalAudio ? 0 : (effectiveMuted ? 0 : volume);
    video.muted = usesExternalAudio || effectiveMuted || volume === 0;
    if (audio) {
      audio.volume = effectiveMuted ? 0 : volume;
      audio.muted = effectiveMuted || volume === 0;
    }
  }, [muted, sbMuted, usesExternalAudio, volume]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) {
      video.playbackRate = playbackRate;
      video.preservesPitch = true;
    }
    if (audio) {
      audio.playbackRate = playbackRate;
      audio.preservesPitch = true;
    }
  }, [playbackRate]);

  useEffect(() => () => {
    setIsFullscreen(false);
    void syncNativeFullscreen(false);
  }, [setIsFullscreen, syncNativeFullscreen]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnter = () => setIsPip(true);
    const onLeave = () => setIsPip(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  useEffect(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    if (sleepMinutes > 0) {
      sleepTimerRef.current = setTimeout(() => setPlaybackDesired(false), sleepMinutes * 60_000);
    }
    return () => {
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    };
  }, [setPlaybackDesired, sleepMinutes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "j":
          seekBy(-seekIntervalSeconds);
          break;
        case "l":
          seekBy(seekIntervalSeconds);
          break;
        case "arrowleft":
          event.preventDefault();
          seekBy(-seekIntervalSeconds);
          break;
        case "arrowright":
          event.preventDefault();
          seekBy(seekIntervalSeconds);
          break;
        case "arrowup":
          event.preventDefault();
          setVolume(volume + 0.05);
          setMuted(false);
          break;
        case "arrowdown":
          event.preventDefault();
          setVolume(volume - 0.05);
          break;
        case "m":
          setMuted((value) => !value);
          break;
        case "escape":
          if (isFullscreen) {
            event.preventDefault();
            toggleFullscreen();
          }
          break;
        case "f":
          toggleFullscreen();
          break;
        case "t":
          setIsTheaterMode(!isTheaterMode);
          break;
      }
      revealControls();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentTime,
    isFullscreen,
    isTheaterMode,
    revealControls,
    seekBy,
    seekIntervalSeconds,
    seekTo,
    setIsTheaterMode,
    setMuted,
    setVolume,
    toggleFullscreen,
    togglePlay,
    volume,
  ]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    const nextDuration = video.duration || duration || 0;
    setDuration(nextDuration);
    const pendingResumeTime = Math.max(resumeTime, pendingResumeTimeRef.current);
    if (pendingResumeTime > 0 && Math.abs(video.currentTime - pendingResumeTime) > 0.25) {
      const restoredTime = Math.min(pendingResumeTime, Math.max(0, nextDuration - 0.25));
      video.currentTime = restoredTime;
      if (audio) {
        try {
          audio.currentTime = restoredTime;
        } catch {
        }
      }
    }
    if (pendingResumeTime > 0) {
      setHasStartedPlayback(true);
      sourceSwitchingRef.current = false;
      setIsSourceSwitching(false);
      requestAnimationFrame(() => {
        syncExternalAudio(true);
        if (desiredPlayingRef.current || isPlaying) {
          void videoRef.current?.play().catch(() => {});
          if (usesExternalAudio) void audioRef.current?.play().catch(() => {});
        }
      });
    }
    updateBuffered();
  };

  const handleAudioLoadedMetadata = () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    audioHoldRef.current = false;
    realignExternalAudioClock(audio, video, true);

    if ((desiredPlayingRef.current || isPlaying) && usesExternalAudio && !isSourceSwitching) {
      void audio.play().catch(() => {});
    }
  };

  const handleAudioError = () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || !usesExternalAudio) return;

    const attempts = audioRecoveryAttemptsRef.current + 1;
    audioRecoveryAttemptsRef.current = attempts;
    logPlayerEvent("external-audio-error", {
      mediaError: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
      attempts,
    });

    if (attempts > MAX_EXTERNAL_AUDIO_RECOVERIES) {
      fireRetrySourceRef.current("external-audio-error");
      return;
    }

    const resumeAt = video.currentTime;
    const onReloaded = () => {
      audio.removeEventListener("loadedmetadata", onReloaded);
      lastAudioResyncAtRef.current = performance.now();
      try {
        audio.currentTime = resumeAt;
      } catch {
      }
      resumeExternalAudioPlayback(audio, video);
    };
    audio.addEventListener("loadedmetadata", onReloaded);
    audio.load();
  };

  const CATEGORY_LABELS: Record<string, string> = {
    sponsor: "Sponsor",
    intro: "Intro / Intermission",
    outro: "Outro / Credits",
    selfpromo: "Self-Promotion",
    interaction: "Interaction Reminder",
    music_offtopic: "Non-Music Filler",
    filler: "Filler Content",
    preview: "Preview / Recap",
    exclusive_access: "Exclusive Access",
  };

  const handleSkipNotifySegment = (segment: any) => {
    if (!segment) return;
    const video = videoRef.current;
    if (!video) return;

    const [_, end] = segment.segment;
    seekTo(end);

    setNotifyToast(prev => prev ? { ...prev, visible: false } : null);
    if (notifyTimeoutRef.current !== null) {
      window.clearTimeout(notifyTimeoutRef.current);
      notifyTimeoutRef.current = null;
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    const nextTime = video.currentTime;
    const nextDuration = video.duration || duration || 0;

    let inMuteSegment = false;
    let muteSegmentCategoryName = "";

    if (sponsorBlockEnabled) {
      for (const segment of sponsorBlockSegments) {
        const [start, end] = segment.segment;
        const action: SponsorBlockAction = sponsorBlockActions[segment.category as SponsorBlockCategory] || "ignore";

        if (action === "ignore") continue;

        if (nextTime >= start && nextTime < end) {
          if (action === "skip") {
            if (!skippedSegmentsRef.current.has(segment.UUID)) {
              skippedSegmentsRef.current.add(segment.UUID);

              seekTo(end);

              const durationSkipped = Math.max(0, end - start);
              void incrementStats(segment.category as SponsorBlockCategory, durationSkipped);

              return; 
            }
          } else if (action === "mute") {
            inMuteSegment = true;
            muteSegmentCategoryName = segment.category;

            if (!mutedSegmentsRecordedRef.current.has(segment.UUID)) {
              mutedSegmentsRecordedRef.current.add(segment.UUID);
              const durationMuted = Math.max(0, end - start);
              void incrementStats(segment.category as SponsorBlockCategory, durationMuted);
            }
          } else if (action === "notify") {
            if (!notifiedSegmentsRef.current.has(segment.UUID)) {
              notifiedSegmentsRef.current.add(segment.UUID);
              
              const catLabel = CATEGORY_LABELS[segment.category] || segment.category;
              setNotifyToast({
                segment,
                categoryName: catLabel,
                visible: true
              });

              if (notifyTimeoutRef.current !== null) {
                window.clearTimeout(notifyTimeoutRef.current);
              }

              notifyTimeoutRef.current = window.setTimeout(() => {
                setNotifyToast(prev => prev ? { ...prev, visible: false } : null);
                notifyTimeoutRef.current = null;
              }, 2000);

            }
          }
        }
      }
    }

    if (inMuteSegment) {
      if (!sbMuted) {
        setSbMuted(true);
        setCurrentSBMuteSegment(muteSegmentCategoryName);
      }
    } else {
      if (sbMuted) {
        setSbMuted(false);
        setCurrentSBMuteSegment(null);
      }
    }

    setCurrentTime(nextTime);
    setDuration(nextDuration);
    onTimeUpdate?.(nextTime, nextDuration);
    if (usesExternalAudio && audio) syncExternalAudio(false);
    updateBuffered();
  };

  const playerRootClasses = cx(
    isTheaterSurface
      ? "relative w-full aspect-video max-h-[calc(100vh-160px)] min-h-[480px] bg-chrome-black flex items-center justify-center rounded-none overflow-hidden text-chrome-white outline-none shadow-none"
      : "relative w-full aspect-video bg-chrome-black rounded-xl overflow-hidden text-chrome-white outline-none shadow-2xl",
    isFullscreen && "rounded-none",
    className
  );

  return (
    <div
      ref={containerRef}
      id="flow-player-root"
      data-fullscreen={isFullscreen || undefined}
      className={cx("group/player", playerRootClasses)}
      tabIndex={0}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        setControlsVisible(false);
      }}
    >
      {showAmbient && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-chrome-black"
        >
          <div
            className="absolute inset-[-18%] opacity-95 blur-3xl saturate-150 transition-colors duration-700 ease-out"
            style={ambientBackdropStyle}
          />
          <div className="absolute inset-0 bg-chrome-black/25" />
        </div>
      )}

      <video
        ref={videoRef}
        src={isDashPlayback || isHlsPlayback ? undefined : src || undefined}
        poster={effectivePoster}
        loop={videoLoopEnabled && !isLive}
        playsInline
        preload="auto"
        onLoadedMetadata={handleLoadedMetadata}
        onProgress={updateBuffered}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => {
          desiredPlayingRef.current = true;
          setHasStartedPlayback(true);
          setIsPlaying(true);
        }}
        onPause={() => {
          const video = videoRef.current;
          if (isDashPlayback && qualitySwitchSnapshotRef.current) {
            logPlayerEvent("video-pause-during-quality-switch", {
              snapshot: qualitySwitchSnapshotRef.current,
              pausedAt: video?.currentTime,
            });
            return;
          }
          if (sourceSwitchingRef.current) {
            logPlayerEvent("video-pause-during-source-switch", {
              pausedAt: video?.currentTime,
            });
            return;
          }
          if (desiredPlayingRef.current && src && !error && !video?.ended) {
            setTimeout(() => {
              if (desiredPlayingRef.current) {
                void videoRef.current?.play().catch(() => {});
                if (usesExternalAudio) void audioRef.current?.play().catch(() => {});
              }
            }, 0);
            return;
          }
          setIsPlaying(false);
        }}
        onEnded={() => {
          if (videoLoopEnabled && !isLive) {
            seekTo(0);
            setPlaybackDesired(true);
            return;
          }
          if (onEnded) {
            onEnded();
            return;
          }
          if (autoplayEnabled) {
            playNext();
          } else {
            setPlaybackDesired(false);
          }
        }}
        className="relative z-10 h-full w-full object-contain"
      />

      {usesExternalAudio && selectedAudioTrack?.localUrl && (
        <audio
          ref={audioRef}
          src={selectedAudioTrack.localUrl}
          preload="auto"
          onLoadedMetadata={handleAudioLoadedMetadata}
          onError={handleAudioError}
          className="hidden"
        />
      )}

      <PlayerGestureOverlay
        videoRef={videoRef}
        title={title}
        src={src}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        currentTime={currentTime}
        duration={duration}
        seekFeedback={seekFeedback}
        seekIntervalSeconds={seekIntervalSeconds}
        longPressPlaybackRate={longPressPlaybackRate}
        loopEnabled={videoLoopEnabled}
        setPlaybackRate={setPlaybackRate}
        onToggleLoop={toggleLoopSetting}
        togglePlay={togglePlay}
        toggleFullscreen={toggleFullscreen}
        togglePictureInPicture={togglePictureInPicture}
        seekTo={seekTo}
        onSeekFeedback={showSeekFeedback}
        onRevealControls={revealControls}
        isCompact={isPipMode}
      />

      {/* buffering spinner */}
      {isBuffering && !isLoading && !error && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-chrome-black/15 transition-all duration-300">
          <div className="relative flex items-center justify-center">
            <svg className="h-12 w-12 animate-spin text-chrome-white" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-20"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-80"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        </div>
      )}

      {/* Modular Subtitle Overlay */}
      <SubtitleOverlay
        captions={captions}
        selectedCaptionId={selectedCaptionId}
        currentTime={currentTime}
        shouldShowControls={shouldShowControls}
      />

      {(isLoading || error || errorInfo) && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-chrome-black/60 px-6 text-center">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 text-sm font-semibold text-chrome-zinc-200">
              <Loader2 className="animate-spin text-primary" size={34} />
              {getString("player_resolving_stream")}
            </div>
          ) : errorInfo ? (
            <PlayerErrorState
              error={errorInfo}
              onRetry={onRetry}
              onCopyLogs={onCopyLogs}
              onOpenInBrowser={onOpenInBrowser}
            />
          ) : (
            <div className="max-w-md space-y-4">
              <div className="text-base font-bold">{getString("player_error_generic_title")}</div>
              <p className="text-sm text-chrome-zinc-300">{error}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-chrome-white px-4 text-sm font-bold text-chrome-black transition-transform active:scale-95"
                >
                  <RotateCcw size={16} />
                  {getString("player_error_retry")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {videoCodecUnsupported && !isLoading && !error && !errorInfo && (
        <div className="absolute inset-x-4 top-4 z-40 mx-auto max-w-md rounded-2xl border border-chrome-toast-border bg-chrome-toast/95 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-primary" size={18} />
            <div className="min-w-0 space-y-2">
              <div className="text-sm font-bold text-chrome-neutral-100">
                {getString("player_codec_missing_title")}
              </div>
              <p className="text-xs text-chrome-neutral-300">
                {getString("player_codec_missing_hint")}
              </p>
              <p className="text-xs text-chrome-neutral-400">
                {getString("player_codec_missing_command_hint")}
              </p>
              <code className="block overflow-x-auto rounded-md bg-chrome-black/60 px-2 py-1.5 font-mono text-[11px] text-chrome-neutral-200">
                sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-bad gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly
              </code>
              <button
                type="button"
                onClick={() => {
                  codecWarningDismissedRef.current = true;
                  setVideoCodecUnsupported(false);
                }}
                className="text-xs font-semibold text-chrome-neutral-400 transition-colors hover:text-chrome-neutral-100"
              >
                {getString("player_codec_missing_dismiss")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SponsorBlock Notify Toast */}
      {notifyToast && notifyToast.visible && (
        <div className="absolute bottom-20 right-6 z-40 bg-chrome-toast/95 border border-chrome-toast-border rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 transition-transform duration-300 animate-slide-up select-none animate-fade-in">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-chrome-neutral-400 uppercase tracking-wider">SponsorBlock</span>
            <span className="text-xs font-semibold text-chrome-neutral-200">
              {notifyToast.categoryName} Segment
            </span>
          </div>
          <button
            onClick={() => handleSkipNotifySegment(notifyToast.segment)}
            className="ml-2 px-3.5 py-1.5 rounded-full bg-primary hover:bg-chrome-red-700 active:scale-95 text-chrome-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md"
          >
            Skip
          </button>
        </div>
      )}

      {/* SponsorBlock Muted Overlay */}
      {sbMuted && (
        <div className="absolute top-6 left-6 z-40 bg-chrome-toast/95 border border-chrome-toast-border rounded-xl px-4 py-2.5 shadow-2xl flex items-center gap-2 transition-all select-none">
          <svg className="w-4 h-4 text-primary animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
          <span className="text-xs font-bold text-chrome-neutral-200">
            SponsorBlock Muted ({CATEGORY_LABELS[currentSBMuteSegment || ""] || currentSBMuteSegment || "Filler"})
          </span>
        </div>
      )}

      {/* Compact transport for the floating mini player; full controls otherwise. */}
      {isPipMode ? (
        <MiniPlayerControls
          containerRef={containerRef}
          isPlaying={isPlaying}
          duration={duration}
          seekIntervalSeconds={seekIntervalSeconds}
          shouldShowControls={shouldShowControls}
          togglePlay={togglePlay}
          seekTo={seekTo}
          showSkipControls={miniPlayerShowSkipControls}
          showNextPrevControls={miniPlayerShowNextPrevControls}
        />
      ) : (
      <FlowPlayerControls
        title={title}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        containerRef={containerRef}
        controlsVisible={controlsVisible}
        setControlsVisible={setControlsVisible}
        shouldShowControls={shouldShowControls}
        qualities={supportedQualities}
        selectedQualityId={selectedQualityId || "auto"}
        isDashPlayback={isDashPlayback}
        isLive={isLive}
        onSelectQuality={onSelectQuality}
        captions={captions}
        selectedCaptionId={selectedCaptionId}
        setSelectedCaptionId={setSelectedCaptionId}
        audioTracks={audioTracks}
        selectedAudioTrackId={selectedAudioTrackId}
        setSelectedAudioTrackId={setSelectedAudioTrackId}
        bufferedPct={bufferedPct}
        sleepMinutes={sleepMinutes}
        setSleepMinutes={setSleepMinutes}
        muted={muted}
        setMuted={setMuted}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        isPip={isPip}
        togglePictureInPicture={togglePictureInPicture}
        showPipButton={manualPipButtonEnabled}
        showFullscreenTitle={showFullscreenTitle}
        seekTo={seekTo}
        togglePlay={togglePlay}
        speedOptions={configuredSpeedOptions}
        speedSliderEnabled={speedSliderEnabled}
        onSelectPlaybackRate={selectPlaybackRate}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        isScrubbing={isScrubbing}
        setIsScrubbing={setIsScrubbing}
        chapters={chapters}
        activeQualityLabel={isDashPlayback ? (activeQualityLabel || undefined) : (qualities.find(q => q.localUrl === src)?.qualityLabel || undefined)}
      />
      )}
    </div>
  );
};

export default Player;
