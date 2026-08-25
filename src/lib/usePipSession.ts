import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useAppSettingsStore, setSettingValue } from "../store/useAppSettingsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { seekToTime } from "./linkify";
import { SETTINGS } from "./settings/schema";
import { PIP_RETURN_REQUEST_EVENT } from "./pipHandoff";
import { primeStreamInfo } from "./streamResolution";
import {
  PIP_EVENTS,
  focusMainWindow,
  getPipSession,
  markPipWindowReady,
  setPipAlwaysOnTop,
  type PipHandbackPayload,
  type PipProgressPayload,
  type PipTakeoverPayload,
  type PipVideoChangedPayload,
} from "./api/pip";

export type PipSessionStatus = "loading" | "playing" | "empty";

/** How often the pop-out reports its position back to the main window. */
const PROGRESS_INTERVAL_MS = 1000;

/**
 * Longest this window stays silent after announcing it is ready. The takeover
 * normally lands within a frame or two; this only matters if the main window
 * never sends one — a silent pop-out is a far worse failure than a brief overlap.
 */
const SILENCE_FALLBACK_MS = 4000;

/**
 * Drives the pop-out player window: hydrates its own player store from the
 * handoff the main window left in the backend, publishes playback back so the
 * watch page stays in step, and hands the exact position over when it closes.
 *
 * Both windows run the same bundle in separate JS contexts, so nothing is
 * shared implicitly — every crossing is an explicit event or command.
 */
