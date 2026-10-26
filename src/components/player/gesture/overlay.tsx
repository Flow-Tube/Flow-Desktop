import React, { useEffect, useRef, useState } from "react";
import {
  Bug,
  FastForward,
  Info,
  Link,
  Pause,
  PictureInPicture2,
  Play,
  Rewind,
  Repeat1,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePlayerStore, type PlaybackRate } from "../../../store/usePlayerStore";
import { copyText } from "../../../lib/clipboard";
import { getString } from "../../../lib/i18n/index";
import { youtubeWatchUrl } from "../../../lib/youtubeUrl";
import { LONG_PRESS_MS, shouldStartWindowDrag } from "../../../lib/pointerGesture";
import { startWindowDrag } from "../../../lib/api/pip";
import { StatsForNerds } from "../StatsForNerds";

export type PlayerSeekFeedback = {
  id: number;
  direction: "forward" | "backward";
  seconds: number;
};

export type PlayerVolumeFeedback = {
  id: number;
  volume: number;
  muted: boolean;
};

type CenterFeedback = {
  id: number;
  icon: "play" | "pause";
};

type ContextMenuState = {
  x: number;
  y: number;
};

type PlayerGestureOverlayProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  title?: string;
  src?: string | null;
  isPlaying: boolean;
  playbackRate: PlaybackRate;
  currentTime: number;
  duration: number;
  seekFeedback: PlayerSeekFeedback | null;
  volumeFeedback: PlayerVolumeFeedback | null;
  qualityLabel?: string | null;
  mimeType?: string | null;
  bitrate?: number | null;
  captionCount?: number;
  seekIntervalSeconds: number;
  /** Null when hold-to-speed-up is off. */
  longPressPlaybackRate: PlaybackRate | null;
  loopEnabled: boolean;
  setPlaybackRate: (playbackRate: PlaybackRate) => void;
  onToggleLoop: () => void;
  togglePlay: () => void;
  toggleFullscreen: () => void;
  togglePictureInPicture: () => void;
  seekTo: (time: number) => void;
  onSeekFeedback: (direction: PlayerSeekFeedback["direction"], seconds: number) => void;
  onRevealControls: () => void;
  isCompact?: boolean;
  /** In the pop-out window, a press that moves drags the window. */
  canDragWindow?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}


