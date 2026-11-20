import { SETTINGS } from "../settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";

/** One switch for the trackpad gestures beyond scrolling: swipe to go back, swipe to scrub, pinch the feed. */
export function useTrackpadGesturesEnabled(): boolean {
  return useAppSettingsStore((state) => state.values[SETTINGS.TRACKPAD_GESTURES_ENABLED] !== "false");
}
