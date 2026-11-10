import { useEffect, useRef } from "react";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { UpdateDialog } from "./UpdateDialog";

/**
 * Delay the startup check so it never competes with first paint or the initial
 * data loads — the update prompt is low priority relative to getting the app
 * usable.
 */
const STARTUP_CHECK_DELAY_MS = 4000;

/** A long session looks again this often, as Flow for Android does. */
export const LONG_SESSION_CHECK_MS = 12 * 60 * 60 * 1000;

/**
 * Runs a silent update check shortly after launch and again every 12 hours (when
 * `enabled` and the user hasn't disabled auto-checks) and hosts the global update
 * dialog. Mount once at the app root.
 */
export function UpdateManager({ enabled }: { enabled: boolean }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const check = async () => {
      const store = useUpdaterStore.getState();
      await store.loadPreferences();
      const latest = useUpdaterStore.getState();
      // An open dialog or an update waiting for its restart is not interrupted.
      if (cancelled || !latest.autoCheck || latest.phase !== "idle") return;
      await latest.checkForUpdates({ silent: true });
    };
    const startup = window.setTimeout(() => void check(), STARTUP_CHECK_DELAY_MS);
    const recheck = window.setInterval(() => void check(), LONG_SESSION_CHECK_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(startup);
      window.clearInterval(recheck);
    };
  }, [enabled]);

  return <UpdateDialog />;
}
