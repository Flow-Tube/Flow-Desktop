import { useEffect } from "react";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

const ASPECT_RATIO = 16 / 9;
/** Quiet period after the last resize event before the height is corrected, so
 * the snap never fights a drag that is still in progress. */
const SETTLE_MS = 220;
/** Heights this close to 16:9 are left alone — snapping them would only jitter. */
const TOLERANCE_PX = 6;

/**
 * Holds the pop-out player at 16:9 after a resize settles. Tao exposes no
 * aspect-ratio constraint, and an off-ratio window would either letterbox or
 * push the transport controls past the bottom edge.
 */
export function usePipWindowAspectLock() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    let settleTimer: number | null = null;
    let applyingOwnResize = false;

    const snap = async (width: number, height: number) => {
      const target = Math.round(width / ASPECT_RATIO);
      if (Math.abs(target - height) <= TOLERANCE_PX) return;

      applyingOwnResize = true;
      try {
        await getCurrentWindow().setSize(new PhysicalSize(width, target));
      } catch {
        // Window gone, or the platform refused the size; the next resize retries.
      } finally {
        window.setTimeout(() => {
          applyingOwnResize = false;
        }, SETTLE_MS);
      }
    };

    try {
      void getCurrentWindow()
        .onResized(({ payload }) => {
          if (applyingOwnResize) return;
          if (settleTimer !== null) window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(() => {
            settleTimer = null;
            void snap(payload.width, payload.height);
          }, SETTLE_MS);
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
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      unlisten?.();
    };
  }, []);
}
