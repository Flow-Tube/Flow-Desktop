import { SETTINGS } from "./settings/schema";
import { APP_TITLEBAR_HEIGHT, IS_MACOS_RUNTIME } from "./platform";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

/** Where the minimize, maximize and close buttons go on Linux and Windows (#755). */
export type WindowButtonsPlace = "titlebar" | "topbar" | "none";

export function readWindowButtonsPlace(raw: string | undefined): WindowButtonsPlace {
  return raw === "topbar" || raw === "none" ? raw : "titlebar";
}

/**
 * Whether Flow's own title bar shows. With the buttons in the top bar, a screen that has no top
 * bar (onboarding, the startup screen, the full music player) keeps the title bar, so the window
 * can still be moved and closed. macOS draws its own.
 */
export function showsTitleBar(place: WindowButtonsPlace, screenHasTopBar: boolean, isMac = IS_MACOS_RUNTIME): boolean {
  if (isMac) return false;
  if (place === "titlebar") return true;
  if (place === "none") return false;
  return !screenHasTopBar;
}

export const titleBarHeight = (shown: boolean): number => (shown ? APP_TITLEBAR_HEIGHT : 0);

export function useWindowButtonsPlace(): WindowButtonsPlace {
  return useAppSettingsStore((state) => readWindowButtonsPlace(state.values[SETTINGS.WINDOW_BUTTONS]));
}
