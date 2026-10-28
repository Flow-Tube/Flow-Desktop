import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * This window's label: "main", "flow-N" for extra windows, or "pip" for the
 * pop-out player. Every window runs the same bundle in its own JS context.
 */
export const CURRENT_WINDOW_LABEL = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();

/** The main window owns music, deep links, the updater and other once-per-app jobs. */
export const IS_MAIN_WINDOW = CURRENT_WINDOW_LABEL === "main";
