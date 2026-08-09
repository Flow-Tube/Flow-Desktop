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
} from "lucide-react";
import type { PlaybackRate } from "../../../store/usePlayerStore";
import { copyText } from "../../../lib/clipboard";

export type PlayerSeekFeedback = {
  id: number;
  direction: "forward" | "backward";
  seconds: number;
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
  seekIntervalSeconds: number;
  longPressPlaybackRate: PlaybackRate;
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

  const getCurrentUrl = (includeTime: boolean) => {
    const url = new URL(window.location.href);
    if (includeTime) {
      url.searchParams.set("t", `${Math.max(0, Math.floor(currentTime))}`);
    } else {
      url.searchParams.delete("t");
    }
    return url.toString();
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
    setIsBoosting(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    setContextMenu(null);
    onRevealControls();
    event.currentTarget.setPointerCapture(event.pointerId);

    longPressTimerRef.current = setTimeout(() => {
      previousRateRef.current = playbackRate;
      longPressActiveRef.current = true;
      setIsBoosting(true);
      setPlaybackRate(longPressPlaybackRate);
      onRevealControls();
    }, 420);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
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
    await copyText(JSON.stringify({
      title,
      src,
      currentTime: formatTime(currentTime),
      duration: formatTime(duration),
      playbackRate,
      readyState: video?.readyState,
      networkState: video?.networkState,
      resolution: video ? `${video.videoWidth}x${video.videoHeight}` : null,
    }, null, 2));
    showCopied("Debug info copied");
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
      action: async () => {
        await copyText(getCurrentUrl(false));
        showCopied("Video URL copied");
      },
    },
    {
      label: "Copy video URL at current time",
      icon: <Link size={21} />,
      action: async () => {
        await copyText(getCurrentUrl(true));
        showCopied("Timed URL copied");
      },
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
            className={`grid place-items-center rounded-full bg-chrome-black/30 text-chrome-white backdrop-blur-md animate-player-feedback ${
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
        <div className="pointer-events-none absolute left-1/2 top-8 z-30 -translate-x-1/2 rounded-full bg-chrome-black/30 px-5 py-2 text-sm font-bold text-chrome-white backdrop-blur-md animate-fade-in">
          {longPressPlaybackRate}x
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
            className={`flex flex-col items-center justify-center rounded-full bg-chrome-black/30 text-chrome-white backdrop-blur-md animate-player-seek ${
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
          className="absolute z-50 w-[342px] overflow-hidden rounded-xl border border-chrome-white/10 bg-background/45 p-2 text-chrome-white shadow-2xl backdrop-blur-xl animate-fade-in"
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
        <div className="pointer-events-none absolute left-1/2 top-8 z-50 -translate-x-1/2 rounded-full bg-chrome-black/75 px-4 py-2 text-xs font-bold text-chrome-white shadow-xl backdrop-blur-md animate-fade-in">
          {copiedLabel}
        </div>
      )}

      {statsVisible && (
        <div className="pointer-events-none absolute right-5 top-5 z-40 w-[min(92vw,320px)] rounded-xl border border-chrome-white/10 bg-chrome-black/70 p-3 text-xs font-semibold text-chrome-zinc-100 shadow-2xl backdrop-blur-md animate-fade-in">
          <div className="mb-2 text-sm font-black">Stats for nerds</div>
          <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-chrome-zinc-300">
            <span className="text-chrome-zinc-500">Time</span>
            <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
            <span className="text-chrome-zinc-500">Speed</span>
            <span>{playbackRate}x</span>
            <span className="text-chrome-zinc-500">Resolution</span>
            <span>{videoRef.current ? `${videoRef.current.videoWidth}x${videoRef.current.videoHeight}` : "Unknown"}</span>
            <span className="text-chrome-zinc-500">Ready state</span>
            <span>{videoRef.current?.readyState ?? "Unknown"}</span>
          </div>
        </div>
      )}
    </>
  );
};

export default PlayerGestureOverlay;
