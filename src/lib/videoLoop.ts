import type { RepeatMode } from "../store/usePlayerStore";

/**
 * What the player's Loop does when pressed. It repeats the video until it is turned off or the
 * player closes, as Flow for Android's player loop does, and it is the queue's "Repeat one".
 * "Loop every video" in Settings is a separate saved default: while it is the reason a video
 * loops, the player's Loop can't stop it, so "settings" asks the caller to say where to.
 */
export function toggledLoop(repeatMode: RepeatMode, loopsEveryVideo: boolean): RepeatMode | "settings" {
  if (repeatMode === "one") return "none";
  return loopsEveryVideo ? "settings" : "one";
}
