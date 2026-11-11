import React, { useCallback, useEffect, useRef, useState } from "react";
import * as dashjs from "dashjs";
import { createProxiedDashPlayer } from "../../lib/dashSetup";
import {
  AudioLines,
  Bug,
  Captions,
  Check,
  ChevronLeft,
  Gauge,
  Info,
  Link,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  Settings,
  SlidersHorizontal,
  ThumbsUp,
} from "lucide-react";
import type { PlaybackRate } from "../../store/usePlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { SETTINGS } from "../../lib/settings/schema";
import { youtubeShortsUrl, youtubeWatchUrl } from "../../lib/youtubeUrl";
import { copyText } from "../../lib/clipboard";
import { getString } from "../../lib/i18n/index";
import { setSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import {
  formatPlaybackRate,
  normalizePlaybackRate,
  parseCustomSpeedPresets,
  selectPreferredCaptionId,
} from "../../lib/settings/playerRuntime";
import { LONG_PRESS_MS, longPressRate } from "../../lib/pointerGesture";
import {
  AUDIO_DRIFT_TOLERANCE_SECONDS,
  AUDIO_RESYNC_MIN_INTERVAL_MS,
} from "../../lib/externalAudioSync";
import { useSubtitleSettingsSync } from "../../lib/useSubtitleSettingsSync";
import type { AudioTrack, CaptionTrack, StreamVariant } from "../../types/video";
import { SubtitleOverlay } from "../player/SubtitleOverlay";
import { StatsForNerds } from "../player/StatsForNerds";
import { MediaScrubber } from "../ui/MediaScrubber";
import { noteShortEnded, noteShortProgress } from "../../lib/shortViews";
import { listenForShortsKeys } from "../../lib/shortsKeys";
import { useVideoEq } from "../../lib/audio/useVideoEq";
import { videoEqAvailable } from "../../lib/audio/mediaEqEngine";
import { useEqActive } from "../../lib/audio/eq/useEqualizer";
import { useEqStore } from "../../store/useEqStore";

interface ShortVideoSurfaceProps {
  videoId: string;
  dashUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  audioTracks: AudioTrack[];
  selectedAudioTrackId: string | null;
  onSelectAudioTrack: (id: string) => void;
  onDoubleClickLike: () => void;
  qualities: StreamVariant[];
  captions: CaptionTrack[];
  selectedQualityId: string;
  onSelectQuality: (variant: StreamVariant | "auto") => void;
  poster?: string;
  active: boolean;
  muted: boolean;
  volume: number;
  playbackMode: string;
  autoScrollSeconds: number;
  onRequestAdvance?: () => void;
  onError?: () => void;
}

type SettingsPane = "root" | "speed" | "quality" | "captions" | "audio";

// Long enough to read a double click, short enough that a single click still feels immediate.
const DOUBLE_CLICK_WAIT_MS = 220;
const LIKE_BURST_MS = 700;
type ContextMenuState = { x: number; y: number };

const DEFAULT_SPEED_OPTIONS: PlaybackRate[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ShortVideoSurface({
  videoId,
  dashUrl,
  videoUrl,
  audioUrl,
  audioTracks,
  selectedAudioTrackId,
  onSelectAudioTrack,
  onDoubleClickLike,
  qualities,
  captions,
  selectedQualityId,
  onSelectQuality,
  poster,
  active,
  muted,
  volume,
  playbackMode,
  autoScrollSeconds,
  onRequestAdvance,
  onError,
}: ShortVideoSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const userPausedRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousRateRef = useRef<PlaybackRate | null>(null);
  const longPressActiveRef = useRef(false);
  const suppressClickRef = useRef(false);
  const appliedInitialRateForRef = useRef<string | null>(null);
  const autoAdvanceFiredRef = useRef(false);
  const lastAudioResyncAtRef = useRef(0);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  const audioUrlRef = useRef(audioUrl);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    audioUrlRef.current = audioUrl;
  }, [audioUrl]);

  useEffect(() => {
    volumeRef.current = volume;
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) video.volume = volume;
    if (audio) audio.volume = volume;
  }, [volume]);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [userPaused, setUserPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("root");
  const [selectedCaptionId, setSelectedCaptionId] = useState("off");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [statsVisible, setStatsVisible] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);

  const playbackRate = usePlayerStore((state) => state.playbackRate);
  const setPlaybackRate = usePlayerStore((state) => state.setPlaybackRate);
  const rememberPlaybackSpeed = useAppSettingsStore((state) => state.values[SETTINGS.REMEMBER_PLAYBACK_SPEED] === "true");
  const playbackSpeedSetting = useAppSettingsStore((state) => state.values[SETTINGS.PLAYBACK_SPEED] ?? "1.0");
  const customSpeedsEnabled = useAppSettingsStore((state) => state.values[SETTINGS.CUSTOM_SPEEDS_ENABLED] === "true");
  const customSpeedPresets = useAppSettingsStore((state) => state.values[SETTINGS.CUSTOM_SPEED_PRESETS] ?? "");
  const longPressSpeedSetting = useAppSettingsStore((state) => state.values[SETTINGS.LONG_PRESS_PLAYBACK_SPEED] ?? "2.0");
  const speedSliderEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SPEED_SLIDER_ENABLED] === "true");
  const subtitlesEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SUBTITLES_ENABLED] === "true");
  const preferredSubtitleLanguage = useAppSettingsStore((state) => state.values[SETTINGS.PREFERRED_SUBTITLE_LANGUAGE] ?? "en");

  useSubtitleSettingsSync();

  const defaultPlaybackRate = normalizePlaybackRate(playbackSpeedSetting);
  const longPressPlaybackRate = longPressRate(longPressSpeedSetting);
  const speedOptions = parseCustomSpeedPresets(customSpeedPresets, customSpeedsEnabled);
  const selectedCaption = captions.find((caption) => caption.id === selectedCaptionId) ?? null;
  const selectedAudioTrack =
    audioTracks.find((track) => track.id === selectedAudioTrackId) ??
    audioTracks.find((track) => track.isDefault) ??
    audioTracks[0] ??
    null;
  const selectedVariant = qualities.find((quality) => quality.id === selectedQualityId) ?? null;
  const selectedQualityLabel =
    selectedQualityId === "auto" ? "Auto" : selectedVariant?.qualityLabel || selectedQualityId;

  const useDirect = !!videoUrl;
  const hasSeparateAudio = useDirect && !!audioUrl && audioUrl !== videoUrl;
  useVideoEq(videoRef, audioRef, hasSeparateAudio ? audioUrl : null, 1);
  const eqActive = useEqActive();
  const eqEditorHosted = useEqStore((s) => s.editorHosted);
  const openEqEditor = useEqStore((s) => s.setEditorOpen);
  const [likeBurst, setLikeBurst] = useState(false);
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const likeBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);
      if (likeBurstTimerRef.current) clearTimeout(likeBurstTimerRef.current);
    },
    [],
  );
  const shouldLoop = playbackMode === "loop";

  useEffect(() => {
    userPausedRef.current = userPaused;
  }, [userPaused]);

  useEffect(() => {
    if (!active) {
      setSettingsOpen(false);
      setContextMenu(null);
      setStatsVisible(false);
    }
  }, [active]);

  useEffect(() => {
    autoAdvanceFiredRef.current = false;
  }, [active, audioUrl, autoScrollSeconds, dashUrl, playbackMode, videoUrl]);

  useEffect(() => {
    if (!settingsOpen) setSettingsPane("root");
  }, [settingsOpen]);

  useEffect(() => {
    const mediaIdentity = videoUrl || dashUrl || "";
    if (!active || !mediaIdentity || appliedInitialRateForRef.current === mediaIdentity) return;
    appliedInitialRateForRef.current = mediaIdentity;
    setPlaybackRate(defaultPlaybackRate);
  }, [active, dashUrl, defaultPlaybackRate, setPlaybackRate, videoUrl]);

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
  }, [playbackRate, videoUrl, audioUrl]);

  useEffect(() => {
    if (!subtitlesEnabled) {
      setSelectedCaptionId("off");
      return;
    }
    setSelectedCaptionId(selectPreferredCaptionId(captions, preferredSubtitleLanguage) ?? "off");
  }, [captions, preferredSubtitleLanguage, subtitlesEnabled]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (previousRateRef.current !== null) setPlaybackRate(previousRateRef.current);
    };
  }, [setPlaybackRate]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;

    let syncTimer: number | null = null;

    const teardown = () => {
      if (syncTimer != null) {
        window.clearInterval(syncTimer);
        syncTimer = null;
      }
      try {
        dashRef.current?.destroy();
      } catch {
        dashRef.current = null;
      }
      dashRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };

    if (!active) {
      setUserPaused(false);
      userPausedRef.current = false;
      setProgress(0);
      setDuration(0);
      teardown();
      return teardown;
    }

    if (useDirect && videoUrl) {
      setUserPaused(false);
      userPausedRef.current = false;
      teardown();
      video.src = videoUrl;
      video.loop = shouldLoop && !hasSeparateAudio;
      video.muted = hasSeparateAudio ? true : mutedRef.current;
      video.volume = volumeRef.current;

      if (audio && hasSeparateAudio && audioUrlRef.current) {
        audio.src = audioUrlRef.current;
        audio.loop = shouldLoop;
        audio.muted = mutedRef.current;
        audio.volume = volumeRef.current;
        audio.playbackRate = playbackRate;
        audio.preservesPitch = true;
      }

      const realignAudio = (force: boolean) => {
        if (!audio || !hasSeparateAudio) return;
        const now = performance.now();
        if (!force) {
          if (Math.abs(audio.currentTime - video.currentTime) <= AUDIO_DRIFT_TOLERANCE_SECONDS) return;
          if (now - lastAudioResyncAtRef.current < AUDIO_RESYNC_MIN_INTERVAL_MS) return;
          if (audio.seeking || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        }
        lastAudioResyncAtRef.current = now;
        try {
          audio.currentTime = video.currentTime;
        } catch {
        }
      };

      const playBoth = () => {
        if (userPausedRef.current) return;
        if (audio && hasSeparateAudio) {
          realignAudio(false);
          void audio.play().catch(() => {});
        }
        void video.play().catch(() => {});
      };

      const pauseAudio = () => {
        if (audio && hasSeparateAudio) audio.pause();
      };

      const advanceOnce = () => {
        if (autoAdvanceFiredRef.current) return;
        autoAdvanceFiredRef.current = true;
        onRequestAdvance?.();
      };

      const loopBoth = () => {
        video.currentTime = 0;
        if (audio && hasSeparateAudio) {
          lastAudioResyncAtRef.current = performance.now();
          audio.currentTime = 0;
        }
        playBoth();
      };

      const handleEnded = () => {
        noteShortEnded(videoId);
        if (shouldLoop) {
          loopBoth();
          return;
        }
        advanceOnce();
      };

      video.addEventListener("canplay", playBoth);
      video.addEventListener("pause", pauseAudio);
      video.addEventListener("ended", handleEnded);

      if (audio && hasSeparateAudio) {
        syncTimer = window.setInterval(() => {
          if (video.paused || audio.paused) return;
          if (audio.currentTime - video.currentTime > AUDIO_DRIFT_TOLERANCE_SECONDS) return;
          realignAudio(false);
        }, 1_000);
      }

      video.load();

      return () => {
        video.removeEventListener("canplay", playBoth);
        video.removeEventListener("pause", pauseAudio);
        video.removeEventListener("ended", handleEnded);
        teardown();
      };
    }

    if (dashUrl) {
      setUserPaused(false);
      userPausedRef.current = false;
      teardown();
      video.loop = shouldLoop;
      video.muted = mutedRef.current;
      video.volume = volumeRef.current;
      const player = createProxiedDashPlayer(dashUrl, { buffer: { bufferToKeep: 12, bufferTimeDefault: 3 } });
      const dashEvents = dashjs.MediaPlayer.events;
      const playDash = () => {
        void video.play().catch(() => {});
      };
      const handleDashError = () => onError?.();
      const handleEnded = () => {
        noteShortEnded(videoId);
        if (shouldLoop || autoAdvanceFiredRef.current) return;
        autoAdvanceFiredRef.current = true;
        onRequestAdvance?.();
      };
      player.on(dashEvents.STREAM_INITIALIZED, playDash);
      player.on(dashEvents.ERROR, handleDashError);
      video.addEventListener("ended", handleEnded);
      player.initialize(video, dashUrl, true);
      dashRef.current = player;

      return () => {
        player.off(dashEvents.STREAM_INITIALIZED, playDash);
        player.off(dashEvents.ERROR, handleDashError);
        video.removeEventListener("ended", handleEnded);
        teardown();
      };
    }

    return teardown;
  }, [active, dashUrl, hasSeparateAudio, onRequestAdvance, playbackMode, shouldLoop, useDirect, videoId, videoUrl]);

  // Another audio language is only another audio file: the picture, its position and a pause all stay.
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!active || !video || !audio || !hasSeparateAudio || !audioUrl) return;
    if (audio.getAttribute("src") === audioUrl) return;
    lastAudioResyncAtRef.current = performance.now();
    audio.src = audioUrl;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
    audio.currentTime = video.currentTime;
    if (!video.paused && !userPausedRef.current) void audio.play().catch(() => {});
  }, [active, audioUrl, hasSeparateAudio, playbackRate]);

  useEffect(() => {
    if (!active || playbackMode !== "auto_interval" || autoAdvanceFiredRef.current) return;
    const intervalSeconds = Math.min(20, Math.max(5, autoScrollSeconds));
    if (duration > 0 && duration <= intervalSeconds) return;
    if (progress < intervalSeconds) return;
    autoAdvanceFiredRef.current = true;
    onRequestAdvance?.();
  }, [active, autoScrollSeconds, duration, onRequestAdvance, playbackMode, progress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncProgress = () => {
      setProgress(video.currentTime || 0);
      const known = Number.isFinite(video.duration) && video.duration > 0;
      if (known) setDuration(video.duration);
      noteShortProgress(videoId, (video.currentTime || 0) * 1000, known ? video.duration * 1000 : 0);
    };

    video.addEventListener("timeupdate", syncProgress);
    video.addEventListener("durationchange", syncProgress);
    video.addEventListener("loadedmetadata", syncProgress);
    return () => {
      video.removeEventListener("timeupdate", syncProgress);
      video.removeEventListener("durationchange", syncProgress);
      video.removeEventListener("loadedmetadata", syncProgress);
    };
  }, [dashUrl, videoUrl, videoId]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (hasSeparateAudio && audio) {
      if (video) video.muted = true;
      audio.muted = muted;
      if (!muted && active && !userPausedRef.current) void audio.play().catch(() => {});
    } else if (video) {
      video.muted = muted;
      if (!muted && active && !userPausedRef.current) void video.play().catch(() => {});
    }
  }, [active, audioUrl, hasSeparateAudio, muted, videoUrl]);

  const togglePlayback = useCallback(() => {
    if (!active) return;
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;

    if (video.paused) {
      userPausedRef.current = false;
      setUserPaused(false);
      if (audio && hasSeparateAudio) {
        lastAudioResyncAtRef.current = performance.now();
        audio.currentTime = video.currentTime;
        void audio.play().catch(() => {});
      }
      void video.play().catch(() => {});
    } else {
      userPausedRef.current = true;
      setUserPaused(true);
      video.pause();
      if (audio && hasSeparateAudio) audio.pause();
    }
  }, [active, hasSeparateAudio]);

  const selectPlaybackRate = useCallback(
    (nextRate: number) => {
      const normalized = normalizePlaybackRate(nextRate);
      setPlaybackRate(normalized);
      if (rememberPlaybackSpeed) {
        void setSettingValue(SETTINGS.PLAYBACK_SPEED, formatPlaybackRate(normalized));
      }
    },
    [rememberPlaybackSpeed, setPlaybackRate],
  );

  const restorePlaybackRate = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (longPressActiveRef.current && previousRateRef.current !== null) {
      setPlaybackRate(previousRateRef.current);
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    longPressActiveRef.current = false;
    previousRateRef.current = null;
    setIsBoosting(false);
  }, [setPlaybackRate]);

  const showCopied = useCallback((label: string) => {
    setCopiedLabel(label);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedLabel(null), 1400);
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active || event.button !== 0) return;
      setContextMenu(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (longPressPlaybackRate === null) return;
      longPressTimerRef.current = setTimeout(() => {
        previousRateRef.current = playbackRate;
        longPressActiveRef.current = true;
        setIsBoosting(true);
        setPlaybackRate(longPressPlaybackRate);
      }, LONG_PRESS_MS);
    },
    [active, longPressPlaybackRate, playbackRate, setPlaybackRate],
  );

  const handleSurfaceClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = setTimeout(() => {
        singleClickTimerRef.current = null;
        togglePlayback();
      }, DOUBLE_CLICK_WAIT_MS);
    },
    [contextMenu, togglePlayback],
  );

  const handleSurfaceDoubleClick = useCallback(() => {
    if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);
    singleClickTimerRef.current = null;
    onDoubleClickLike();
    setLikeBurst(true);
    if (likeBurstTimerRef.current) clearTimeout(likeBurstTimerRef.current);
    likeBurstTimerRef.current = setTimeout(() => setLikeBurst(false), LIKE_BURST_MS);
  }, [onDoubleClickLike]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      restorePlaybackRate();
      const rect = event.currentTarget.getBoundingClientRect();
      const menuWidth = 326;
      const menuHeight = 252;
      setContextMenu({
        x: clamp(event.clientX - rect.left, 12, Math.max(12, rect.width - menuWidth - 12)),
        y: clamp(event.clientY - rect.top, 12, Math.max(12, rect.height - menuHeight - 12)),
      });
    },
    [restorePlaybackRate],
  );

  // A Shorts link can't carry a time, so the timed link opens the short as a regular video.
  const getCurrentUrl = useCallback(
    (includeTime: boolean) => (includeTime ? youtubeWatchUrl(videoId, progress) : youtubeShortsUrl(videoId)),
    [progress, videoId],
  );

  const copyDebugInfo = useCallback(async () => {
    const video = videoRef.current;
    const copied = await copyText(JSON.stringify({
      currentTime: formatTime(progress),
      duration: formatTime(duration),
      playbackRate,
      selectedQualityId,
      readyState: video?.readyState,
      networkState: video?.networkState,
      resolution: video ? `${video.videoWidth}x${video.videoHeight}` : null,
      captions: captions.length,
    }, null, 2));
    showCopied(getString(copied ? "player_debug_info_copied" : "player_debug_info_copy_failed"));
  }, [captions.length, duration, playbackRate, progress, selectedQualityId, showCopied]);

  const togglePictureInPicture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {});
    } else {
      void video.requestPictureInPicture().catch(() => {});
    }
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      const audio = audioRef.current;
      if (!video || duration <= 0) return;
      const nextTime = Math.min(duration, Math.max(0, seconds));
      video.currentTime = nextTime;
      if (audio && hasSeparateAudio) {
        lastAudioResyncAtRef.current = performance.now();
        audio.currentTime = nextTime;
        if (!video.paused && !userPausedRef.current) void audio.play().catch(() => {});
      }
      setProgress(nextTime);
    },
    [duration, hasSeparateAudio],
  );

  const seekIntervalSeconds = useAppSettingsStore((state) => Number(state.values[SETTINGS.DOUBLE_TAP_SEEK_SECONDS] ?? 10));
  useEffect(() => {
    if (!active) return;
    return listenForShortsKeys((action) => {
      const video = videoRef.current;
      if (action.type === "toggle") {
        togglePlayback();
        return true;
      }
      if (!video) return false;
      if (action.type === "seek") {
        seekTo(video.currentTime + action.direction * (Number.isFinite(seekIntervalSeconds) ? seekIntervalSeconds : 10));
        return true;
      }
      if (action.type === "jump") {
        seekTo((duration * action.tenths) / 10);
        return true;
      }
      return false;
    });
  }, [active, duration, seekIntervalSeconds, seekTo, togglePlayback]);

  useEffect(() => {
    if (!active) return;
    const handleExternalSeek = (event: Event) => {
      const detail = (event as CustomEvent<{ time?: number }>).detail;
      if (typeof detail?.time === "number") seekTo(detail.time);
    };
    window.addEventListener("flow-player-seek", handleExternalSeek);
    return () => window.removeEventListener("flow-player-seek", handleExternalSeek);
  }, [active, seekTo]);

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        poster={poster}
        className={`h-full w-full bg-chrome-black ${fit === "cover" ? "object-cover" : "object-contain"}`}
        playsInline
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) {
            setFit(v.videoHeight >= v.videoWidth ? "cover" : "contain");
          }
        }}
        onError={(e) => {
          const v = e.currentTarget;
          if (active && v.error && v.currentSrc) onError?.();
        }}
      />
      <div
        className="absolute inset-0 z-10 cursor-default"
        onPointerDown={handlePointerDown}
        onPointerUp={restorePlaybackRate}
        onPointerCancel={restorePlaybackRate}
        onPointerLeave={restorePlaybackRate}
        onClick={handleSurfaceClick}
        onDoubleClick={handleSurfaceDoubleClick}
        onContextMenu={handleContextMenu}
      />
      {active && (
        <div className="absolute start-4 top-4 z-30 flex gap-2">
          <button
            type="button"
            aria-label={getString('shorts_short_settings')}
            onClick={(event) => {
              event.stopPropagation();
              setSettingsOpen((value) => !value);
              setContextMenu(null);
            }}
            className={cx(
              "grid h-10 w-10 place-items-center rounded-full bg-chrome-black/55 text-chrome-white transition-colors hover:bg-chrome-black/75",
              settingsOpen && "text-primary",
            )}
          >
            <Settings className={cx("h-5 w-5 transition-transform", settingsOpen && "rotate-90")} />
          </button>
          {captions.length > 0 && (
            <button
              type="button"
              aria-label={getString('shorts_short_captions')}
              onClick={(event) => {
                event.stopPropagation();
                setSettingsOpen(true);
                setSettingsPane("captions");
              }}
              className={cx(
                "grid h-10 w-10 place-items-center rounded-full bg-chrome-black/55 text-chrome-white transition-colors hover:bg-chrome-black/75",
                selectedCaptionId !== "off" && "text-primary",
              )}
            >
              <Captions className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      {settingsOpen && (
        <div
          className="absolute start-4 top-16 z-40 w-[min(82vw,320px)] overflow-hidden rounded-xl border border-chrome-white/10 bg-chrome-popover p-2 text-chrome-white"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {settingsPane !== "root" && (
            <button
              type="button"
              onClick={() => setSettingsPane("root")}
              className="mb-1 flex h-10 w-full items-center gap-2 rounded-md px-1 text-start text-sm font-bold hover:bg-chrome-white/10"
            >
              <ChevronLeft className="rtl:-scale-x-100" size={18} />
              {settingsPane === "speed"
                ? "Playback speed"
                : settingsPane === "quality"
                ? "Quality"
                : settingsPane === "audio"
                ? getString("player_menu_audio")
                : "Subtitles/CC"}
            </button>
          )}

          {settingsPane === "root" && (
            <div className="space-y-1">
              <SettingsRow
                icon={<Gauge size={18} />}
                label={getString('player_menu_speed')}
                value={playbackRate === 1 ? "Normal" : `${playbackRate}x`}
                onClick={() => setSettingsPane("speed")}
              />
              <SettingsRow
                icon={<Monitor size={18} />}
                label={getString('player_menu_quality')}
                value={selectedQualityLabel}
                onClick={() => setSettingsPane("quality")}
              />
              <SettingsRow
                icon={<Captions size={18} />}
                label={getString('player_menu_subtitles')}
                value={selectedCaption ? selectedCaption.label : "Off"}
                onClick={() => setSettingsPane("captions")}
              />
              {audioTracks.length > 1 && hasSeparateAudio && (
                <SettingsRow
                  icon={<AudioLines size={18} />}
                  label={getString("player_menu_audio")}
                  value={selectedAudioTrack?.label ?? getString("player_menu_audio_original")}
                  onClick={() => setSettingsPane("audio")}
                />
              )}
              {eqEditorHosted && (
                <SettingsRow
                  icon={<SlidersHorizontal size={18} />}
                  label={getString("music_equalizer")}
                  value={getString(!videoEqAvailable() ? "eq_state_unavailable" : eqActive ? "eq_state_on" : "eq_state_off")}
                  onClick={() => {
                    setSettingsOpen(false);
                    openEqEditor(true);
                  }}
                />
              )}
            </div>
          )}

          {settingsPane === "audio" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1 select-scrollbar-hidden">
              {audioTracks.map((track) => (
                <MenuChoice
                  key={track.id}
                  checked={selectedAudioTrack?.id === track.id}
                  label={track.label}
                  detail={track.languageCode ?? undefined}
                  onClick={() => {
                    onSelectAudioTrack(track.id);
                    setSettingsPane("root");
                  }}
                />
              ))}
            </div>
          )}

          {settingsPane === "speed" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1 select-scrollbar-hidden">
              {speedSliderEnabled && (
                <div className="rounded-md px-3 py-3 text-sm text-chrome-zinc-100">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-chrome-zinc-300">
                    <span>{getString('player_menu_speed_label')}</span>
                    <span className="font-mono text-primary">{playbackRate}x</span>
                  </div>
                  <input
                    aria-label={getString('player_menu_speed')}
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.05}
                    value={playbackRate}
                    onChange={(event) => selectPlaybackRate(Number(event.target.value))}
                    className="h-1 w-full accent-primary"
                  />
                </div>
              )}
              {(speedOptions.length ? speedOptions : DEFAULT_SPEED_OPTIONS).map((speed) => (
                <MenuChoice
                  key={speed}
                  checked={playbackRate === speed}
                  label={speed === 1 ? "Normal" : `${speed}x`}
                  onClick={() => {
                    selectPlaybackRate(speed);
                    setSettingsPane("root");
                  }}
                />
              ))}
            </div>
          )}

          {settingsPane === "quality" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1 select-scrollbar-hidden">
              <MenuChoice
                checked={selectedQualityId === "auto"}
                label={getString('player_menu_quality_auto')}
                onClick={() => {
                  onSelectQuality("auto");
                  setSettingsPane("root");
                  setSettingsOpen(false);
                }}
              />
              {qualities.map((quality) => (
                <MenuChoice
                  key={quality.id}
                  checked={
                    selectedQualityId === quality.id ||
                    selectedQualityId === quality.qualityLabel
                  }
                  label={quality.qualityLabel}
                  detail={quality.isVideoOnly ? "video" : undefined}
                  onClick={() => {
                    onSelectQuality(quality);
                    setSettingsPane("root");
                    setSettingsOpen(false);
                  }}
                />
              ))}
            </div>
          )}

          {settingsPane === "captions" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1 select-scrollbar-hidden">
              <MenuChoice
                checked={selectedCaptionId === "off"}
                label={getString('subscription_notifications_off')}
                onClick={() => {
                  setSelectedCaptionId("off");
                  setSettingsPane("root");
                }}
              />
              {captions.filter((caption) => !caption.isTranslation).map((caption) => (
                <MenuChoice
                  key={caption.id}
                  checked={selectedCaptionId === caption.id}
                  label={caption.label}
                  detail={caption.isAutoGenerated ? "auto" : undefined}
                  onClick={() => {
                    setSelectedCaptionId(caption.id);
                    setSettingsPane("root");
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <SubtitleOverlay
        captions={captions}
        selectedCaptionId={selectedCaptionId}
        currentTime={progress}
        shouldShowControls={settingsOpen}
        uprightVideo={fit === "cover"}
      />
      {likeBurst && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
          <span className="grid h-20 w-20 animate-ping place-items-center rounded-full bg-chrome-black/60 text-chrome-white [animation-iteration-count:1]">
            <ThumbsUp className="h-10 w-10" fill="currentColor" />
          </span>
        </div>
      )}
      {isBoosting && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-30 -translate-x-1/2 rounded-full bg-chrome-black/80 px-5 py-2 text-sm font-bold text-chrome-white">
          {longPressPlaybackRate}x
        </div>
      )}
      {userPaused && (
        <button
          type="button"
          aria-label={getString('download_play')}
          onClick={togglePlayback}
          className="absolute inset-0 z-20 grid place-items-center bg-chrome-black/10 text-chrome-white"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-chrome-black/80">
            <Play className="ms-1 h-8 w-8" fill="currentColor" />
          </span>
        </button>
      )}
      {active && duration > 0 && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-chrome-black/55 to-transparent px-3 pb-2 pt-6">
          <MediaScrubber
            progress={progress}
            duration={duration}
            onSeek={seekTo}
            variant="edge"
            ariaLabel={getString('shorts_seek_short')}
          />
        </div>
      )}
      {contextMenu && (
        <div
          className="absolute z-50 w-[306px] overflow-hidden rounded-xl border border-chrome-white/10 bg-background p-2 text-chrome-white"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <ContextMenuButton
            icon={<Pause size={20} />}
            label={userPaused ? "Play" : "Pause"}
            onClick={() => {
              togglePlayback();
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<PictureInPicture2 size={20} />}
            label={getString('player_menu_miniplayer')}
            onClick={() => {
              togglePictureInPicture();
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Link size={20} />}
            label={getString('player_menu_copy_url')}
            onClick={() => {
              void copyText(getCurrentUrl(false)).then((copied) => showCopied(getString(copied ? "player_video_url_copied" : "player_url_copy_failed")));
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Link size={20} />}
            label={getString('player_menu_copy_url_at_time')}
            onClick={() => {
              void copyText(getCurrentUrl(true)).then((copied) => showCopied(getString(copied ? "player_timed_url_copied" : "player_url_copy_failed")));
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Bug size={20} />}
            label={getString('player_menu_copy_debug')}
            onClick={() => {
              void copyDebugInfo();
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Info size={20} />}
            label={getString('player_menu_stats')}
            onClick={() => {
              setStatsVisible((value) => !value);
              setContextMenu(null);
            }}
          />
        </div>
      )}
      {copiedLabel && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-50 -translate-x-1/2 rounded-full bg-chrome-black/85 px-4 py-2 text-xs font-bold text-chrome-white">
          {copiedLabel}
        </div>
      )}
      {statsVisible && (
        <StatsForNerds
          videoRef={videoRef}
          currentTime={progress}
          duration={duration}
          playbackRate={playbackRate}
          qualityLabel={selectedQualityLabel}
          mimeType={selectedVariant?.mimeType}
          bitrate={selectedVariant?.bitrate}
          captionCount={captions.length}
          compact
          className="end-4 top-16"
        />
      )}
      <audio ref={audioRef} crossOrigin="anonymous" preload="auto" />
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-start text-sm text-chrome-zinc-100 transition-colors hover:bg-chrome-white/10"
    >
      <span className="grid h-7 w-7 place-items-center text-chrome-zinc-300">{icon}</span>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <span className="max-w-[44%] truncate text-end text-chrome-zinc-300">{value}</span>
    </button>
  );
}

function MenuChoice({
  checked,
  label,
  detail,
  onClick,
}: {
  checked: boolean;
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium text-chrome-zinc-100 hover:bg-chrome-white/10"
    >
      <span className="min-w-0 truncate text-start">
        {label}
        {detail && <span className="ms-1 text-xs text-chrome-zinc-400">{detail}</span>}
      </span>
      {checked && <Check size={17} />}
    </button>
  );
}

function ContextMenuButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-11 w-full items-center gap-4 rounded-lg px-3 text-start text-sm font-bold text-chrome-zinc-100 transition-colors hover:bg-chrome-white/10"
      onClick={onClick}
    >
      <span className="grid h-7 w-7 place-items-center text-chrome-zinc-300">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
