/** Longest a video can be and still count as a Short. */
export const SHORT_MAX_SECONDS = 60;

/** A Short only when its length is known: an unknown length is not a guess at one. */
export function isKnownShort(durationSeconds?: number | null): boolean {
  return durationSeconds != null && durationSeconds > 0 && durationSeconds <= SHORT_MAX_SECONDS;
}
