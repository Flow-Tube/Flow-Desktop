import { useEffect } from "react";

interface WakeLock {
  release: () => Promise<void>;
}

type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } };

const wakeLockApi = () => (typeof navigator === "undefined" ? undefined : (navigator as WakeLockNavigator).wakeLock);

/** Some webviews have no wake lock (WebKitGTK), so the switch for it isn't offered there. */
export const canKeepScreenOn = (): boolean => Boolean(wakeLockApi());

/**
 * Holds the screen on while `active`. The system drops the lock when the window is hidden, so it is
 * asked for again when the window comes back. A refusal only means the screen may sleep.
 */
export function useKeepScreenOn(active: boolean): void {
  useEffect(() => {
    const api = wakeLockApi();
    if (!active || !api) return;
    let lock: WakeLock | null = null;
    let stopped = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      void api
        .request("screen")
        .then((granted) => {
          if (stopped) void granted.release().catch(() => undefined);
          else lock = granted;
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
