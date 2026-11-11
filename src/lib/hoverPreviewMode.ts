import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { SETTINGS } from "./settings/schema";

export type HoverPreviewMode = "off" | "frames" | "video";

/** The modes Settings offers, in order. */
export const HOVER_PREVIEW_MODES: readonly HoverPreviewMode[] = ["off", "frames", "video"];

export const HOVER_PREVIEW_MODE_LABELS = {
  off: "settings_hover_previews_off",
  frames: "settings_hover_previews_frames",
  video: "settings_hover_previews_video",
} as const satisfies Record<HoverPreviewMode, string>;

// The on/off switch this replaced, on main for a day before beta4: an "on" there means Frames.
const REPLACED_SWITCH = "video_hover_previews_enabled";

/** The hover preview kind in force. Only one runs at a time, and there is none until chosen. */
export function hoverPreviewMode(values: Partial<Record<string, string>>): HoverPreviewMode {
  const chosen = values[SETTINGS.VIDEO_HOVER_PREVIEW_MODE];
  if (chosen === "frames" || chosen === "video" || chosen === "off") return chosen;
  return values[REPLACED_SWITCH] === "true" ? "frames" : "off";
}

export function useHoverPreviewMode(): HoverPreviewMode {
  return useAppSettingsStore((state) => hoverPreviewMode(state.values));
}
