import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLocation, useNavigate } from "react-router-dom";

import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { SETTINGS } from "./settings/schema";
import {
  PIP_EVENTS,
  type PipHandbackPayload,
  type PipProgressPayload,
  type PipVideoChangedPayload,
} from "./api/pip";
import { dismissPopoutPlayer, openPopoutPlayer } from "./pipHandoff";

/** Long enough for a minimize to settle before the window state is read. */
const MINIMIZE_DEBOUNCE_MS = 150;

const WATCH_ROUTE_RE = /^\/watch\/([^/?#]+)/;

function watchRouteVideoId(pathname: string): string | null {
  const match = pathname.match(WATCH_ROUTE_RE);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * The main window's half of the pop-out player handoff: it mirrors what the
 * pop-out is playing, takes playback back when the pop-out returns it, and
 * pops the player out when Flow is minimized mid-video.
 */
export function usePipController() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Both must be on: the pop-out is the only mini player that stays visible
  // once Flow itself is off screen.
  const popoutOnMinimize = useAppSettingsStore(
    (s) =>
      s.values[SETTINGS.PIP_SEPARATE_WINDOW] !== "false" &&
      s.values[SETTINGS.PIP_ON_MINIMIZE] !== "false",
  );
  // Read through refs: the listeners are registered once, and re-registering
  // them on every route change would drop events mid-swap.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    const subscriptions = [
      listen<PipProgressPayload>(PIP_EVENTS.progress, ({ payload }) => {
        const store = usePlayerStore.getState();
        if (store.videoPlayerMode !== "window") return;
        if (store.currentVideo?.id !== payload.videoId) return;
        store.applyPipRemoteState({
          currentTime: payload.positionSeconds,
          duration: payload.durationSeconds,
          isPlaying: payload.playing,
        });
      }),
      listen<PipVideoChangedPayload>(PIP_EVENTS.videoChanged, ({ payload }) => {
        const store = usePlayerStore.getState();
        if (store.videoPlayerMode !== "window") return;
        store.applyPipRemoteState({ video: payload.video });
      }),
      listen<PipHandbackPayload>(PIP_EVENTS.handback, async ({ payload }) => {
        // "Back to Flow" always brings playback home. A plain close only does
        // when this window is already showing that video — otherwise it would
        // leave audio running behind a window the user cannot see, so playback
        // ends instead.
        const shouldReturnPlayback =
          payload.expand ||
          (watchRouteVideoId(pathnameRef.current) === payload.videoId &&
            !(await getCurrentWindow()
              .isMinimized()
              .catch(() => false)));

        // Re-read after the await, and ignore a handback for a video this window
        // already moved on from: that one belongs to a pop-out we closed
        // ourselves, and acting on it would tear down whatever replaced it.
        const store = usePlayerStore.getState();
        if (store.videoPlayerMode !== "window") return;
        const video = store.currentVideo;
        if (!video || video.id !== payload.videoId) {
          store.expandVideoPlayer();
          return;
        }

        if (!shouldReturnPlayback) {
          store.dismissVideoPlayer();
          return;
        }

        store.setPipHandoff(video.id, payload.positionSeconds, payload.playing);
        store.setCurrentTime(payload.positionSeconds);
        store.expandVideoPlayer();
        if (payload.expand) navigateRef.current(`/watch/${video.id}`);
      }),
    ];

    return () => {
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, []);

  // Whatever ends the "playing in the pop-out" state here — a new video, the
  // queue being cleared, the watch page taking playback back — must also take
  // the pop-out window down with it.
  useEffect(() => {
    let previousMode = usePlayerStore.getState().videoPlayerMode;
    return usePlayerStore.subscribe((state) => {
      const mode = state.videoPlayerMode;
      if (mode === previousMode) return;
      const left = previousMode === "window";
      previousMode = mode;
      if (left) void dismissPopoutPlayer();
    });
  }, []);

  useEffect(() => {
    if (!popoutOnMinimize) return undefined;

    let disposed = false;
    let timer: number | null = null;
    const unlisteners: Array<() => void> = [];

    const checkMinimized = async () => {
      const store = usePlayerStore.getState();
      if (!store.currentVideo || !store.isPlaying) return;
      if (store.videoPlayerMode === "window") return;

      const minimized = await getCurrentWindow()
        .isMinimized()
        .catch(() => false);
      if (!minimized || disposed) return;
      await openPopoutPlayer();
    };

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void checkMinimized();
      }, MINIMIZE_DEBOUNCE_MS);
    };

    const track = (pending: Promise<() => void>) => {
      void pending
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(() => {});
    };

    try {
      const appWindow = getCurrentWindow();
      // No platform emits a minimize event of its own; a resize to nothing and a
      // focus loss are the two signals that reliably accompany one.
      track(appWindow.onResized(schedule));
      track(appWindow.onFocusChanged(({ payload: focused }) => {
        if (!focused) schedule();
      }));
    } catch {
      // Not running under Tauri (tests / plain vite preview).
    }

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      for (const unlisten of unlisteners) unlisten();
    };
  }, [popoutOnMinimize]);
}
