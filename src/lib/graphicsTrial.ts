import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { getGraphicsReport, type GraphicsReport } from "./graphicsReport";
import { getString } from "./i18n/index";
import { profileStorage } from "./storage/profileStorage";
import { useUiStore } from "../store/useUiStore";

const NOTICE_SEEN_KEY = "flow_graphics_notice_seen";
const NOTICE_DURATION_MS = 12000;

/**
 * Restarts Flow on a faster Linux graphics tier (src-tauri/src/linux_startup.rs).
 * The user then keeps it, or Flow goes back on its own. Resolves false when
 * there is no faster tier to try.
 */
export async function startGraphicsTrial(): Promise<boolean> {
  try {
    return await invoke<boolean>("start_graphics_trial");
  } catch {
    return false;
  }
}

/** What marks a notice as already shown: a new tier or WebKitGTK is news again. */
export function noticeKey(report: GraphicsReport): string {
  return `${report.tier}:${report.webkitgtk}`;
}

export function shouldShowSlowGraphicsNotice(report: GraphicsReport | null, seen: string | null): boolean {
  return report?.faster === "suggested" && noticeKey(report) !== seen;
}

/**
 * The countdown of a faster-graphics trial launch. `secondsLeft` is null on
 * every other launch. The clock that ends an unanswered trial runs in the
 * backend and only starts once this question is on a visible window, because a
 * blank window can't answer and a hidden one hasn't been seen.
 */
export function useGraphicsTrial() {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const show = async () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", show);
      const seconds = await invoke<number | null>("graphics_trial_shown").catch(() => null);
      if (!active || seconds == null) return;
      setSecondsLeft(seconds);
      timer = setInterval(() => setSecondsLeft((left) => (left == null ? left : Math.max(0, left - 1))), 1000);
    };

    void getGraphicsReport().then((report) => {
      if (!active || report?.faster !== "trial") return;
      document.addEventListener("visibilitychange", show);
      void show();
    });

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", show);
      clearInterval(timer);
    };
  }, []);

  const keep = useCallback(() => {
    setSecondsLeft(null);
    void invoke("keep_graphics_trial").catch(() => {});
  }, []);

  const goBack = useCallback(() => {
    setSecondsLeft(null);
    void invoke("revert_graphics_trial").catch(() => {});
  }, []);

  return { secondsLeft, keep, goBack };
}

/**
 * Tells the user once when Flow runs on a slower graphics tier that a trial
 * could lift, since nothing else on screen says so.
 */
export function useSlowGraphicsNotice(enabled: boolean): void {
  const showToast = useUiStore((state) => state.showToast);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void getGraphicsReport().then((report) => {
      let seen: string | null = null;
      try {
        seen = profileStorage.getItem(NOTICE_SEEN_KEY, "device");
      } catch {
        return;
      }
      if (!active || !report || !shouldShowSlowGraphicsNotice(report, seen)) return;
      try {
        profileStorage.setItem(NOTICE_SEEN_KEY, noticeKey(report), "device");
      } catch {
        return;
      }
      showToast({
        title: getString("graphics_slow_notice_title"),
        message: getString("graphics_slow_notice_message"),
        durationMs: NOTICE_DURATION_MS,
        actions: [{ label: getString("graphics_try_faster"), onSelect: () => void startGraphicsTrial() }],
      });
    });
    return () => {
      active = false;
    };
  }, [enabled, showToast]);
}