export const PlayerGestureOverlay: React.FC<PlayerGestureOverlayProps> = ({
  videoRef,
  title,
  src,
  isPlaying,
  playbackRate,
  currentTime,
  duration,
  seekFeedback,
  volumeFeedback,
  qualityLabel,
  mimeType,
  bitrate,
  captionCount,
  seekIntervalSeconds,
  longPressPlaybackRate,
  loopEnabled,
  setPlaybackRate,
  onToggleLoop,
  togglePlay,
  toggleFullscreen,
  togglePictureInPicture,
  seekTo,
  onSeekFeedback,
  onRevealControls,
  isCompact = false,
  canDragWindow = false,
}) => {
  const [centerFeedback, setCenterFeedback] = useState<CenterFeedback | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [isBoosting, setIsBoosting] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const centerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousRateRef = useRef<PlaybackRate | null>(null);
  const longPressActiveRef = useRef(false);
  const suppressClickRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  // The OS takes the pointer for a window drag, so the click that may follow
  // arrives late or never; it is dropped here and forgotten on the next press.
  const draggedRef = useRef(false);

  useEffect(() => {
    if (!centerFeedback) return;
    if (centerTimerRef.current) clearTimeout(centerTimerRef.current);
    centerTimerRef.current = setTimeout(() => setCenterFeedback(null), 1400);
    return () => {
      if (centerTimerRef.current) clearTimeout(centerTimerRef.current);
    };
  }, [centerFeedback]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (previousRateRef.current) setPlaybackRate(previousRateRef.current);
    };
  }, [setPlaybackRate]);

  const showCopied = (label: string) => {
    setCopiedLabel(label);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedLabel(null), 1400);
  };

  const copyVideoUrl = async (includeTime: boolean) => {
    const videoId = usePlayerStore.getState().currentVideo?.id;
    if (!videoId) return;
    const copied = await copyText(youtubeWatchUrl(videoId, includeTime ? currentTime : undefined));
    showCopied(
      getString(!copied ? "player_url_copy_failed" : includeTime ? "player_timed_url_copied" : "player_video_url_copied"),
    );
  };

  const restorePlaybackRate = () => {
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
    pressStartRef.current = null;
    setIsBoosting(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    setContextMenu(null);
    onRevealControls();
    draggedRef.current = false;
    pressStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);

    if (longPressPlaybackRate === null) return;
    longPressTimerRef.current = setTimeout(() => {
      previousRateRef.current = playbackRate;
      longPressActiveRef.current = true;
      setIsBoosting(true);
      setPlaybackRate(longPressPlaybackRate);
      onRevealControls();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pressStartRef.current;
    if (!start) return;
    const drag = shouldStartWindowDrag({
      canDragWindow,
      boosting: longPressActiveRef.current,
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
    });
    if (!drag) return;
    restorePlaybackRate();
    draggedRef.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void startWindowDrag().catch(() => {});
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (contextMenu) {
      setContextMenu(null);
      return;
    }

    togglePlay();
    setCenterFeedback({
      id: Date.now(),
      icon: isPlaying ? "play" : "pause",
    });
    onRevealControls();
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < rect.width * 0.35) {
      seekTo(currentTime - seekIntervalSeconds);
      onSeekFeedback("backward", seekIntervalSeconds);
    } else if (x > rect.width * 0.65) {
      seekTo(currentTime + seekIntervalSeconds);
      onSeekFeedback("forward", seekIntervalSeconds);
    } else {
      toggleFullscreen();
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    restorePlaybackRate();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 366;
    const menuHeight = 300;
    setContextMenu({
      x: clamp(event.clientX - rect.left, 12, Math.max(12, rect.width - menuWidth - 12)),
      y: clamp(event.clientY - rect.top, 12, Math.max(12, rect.height - menuHeight - 12)),
    });
    onRevealControls();
  };

  const runMenuAction = async (action: () => void | Promise<void>) => {
    await action();
    setContextMenu(null);
  };

  const copyDebugInfo = async () => {
    const video = videoRef.current;
    const copied = await copyText(JSON.stringify({
      title,
      src,
      currentTime: formatTime(currentTime),
      duration: formatTime(duration),
      playbackRate,
      readyState: video?.readyState,
      networkState: video?.networkState,
      resolution: video ? `${video.videoWidth}x${video.videoHeight}` : null,
    }, null, 2));
    showCopied(getString(copied ? "player_debug_info_copied" : "player_debug_info_copy_failed"));
  };

  const menuItems = [
    {
      label: loopEnabled ? "Loop on" : "Loop",
      icon: <Repeat1 size={21} />,
      action: onToggleLoop,
    },
    {
      label: "Miniplayer",
      icon: <PictureInPicture2 size={21} />,
      action: togglePictureInPicture,
    },
    {
      label: "Copy video URL",
      icon: <Link size={21} />,
      action: () => copyVideoUrl(false),
    },
    {
      label: "Copy video URL at current time",
      icon: <Link size={21} />,
      action: () => copyVideoUrl(true),
    },
    {
      label: "Copy debug info",
      icon: <Bug size={21} />,
      action: copyDebugInfo,
    },
    {
      label: "Stats for nerds",
      icon: <Info size={21} />,
      action: () => setStatsVisible((value) => !value),
    },
  ];

  return (
    <>
      <div
        className="absolute inset-0 z-[15] cursor-default"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={restorePlaybackRate}
        onPointerCancel={restorePlaybackRate}
        onPointerLeave={restorePlaybackRate}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {centerFeedback && (
        <div
          key={centerFeedback.id}
          className="pointer-events-none absolute inset-0 z-30 grid place-items-center"
        >
          <div
            className={`grid place-items-center rounded-full bg-chrome-black/60 text-chrome-white animate-player-feedback ${
              isCompact ? "h-16 w-16" : "h-28 w-28"
            }`}
          >
            {centerFeedback.icon === "play" ? (
              <Play size={isCompact ? 30 : 62} fill="currentColor" className="ml-1" />
            ) : (
              <Pause size={isCompact ? 30 : 62} fill="currentColor" />
            )}
          </div>
        </div>
      )}

      {isBoosting && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-30 -translate-x-1/2 rounded-full bg-chrome-black/60 px-5 py-2 text-sm font-bold text-chrome-white animate-fade-in">
          {longPressPlaybackRate}x
        </div>
      )}

      {volumeFeedback && (
        <div
          key={volumeFeedback.id}
          className="pointer-events-none absolute left-1/2 top-8 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-chrome-black/60 px-5 py-2 text-chrome-white animate-fade-in"
        >
          {volumeFeedback.muted || volumeFeedback.volume === 0 ? (
            <VolumeX size={18} />
          ) : volumeFeedback.volume < 0.55 ? (
            <Volume1 size={18} />
          ) : (
            <Volume2 size={18} />
          )}
          <div className="h-1 w-24 overflow-hidden rounded-full bg-chrome-white/25">
            <div
              className="h-full rounded-full bg-chrome-white"
              style={{ width: `${volumeFeedback.muted ? 0 : Math.round(volumeFeedback.volume * 100)}%` }}
            />
          </div>
          <span className="min-w-[3ch] text-sm font-bold tabular-nums">
            {volumeFeedback.muted ? 0 : Math.round(volumeFeedback.volume * 100)}
          </span>
        </div>
      )}

      {seekFeedback && (
        <div
          key={seekFeedback.id}
          className={`pointer-events-none absolute top-1/2 z-30 -translate-y-1/2 ${
            seekFeedback.direction === "forward" ? "right-[16%]" : "left-[16%]"
          }`}
        >
          <div
            className={`flex flex-col items-center justify-center rounded-full bg-chrome-black/60 text-chrome-white animate-player-seek ${
              isCompact ? "h-14 w-14" : "h-24 w-24"
            }`}
          >
            {seekFeedback.direction === "forward" ? (
              <FastForward size={isCompact ? 20 : 34} />
            ) : (
              <Rewind size={isCompact ? 20 : 34} />
            )}
            <span className={`mt-1 font-black ${isCompact ? "text-xs" : "text-lg"}`}>
              {seekFeedback.direction === "forward" ? "+" : "-"}
              {seekFeedback.seconds}
            </span>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="absolute z-50 w-[342px] overflow-hidden rounded-xl border border-chrome-white/10 bg-background/90 p-2 text-chrome-white shadow-2xl animate-fade-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className="flex h-12 w-full items-center gap-4 rounded-lg px-3 text-left text-sm font-bold text-chrome-zinc-100 transition-colors hover:bg-chrome-white/10"
              onClick={() => void runMenuAction(item.action)}
            >
              <span className="grid h-7 w-7 place-items-center text-chrome-zinc-300">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {copiedLabel && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-50 -translate-x-1/2 rounded-full bg-chrome-black/80 px-4 py-2 text-xs font-bold text-chrome-white shadow-xl animate-fade-in">
          {copiedLabel}
        </div>
      )}

      {statsVisible && (
        <StatsForNerds
          videoRef={videoRef}
          currentTime={currentTime}
          duration={duration}
          playbackRate={playbackRate}
          qualityLabel={qualityLabel}
          mimeType={mimeType}
          bitrate={bitrate}
          captionCount={captionCount}
          compact={isCompact}
          className="right-5 top-5"
        />
      )}
    </>
  );
};

export default PlayerGestureOverlay;
