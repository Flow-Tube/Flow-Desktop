import type { VideoFit } from "../../store/usePlayerStore";

export interface AmbientConditions {
  enabled: boolean;
  glow: boolean;
  theater: boolean;
  videoFit: VideoFit;
  /** The pop-out, the mini player, fullscreen and a failed video have no page around the picture to light. */
  blocked: boolean;
}

/**
 * Whether the player draws ambient light. The glow around the player shows in every resize
 * mode. Without it, ambient only fills theater's side bars, and only Fit leaves any: Fill and
 * Zoom cover the whole player, as on Flow for Android.
 */
export function ambientShown({ enabled, glow, theater, videoFit, blocked }: AmbientConditions): boolean {
  if (!enabled || blocked) return false;
  return glow || (theater && videoFit === "fit");
}
