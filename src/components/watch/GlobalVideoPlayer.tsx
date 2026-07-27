import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { SETTINGS } from "../../lib/settings/schema";
import { FlowPlayerCore } from "./FlowPlayerCore";

type PlayerBounds = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const WATCH_ROUTE_RE = /^\/watch\/([^/?#]+)/;

function watchVideoIdFromPath(pathname: string) {
  const match = pathname.match(WATCH_ROUTE_RE);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function readSlotBounds(): PlayerBounds | null {
  const slot = document.querySelector<HTMLElement>("[data-flow-watch-player-slot='true']");
  if (!slot) return null;
  const rect = slot.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function boundsEqual(a: PlayerBounds | null, b: PlayerBounds | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export function GlobalVideoPlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const videoPlayerMode = usePlayerStore((s) => s.videoPlayerMode);
  const isVideoFullscreen = usePlayerStore((s) => s.isVideoFullscreen);
  const watchPageCache = usePlayerStore((s) => s.watchPageCache);
  const enterVideoPip = usePlayerStore((s) => s.enterVideoPip);
  const expandVideoPlayer = usePlayerStore((s) => s.expandVideoPlayer);
  const dismissVideoPlayer = usePlayerStore((s) => s.dismissVideoPlayer);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const autoPipEnabled = useAppSettingsStore((s) => s.values[SETTINGS.AUTO_PIP_ENABLED] !== "false");

  const [slotBounds, setSlotBounds] = useState<PlayerBounds | null>(null);
  const previousPathRef = useRef(location.pathname);
  const previousVideoIdRef = useRef(currentVideo?.id ?? null);

  const isFloating = videoPlayerMode === "pip";
  const cachedDetails =
    currentVideo && watchPageCache?.videoId === currentVideo.id
      ? watchPageCache.videoDetails
      : null;

  useEffect(() => {
    const previousVideoId = previousVideoIdRef.current;
    const nextVideoId = currentVideo?.id ?? null;
    previousVideoIdRef.current = nextVideoId;

    if (!nextVideoId || previousVideoId === nextVideoId) return;
    const routeVideoId = watchVideoIdFromPath(location.pathname);
    if (routeVideoId && routeVideoId !== nextVideoId) {
      navigate(`/watch/${nextVideoId}`, { replace: true });
    }
  }, [currentVideo?.id, location.pathname, navigate]);

  useEffect(() => {
    if (!currentVideo || !("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentVideo.title,
        artist: currentVideo.channelName,
        artwork: currentVideo.thumbnailUrl
          ? [{ src: currentVideo.thumbnailUrl }]
          : undefined,
      });
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch (error) {
      console.warn("Failed to update media session metadata", error);
    }

    try {
      navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
      navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
      navigator.mediaSession.setActionHandler("nexttrack", () => playNext(true));
      navigator.mediaSession.setActionHandler("previoustrack", playPrevious);
    } catch (error) {
      console.warn("Failed to configure media session actions", error);
    }

    return () => {
      for (const action of ["play", "pause", "nexttrack", "previoustrack"] as MediaSessionAction[]) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Some WebViews expose Media Session but not every action.
        }
      }
    };
  }, [currentVideo, isPlaying, playNext, playPrevious, setIsPlaying]);

  useEffect(() => {
    if (isFloating || isVideoFullscreen || !currentVideo) return;

    const sync = () => setSlotBounds((prev) => {
      const next = readSlotBounds();
      if (!next) return prev; 
      return boundsEqual(prev, next) ? prev : next;
    });

    sync();
    const slot = document.querySelector<HTMLElement>("[data-flow-watch-player-slot='true']");
    const observer = new ResizeObserver(sync);
    if (slot) observer.observe(slot);
    window.addEventListener("resize", sync);
    document.addEventListener("scroll", sync, true);

    let settleCount = 0;
    let settleRaf = window.requestAnimationFrame(function settle() {
      sync();
      if (++settleCount < 8) settleRaf = window.requestAnimationFrame(settle);
    });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("scroll", sync, true);
      window.cancelAnimationFrame(settleRaf);
    };
  }, [isFloating, isVideoFullscreen, currentVideo, location.pathname]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    if (previousPath === location.pathname) return;
    previousPathRef.current = location.pathname;

    if (!currentVideo) return;

    const prevWatchId = watchVideoIdFromPath(previousPath);
    const nextWatchId = watchVideoIdFromPath(location.pathname);

    if (nextWatchId === currentVideo.id) {
      if (videoPlayerMode === "pip") expandVideoPlayer();
      return;
    }

    if (prevWatchId === currentVideo.id && videoPlayerMode !== "pip") {
      if (isPlaying && autoPipEnabled) {
        enterVideoPip("auto");
      } else {
        dismissVideoPlayer();
      }
    }
  }, [
    location.pathname,
    currentVideo,
    videoPlayerMode,
    isPlaying,
    autoPipEnabled,
    enterVideoPip,
    expandVideoPlayer,
    dismissVideoPlayer,
  ]);

  const expandFromFloating = useCallback(() => {
    if (!currentVideo) return;
    expandVideoPlayer();
    navigate(`/watch/${currentVideo.id}`);
  }, [currentVideo, expandVideoPlayer, navigate]);

  useEffect(() => {
    window.addEventListener("flow-video-expand-request", expandFromFloating);
    return () => window.removeEventListener("flow-video-expand-request", expandFromFloating);
  }, [expandFromFloating]);

  const frameStyle = useMemo(() => {
    if (isVideoFullscreen) {
      return {
        inset: 0,
        width: "100%",
        height: "100%",
      } as const;
    }

    if (isFloating) {
      return {
        top: "auto",
        left: "auto",
        height: "auto",
        bottom: "24px",
        right: "24px",
        width: "min(420px, calc(100vw - 32px))",
        aspectRatio: "16 / 9",
      } as const;
    }

    if (!slotBounds) {
      return {
        opacity: 0,
        pointerEvents: "none" as const,
      };
    }

    return {
      top: `${slotBounds.top}px`,
      left: `${slotBounds.left}px`,
      width: `${slotBounds.width}px`,
      height: `${slotBounds.height}px`,
    };
  }, [isFloating, isVideoFullscreen, slotBounds]);

  const videoIdForPlayer = currentVideo?.id ?? null;
  const playerNode = useMemo(
    () =>
      videoIdForPlayer ? (
        <FlowPlayerCore videoId={videoIdForPlayer} videoDetails={cachedDetails} />
      ) : null,
    [videoIdForPlayer, cachedDetails],
  );

  if (!currentVideo) return null;

  return (
    <div
      className={
        isVideoFullscreen
          ? "fixed z-[300] overflow-hidden bg-chrome-black"
          : isFloating
          ? "group fixed z-50 overflow-hidden rounded-xl bg-chrome-black shadow-2xl ring-1 ring-chrome-white/10"
          : "fixed z-30 bg-chrome-black"
      }
      style={frameStyle}
    >
      {isFloating && (
        <div className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-full bg-chrome-black/80 p-1 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100">
          <button
            type="button"
            aria-label="Expand video"
            onClick={expandFromFloating}
            className="grid h-7 w-7 place-items-center rounded-full text-chrome-white hover:bg-chrome-white/15"
          >
            <Maximize2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Close video"
            onClick={dismissVideoPlayer}
            className="grid h-7 w-7 place-items-center rounded-full text-chrome-white hover:bg-chrome-white/15"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="group h-full w-full">{playerNode}</div>
    </div>
  );
}
