export type MutePauseAction = "pause" | "resume" | "none";

/**
 * Pause music when Flow is muted and resume it when sound comes back, but only music this pause
 * stopped: a song the listener paused by hand stays paused when they turn the volume up.
 */
export function mutePauseAction(silent: boolean, enabled: boolean, isPlaying: boolean, pausedForMute: boolean): MutePauseAction {
  if (silent && enabled && isPlaying) return "pause";
  if (!silent && pausedForMute) return "resume";
  return "none";
}
