import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { SETTINGS } from "../../lib/settings/schema";
import { FlowPlayerCore } from "./FlowPlayerCore";
import { decideRouteChangePlayerAction } from "../../lib/watchRouteSync";
import { useMediaSessionMetadata } from "../../lib/useMediaSessionMetadata";

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
  const videoPlayerMode = usePlayerStore((s) => s.videoPlayerMode);
  const isVideoFullscreen = usePlayerStore((s) => s.isVideoFullscreen);
  const isVideoFullscreenTransitioning = usePlayerStore((s) => s.isVideoFullscreenTransitioning);
  const watchPageCache = usePlayerStore((s) => s.watchPageCache);
  const enterVideoPip = usePlayerStore((s) => s.enterVideoPip);
  const expandVideoPlayer = usePlayerStore((s) => s.expandVideoPlayer);
  const dismissVideoPlayer = usePlayerStore((s) => s.dismissVideoPlayer);
  const autoPipEnabled = useAppSettingsStore((s) => s.values[SETTINGS.AUTO_PIP_ENABLED] !== "false");

  const [slotBounds, setSlotBounds] = useState<PlayerBounds | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const lastSlotBoundsRef = useRef<PlayerBounds | null>(null);
  const previousPathRef = useRef(location.pathname);
  const previousVideoIdRef = useRef(currentVideo?.id ?? null);

  const isFloating = videoPlayerMode === "pip";
  // The pop-out window owns playback in this mode, so this window renders no
  // media element — two decoding the same video would double audio and CPU.
  const isPoppedOut = videoPlayerMode === "window";
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

  // While the pop-out owns playback it also owns the OS transport controls.
  useMediaSessionMetadata(!isPoppedOut);

  useEffect(() => {
    if (isFloating || isPoppedOut || isVideoFullscreen || !currentVideo) return;

    // Position is owned here alone and moves with a transform, which the
    // compositor applies without a layout pass on every scroll frame. React's
    // frameStyle sets only the size, so a re-render can't snap the frame back
    // to a stale position.
    const writeFrameBounds = (bounds: PlayerBounds, prev: PlayerBounds | null) => {
      const frame = frameRef.current;
      if (!frame) return;
      frame.style.transform = `translate3d(${bounds.left}px, ${bounds.top}px, 0)`;
      if (!prev || prev.width !== bounds.width || prev.height !== bounds.height) {
        frame.style.width = `${bounds.width}px`;
        frame.style.height = `${bounds.height}px`;
      }
    };

    const sync = () => {
      const next = readSlotBounds();
      if (!next) return;
      const prev = lastSlotBoundsRef.current;
      lastSlotBoundsRef.current = next;
      if (!boundsEqual(prev, next)) writeFrameBounds(next, prev);
      if (!prev || prev.width !== next.width || prev.height !== next.height) {
        setSlotBounds((old) => (boundsEqual(old, next) ? old : next));
      }
    };

    sync();
    const slot = document.querySelector<HTMLElement>("[data-flow-watch-player-slot='true']");
    let resizeRaf: number | null = null;
    const onResize = () => {
      if (resizeRaf !== null) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        sync();
      });
    };
    const observer = new ResizeObserver(onResize);
    if (slot) observer.observe(slot);
    window.addEventListener("resize", onResize);

    let scrollRaf: number | null = null;
    const onScroll = (event: Event) => {
      // Scrolling a menu, the sidebar or a comments panel can't move the slot.
      const scroller = event.target;
      if (slot && scroller instanceof Element && !scroller.contains(slot)) return;
      if (scrollRaf !== null) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = null;
        sync();
      });
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });

    // Late layout (fonts, images, side panels) can move the slot for a few
    // frames after a route/mode change; each settle tick also writes
    // imperatively through sync().
    let settleCount = 0;
    let settleRaf = window.requestAnimationFrame(function settle() {
      sync();
      if (++settleCount < 8) settleRaf = window.requestAnimationFrame(settle);
    });

    return () => {
      observer.disconnect();
      // Floating and fullscreen layouts position the frame with insets.
      if (frameRef.current) frameRef.current.style.transform = "";
      lastSlotBoundsRef.current = null;
      if (resizeRaf !== null) window.cancelAnimationFrame(resizeRaf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (scrollRaf !== null) window.cancelAnimationFrame(scrollRaf);
      window.cancelAnimationFrame(settleRaf);
    };
  }, [isFloating, isPoppedOut, isVideoFullscreen, currentVideo?.id, location.pathname]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    if (previousPath === location.pathname) return;
    previousPathRef.current = location.pathname;

    // The route renders in a transition, so values from this render can be a
    // step behind the store; decide from the store as it is now.
    const player = usePlayerStore.getState();
    const action = decideRouteChangePlayerAction({
      previousWatchId: watchVideoIdFromPath(previousPath),
      nextWatchId: watchVideoIdFromPath(location.pathname),
      currentVideoId: player.currentVideo?.id ?? null,
      videoPlayerMode: player.videoPlayerMode,
      isPlaying: player.isPlaying,
      autoPipEnabled,
    });
    if (action === "expand") expandVideoPlayer();
    else if (action === "enter-pip") enterVideoPip("auto");
    else if (action === "dismiss") dismissVideoPlayer();
  }, [location.pathname, autoPipEnabled, enterVideoPip, expandVideoPlayer, dismissVideoPlayer]);

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
      top: 0,
      left: 0,
      width: `${slotBounds.width}px`,
      height: `${slotBounds.height}px`,
      willChange: "transform",
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

  if (!currentVideo || isPoppedOut) return null;

  return (
    <>
      <div
        ref={frameRef}
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

      {isVideoFullscreenTransitioning && (
        <div className="pointer-events-none fixed inset-0 z-[400] bg-chrome-black" />
      )}
    </>
  );
}
