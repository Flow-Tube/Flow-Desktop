import { invoke } from "@tauri-apps/api/core";
import { logToBackend } from "./diagnostics";

export interface WindowFullscreenController {
  sync(fullscreen: boolean): Promise<void>;
  /** True while a programmatic native transition is queued or in flight. */
  isTransitioning(): boolean;
  /**
   * Reconciles the controller with a fullscreen state observed on the native
   * window (the window manager or F11 changed it behind our back). Returns
   * true when this was an external change; reports that match the applied
   * state, or that arrive while a programmatic transition is pending, are
   * ignored.
   */
  noteNativeFullscreen(fullscreen: boolean): boolean;
}

type SetNativeFullscreen = (fullscreen: boolean) => Promise<void>;

function setNativeFullscreen(fullscreen: boolean): Promise<void> {
  return invoke("set_player_fullscreen", { fullscreen });
}

/**
 * Serializes native fullscreen transitions so a late enter cannot overwrite a
 * newer exit. Tauri/Tao owns the native window placement; callers must not
 * unmaximize or resize the window around these transitions.
 */
export function createWindowFullscreenController(
  applyNativeFullscreen: SetNativeFullscreen = setNativeFullscreen,
): WindowFullscreenController {
  let desiredFullscreen = false;
  let appliedFullscreen = false;
  let pendingTransitions = 0;
  let pendingTransition = Promise.resolve();

  const sync = (fullscreen: boolean): Promise<void> => {
    desiredFullscreen = fullscreen;
    pendingTransitions += 1;

    const transition = pendingTransition
      .then(async () => {
        if (desiredFullscreen !== fullscreen || appliedFullscreen === fullscreen) {
          return;
        }

        await applyNativeFullscreen(fullscreen);
        appliedFullscreen = fullscreen;
        void logToBackend("info", "window fullscreen sync", { fullscreen });
      })
      .catch((cause) => {
        void logToBackend("warn", "window fullscreen sync failed", {
          fullscreen,
          cause: String(cause),
        });
      })
      .finally(() => {
        pendingTransitions -= 1;
      });

    pendingTransition = transition;
    return transition;
  };

  const isTransitioning = () => pendingTransitions > 0;

  const noteNativeFullscreen = (fullscreen: boolean): boolean => {
    // Mid-transition observations are transient window states, not user intent.
    if (pendingTransitions > 0) return false;
    if (appliedFullscreen === fullscreen) return false;
    appliedFullscreen = fullscreen;
    desiredFullscreen = fullscreen;
    return true;
  };

  return { sync, isTransitioning, noteNativeFullscreen };
}

/**
 * Watches the native window for an OS-initiated fullscreen exit (F11, window
 * manager shortcut, session restore) that the app did not request, so the UI
 * fullscreen state can follow instead of desyncing. Only the exit direction is
 * reported: entering fullscreen is always app-initiated through
 * {@link WindowFullscreenController.sync}.
 */
export async function watchNativeFullscreenExit(
  controller: WindowFullscreenController,
  isFullscreenExpected: () => boolean,
  onExternalExit: () => void,
): Promise<() => void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();

  return appWindow.onResized(() => {
    if (controller.isTransitioning() || !isFullscreenExpected()) return;
    void appWindow
      .isFullscreen()
      .then((fullscreen) => {
        if (fullscreen || controller.isTransitioning() || !isFullscreenExpected()) return;
        controller.noteNativeFullscreen(false);
        void logToBackend("info", "window fullscreen exited natively");
        onExternalExit();
      })
      .catch(() => {
        // Best effort: a failed native query must not surface as a player error.
      });
  });
}