export function usePipSession() {
  const [status, setStatus] = useState<PipSessionStatus>("loading");
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const silenceFallbackRef = useRef<number | null>(null);

  const clearSilenceFallback = useCallback(() => {
    if (silenceFallbackRef.current !== null) {
      window.clearTimeout(silenceFallbackRef.current);
      silenceFallbackRef.current = null;
    }
  }, []);

  const armSilenceFallback = useCallback(() => {
    if (!usePlayerStore.getState().isHandoffSilent) return;
    clearSilenceFallback();
    silenceFallbackRef.current = window.setTimeout(() => {
      silenceFallbackRef.current = null;
      usePlayerStore.getState().setHandoffSilent(false);
    }, SILENCE_FALLBACK_MS);
  }, [clearSilenceFallback]);

  useEffect(() => clearSilenceFallback, [clearSilenceFallback]);

  const hydrate = useCallback(async () => {
    const session = await getPipSession().catch(() => null);
    const index = session
      ? Math.min(Math.max(session.currentIndex, 0), session.queue.length - 1)
      : -1;
    const video = index >= 0 ? session?.queue[index] : null;
    if (!session || !video) {
      setStatus("empty");
      return;
    }

    // Adopt the main window's work before anything mounts: its validated
    // settings, and the stream it already resolved. Both are on the critical
    // path to the first frame, and re-doing either is pure delay.
    useAppSettingsStore.getState().hydrateSettings(session.settings);
    if (session.stream) {
      primeStreamInfo(video.id, session.stream.info, session.stream.resolvedAt);
    }

    const store = usePlayerStore.getState();
    // Stay silent while the main window is still playing this out loud; the
    // takeover event lifts it at the swap.
    store.setHandoffSilent(session.silentUntilTakeover);
    store.setQueue(session.queue, index);
    store.setPipHandoff(video.id, session.positionSeconds, session.playing);
    // The pop-out *is* the mini player surface, so its whole viewport uses the
    // compact transport rather than the full watch-page controls.
    store.enterVideoPip("manual");
    setStatus("playing");
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Hydration seeds the settings this window needs to pick a quality and a
      // buffer profile, so playback starts first; SponsorBlock/DeArrow settings
      // load behind it rather than holding up the first frame.
      await hydrate();
      if (cancelled) return;
      await markPipWindowReady().catch(() => {});

      const pinned =
        useAppSettingsStore.getState().values[SETTINGS.PIP_ALWAYS_ON_TOP] !== "false";
      setAlwaysOnTop(pinned);
      await setPipAlwaysOnTop(pinned).catch(() => {});

      void useSettingsStore.getState().loadSettings().catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  // A second handoff reuses this window instead of spawning another one.
  useEffect(() => {
    const pending = listen(PIP_EVENTS.sessionChanged, () => {
      void hydrate();
    }).catch(() => null);
    return () => {
      void pending.then((unlisten) => unlisten?.());
    };
  }, [hydrate]);

  useEffect(() => {
    if (status !== "playing") return undefined;

    return usePlayerStore.subscribe((state, previous) => {
      // The main window is still playing until it hears this: `playing` on the
      // media element is the first moment a swap would be seamless.
      if (
        state.playbackStartedVideoId &&
        state.playbackStartedVideoId !== previous.playbackStartedVideoId
      ) {
        void emit(PIP_EVENTS.ready).catch(() => {});
        armSilenceFallback();
      }

      const next = state.currentVideo;
      if (!next || !previous.currentVideo || next.id === previous.currentVideo.id) return;
      // The queue advanced inside the pop-out; the main window has no other way
      // to learn what is playing now.
      void emit(PIP_EVENTS.videoChanged, { video: next } satisfies PipVideoChangedPayload).catch(
        () => {},
      );
    });
  }, [armSilenceFallback, status]);

  useEffect(() => {
    if (status !== "playing") return undefined;

    const timer = window.setInterval(() => {
      const { currentVideo, currentTime, duration, isPlaying } = usePlayerStore.getState();
      if (!currentVideo) return;
      void emit(PIP_EVENTS.progress, {
        videoId: currentVideo.id,
        positionSeconds: currentTime,
        durationSeconds: duration,
        playing: isPlaying,
      } satisfies PipProgressPayload).catch(() => {});
    }, PROGRESS_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [status]);

  // The swap: continue from where the main window actually got to. That point is
  // already inside this player's buffer, so the seek costs a frame rather than a
  // rebuffer, and the sound picks up where the other window left off.
  useEffect(() => {
    const pending = listen<PipTakeoverPayload>(PIP_EVENTS.takeover, ({ payload }) => {
      const store = usePlayerStore.getState();
      if (Number.isFinite(payload.positionSeconds) && payload.positionSeconds > 0) {
        store.setCurrentTime(payload.positionSeconds);
        seekToTime(payload.positionSeconds);
      }
      clearSilenceFallback();
      store.setHandoffSilent(false);
    }).catch(() => null);
    return () => {
      void pending.then((unlisten) => unlisten?.());
    };
  }, [clearSilenceFallback]);

  const handBack = useCallback((expand: boolean) => {
    const { currentVideo, currentTime, isPlaying } = usePlayerStore.getState();
    if (!currentVideo) return Promise.resolve();
    return emit(PIP_EVENTS.handback, {
      videoId: currentVideo.id,
      positionSeconds: currentTime,
      playing: isPlaying,
      expand,
    } satisfies PipHandbackPayload).catch(() => {});
  }, []);

  const returnToMainWindow = useCallback(async () => {
    await handBack(true);
    await focusMainWindow().catch(() => {});
    // destroy() skips the close-requested handler, so the handback above is the
    // only one that fires.
    await getCurrentWindow().destroy().catch(() => {});
  }, [handBack]);

  const closeWindow = useCallback(async () => {
    await getCurrentWindow().close().catch(() => {});
  }, []);

  // Closing the pop-out — from its own button, the taskbar, or the main window
  // shutting it down — must still return the position it reached.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    try {
      void getCurrentWindow()
        .onCloseRequested(async () => {
          await handBack(false);
        })
        .then((dispose) => {
          if (disposed) dispose();
          else unlisten = dispose;
        })
        .catch(() => {});
    } catch {
      // Not running under Tauri (tests / plain vite preview).
    }

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handBack]);

  // The main window can ask for playback back (its "bring it back" affordance),
  // and the player's own miniplayer menu means the same thing in here. Both
  // funnel through the one path that reports the position first.
  useEffect(() => {
    const pending = listen(PIP_RETURN_REQUEST_EVENT, () => {
      void returnToMainWindow();
    }).catch(() => null);
    return () => {
      void pending.then((unlisten) => unlisten?.());
    };
  }, [returnToMainWindow]);

  useEffect(() => {
    const onExpandRequest = () => {
      // Player already flipped this window out of mini-player mode on its way
      // here; undoing it in the same tick keeps the full controls from flashing
      // before the window closes.
      usePlayerStore.getState().enterVideoPip("manual");
      void returnToMainWindow();
    };
    window.addEventListener("flow-video-expand-request", onExpandRequest);
    return () => window.removeEventListener("flow-video-expand-request", onExpandRequest);
  }, [returnToMainWindow]);

  const toggleAlwaysOnTop = useCallback(() => {
    setAlwaysOnTop((current) => {
      const next = !current;
      void setPipAlwaysOnTop(next).catch(() => {});
      void setSettingValue(SETTINGS.PIP_ALWAYS_ON_TOP, String(next));
      return next;
    });
  }, []);

  return { status, alwaysOnTop, toggleAlwaysOnTop, returnToMainWindow, closeWindow };
}
