const MIN_RESUME_SECONDS = 0.5;
const FINISHED_REMAINING_SECONDS = 1.5;
const FINISHED_FRACTION = 0.98;
/** With no duration to compare against, a position this far in is treated as a video finished long ago. */
const UNKNOWN_DURATION_LIMIT_SECONDS = 4 * 60 * 60;

/** Whether a saved position counts as having finished the video, so it starts over. Same rule as Android. */
export function isFinishedPosition(positionSeconds: number, durationSeconds: number): boolean {
  if (positionSeconds <= 0) return false;
  if (durationSeconds > 0) {
    return (
      durationSeconds - positionSeconds <= FINISHED_REMAINING_SECONDS ||
      positionSeconds >= durationSeconds * FINISHED_FRACTION
    );
  }
  return positionSeconds > UNKNOWN_DURATION_LIMIT_SECONDS;
}

/** Where a video with this saved position starts. */
export function resumeStartSeconds(positionSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= MIN_RESUME_SECONDS) return 0;
  return isFinishedPosition(positionSeconds, durationSeconds) ? 0 : positionSeconds;
}
