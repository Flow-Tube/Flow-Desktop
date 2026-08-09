import React, { useCallback, useEffect, useRef, useState } from "react";
import * as dashjs from "dashjs";
import {
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
} from "lucide-react";
import type { PlaybackRate } from "../../store/usePlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { SETTINGS } from "../../lib/settings/schema";
import { setSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import {
  formatPlaybackRate,
  normalizePlaybackRate,
  parseCustomSpeedPresets,
  selectPreferredCaptionId,
} from "../../lib/settings/playerRuntime";
import {
  AUDIO_DRIFT_TOLERANCE_SECONDS,
  AUDIO_RESYNC_MIN_INTERVAL_MS,
} from "../../lib/externalAudioSync";
import { useSubtitleSettingsSync } from "../../lib/useSubtitleSettingsSync";
import type { CaptionTrack, StreamVariant } from "../../types/video";
import { SubtitleOverlay } from "../player/SubtitleOverlay";
import { MediaScrubber } from "../ui/MediaScrubber";

interface ShortVideoSurfaceProps {
  dashUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  qualities: StreamVariant[];
  captions: CaptionTrack[];
  selectedQualityId: string;
  onSelectQuality: (variant: StreamVariant | "auto") => void;
  poster?: string;
  active: boolean;
  muted: boolean;
  playbackMode: string;
  autoScrollSeconds: number;
  onRequestAdvance?: () => void;
  onError?: () => void;
}

type SettingsPane = "root" | "speed" | "quality" | "captions";
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

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function proxyPrefix(dashUrl: string): string | null {
  const marker = "?url=";
  const index = dashUrl.indexOf(marker);
  return index < 0 ? null : dashUrl.slice(0, index + marker.length);
}

export function ShortVideoSurface({
  dashUrl,
  videoUrl,
  audioUrl,
  qualities,
  captions,
  selectedQualityId,
  onSelectQuality,
  poster,
  active,
  muted,
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
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
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
  const longPressPlaybackRate = normalizePlaybackRate(longPressSpeedSetting, 2);
  const speedOptions = parseCustomSpeedPresets(customSpeedPresets, customSpeedsEnabled);
  const selectedCaption = captions.find((caption) => caption.id === selectedCaptionId) ?? null;
  const selectedQualityLabel =
    selectedQualityId === "auto"
      ? "Auto"
      : qualities.find((quality) => quality.id === selectedQualityId)?.qualityLabel ||
        selectedQualityId;

  const useDirect = !!videoUrl;
  const hasSeparateAudio = useDirect && !!audioUrl && audioUrl !== videoUrl;
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

      if (audio && hasSeparateAudio && audioUrl) {
        audio.src = audioUrl;
        audio.loop = shouldLoop;
        audio.muted = mutedRef.current;
        audio.volume = 1;
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
      const player = dashjs.MediaPlayer().create();
      const dashEvents = dashjs.MediaPlayer.events;
      const playDash = () => {
        void video.play().catch(() => {});
      };
      const handleDashError = () => onError?.();
      const handleEnded = () => {
        if (shouldLoop || autoAdvanceFiredRef.current) return;
        autoAdvanceFiredRef.current = true;
        onRequestAdvance?.();
      };
      const prefix = proxyPrefix(dashUrl);
      if (prefix) {
        player.extend(
          "RequestModifier",
          () => ({
            modifyRequestURL: (url: string) =>
              url.startsWith("http://127.0.0.1:") || url.startsWith("blob:")
                ? url
                : `${prefix}${encodeURIComponent(url)}`,
            modifyRequestHeader: (xhr: XMLHttpRequest) => xhr,
          }),
          true,
        );
      }
      player.updateSettings({
        streaming: {
          capabilities: { useMediaCapabilitiesApi: false },
          buffer: { bufferToKeep: 12, bufferTimeDefault: 3 },
        },
      });
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
  }, [active, audioUrl, dashUrl, hasSeparateAudio, onRequestAdvance, playbackMode, shouldLoop, useDirect, videoUrl]);

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
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
    };

    video.addEventListener("timeupdate", syncProgress);
    video.addEventListener("durationchange", syncProgress);
    video.addEventListener("loadedmetadata", syncProgress);
    return () => {
      video.removeEventListener("timeupdate", syncProgress);
      video.removeEventListener("durationchange", syncProgress);
      video.removeEventListener("loadedmetadata", syncProgress);
    };
  }, [dashUrl, videoUrl]);

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
      longPressTimerRef.current = setTimeout(() => {
        previousRateRef.current = playbackRate;
        longPressActiveRef.current = true;
        setIsBoosting(true);
        setPlaybackRate(longPressPlaybackRate);
      }, 420);
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
      togglePlayback();
    },
    [contextMenu, togglePlayback],
  );

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

  const getCurrentUrl = useCallback(
    (includeTime: boolean) => {
      const url = new URL(window.location.href);
      if (includeTime) {
        url.searchParams.set("t", `${Math.max(0, Math.floor(progress))}`);
      } else {
        url.searchParams.delete("t");
      }
      return url.toString();
    },
    [progress],
  );

  const copyDebugInfo = useCallback(async () => {
    const video = videoRef.current;
    await copyText(JSON.stringify({
      currentTime: formatTime(progress),
      duration: formatTime(duration),
      playbackRate,
      selectedQualityId,
      readyState: video?.readyState,
      networkState: video?.networkState,
      resolution: video ? `${video.videoWidth}x${video.videoHeight}` : null,
      captions: captions.length,
    }, null, 2));
    showCopied("Debug info copied");
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

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
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
        onContextMenu={handleContextMenu}
      />
      {active && (
        <div className="absolute left-4 top-4 z-30 flex gap-2">
          <button
            type="button"
            aria-label="Short settings"
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
              aria-label="Short captions"
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
          className="absolute left-4 top-16 z-40 w-[min(82vw,320px)] overflow-hidden rounded-xl border border-chrome-white/10 bg-chrome-popover p-2 text-chrome-white"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {settingsPane !== "root" && (
            <button
              type="button"
              onClick={() => setSettingsPane("root")}
              className="mb-1 flex h-10 w-full items-center gap-2 rounded-md px-1 text-left text-sm font-bold hover:bg-chrome-white/10"
            >
              <ChevronLeft size={18} />
              {settingsPane === "speed"
                ? "Playback speed"
                : settingsPane === "quality"
                ? "Quality"
                : "Subtitles/CC"}
            </button>
          )}

          {settingsPane === "root" && (
            <div className="space-y-1">
              <SettingsRow
                icon={<Gauge size={18} />}
                label="Playback speed"
                value={playbackRate === 1 ? "Normal" : `${playbackRate}x`}
                onClick={() => setSettingsPane("speed")}
              />
              <SettingsRow
                icon={<Monitor size={18} />}
                label="Quality"
                value={selectedQualityLabel}
                onClick={() => setSettingsPane("quality")}
              />
              <SettingsRow
                icon={<Captions size={18} />}
                label="Subtitles/CC"
                value={selectedCaption ? selectedCaption.label : "Off"}
                onClick={() => setSettingsPane("captions")}
              />
            </div>
          )}

          {settingsPane === "speed" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1 select-scrollbar-hidden">
              {speedSliderEnabled && (
                <div className="rounded-md px-3 py-3 text-sm text-chrome-zinc-100">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-chrome-zinc-300">
                    <span>Speed</span>
                    <span className="font-mono text-primary">{playbackRate}x</span>
                  </div>
                  <input
                    aria-label="Playback speed"
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
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1 select-scrollbar-hidden">
              <MenuChoice
                checked={selectedQualityId === "auto"}
                label="Auto"
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
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1 select-scrollbar-hidden">
              <MenuChoice
                checked={selectedCaptionId === "off"}
                label="Off"
                onClick={() => {
                  setSelectedCaptionId("off");
                  setSettingsPane("root");
                }}
              />
              {captions.map((caption) => (
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
      />
      {isBoosting && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-30 -translate-x-1/2 rounded-full bg-chrome-black/80 px-5 py-2 text-sm font-bold text-chrome-white">
          {longPressPlaybackRate}x
        </div>
      )}
      {userPaused && (
        <button
          type="button"
          aria-label="Play"
          onClick={togglePlayback}
          className="absolute inset-0 z-20 grid place-items-center bg-chrome-black/10 text-chrome-white"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-chrome-black/80">
            <Play className="ml-1 h-8 w-8" fill="currentColor" />
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
            ariaLabel="Seek Short"
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
            label="Miniplayer"
            onClick={() => {
              togglePictureInPicture();
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Link size={20} />}
            label="Copy video URL"
            onClick={() => {
              void copyText(getCurrentUrl(false)).then(() => showCopied("Video URL copied"));
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Link size={20} />}
            label="Copy video URL at current time"
            onClick={() => {
              void copyText(getCurrentUrl(true)).then(() => showCopied("Timed URL copied"));
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Bug size={20} />}
            label="Copy debug info"
            onClick={() => {
              void copyDebugInfo();
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Info size={20} />}
            label="Stats for nerds"
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
        <div className="pointer-events-none absolute right-4 top-16 z-40 w-[min(82vw,300px)] rounded-xl border border-chrome-white/10 bg-chrome-black/85 p-3 text-xs font-semibold text-chrome-zinc-100">
          <div className="mb-2 text-sm font-black">Stats for nerds</div>
          <div className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-chrome-zinc-300">
            <span className="text-chrome-zinc-500">Time</span>
            <span>{formatTime(progress)} / {formatTime(duration)}</span>
            <span className="text-chrome-zinc-500">Speed</span>
            <span>{playbackRate}x</span>
            <span className="text-chrome-zinc-500">Quality</span>
            <span>{selectedQualityLabel}</span>
            <span className="text-chrome-zinc-500">Resolution</span>
            <span>{videoRef.current ? `${videoRef.current.videoWidth}x${videoRef.current.videoHeight}` : "Unknown"}</span>
            <span className="text-chrome-zinc-500">Captions</span>
            <span>{captions.length}</span>
          </div>
        </div>
      )}
      <audio ref={audioRef} preload="auto" />
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
      className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-chrome-zinc-100 transition-colors hover:bg-chrome-white/10"
    >
      <span className="grid h-7 w-7 place-items-center text-chrome-zinc-300">{icon}</span>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <span className="max-w-[44%] truncate text-right text-chrome-zinc-300">{value}</span>
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
      <span className="min-w-0 truncate text-left">
        {label}
        {detail && <span className="ml-1 text-xs text-chrome-zinc-400">{detail}</span>}
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
      className="flex h-11 w-full items-center gap-4 rounded-lg px-3 text-left text-sm font-bold text-chrome-zinc-100 transition-colors hover:bg-chrome-white/10"
      onClick={onClick}
    >
      <span className="grid h-7 w-7 place-items-center text-chrome-zinc-300">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
