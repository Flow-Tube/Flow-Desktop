/**
 * Buffering-spinner policy for the Watch player.
 *
 * `waiting` and `stalled` are hints about the fetch, not statements about
 * playback. `stalled` fires whenever no bytes have arrived for a few seconds,
 * which a comfortably buffered element does routinely, and a queued `waiting`
 * can still be delivered after the element has already resumed. Acting on
 * either one directly paints a spinner over a video that is playing normally,
 * and it stays there: the `playing` event that would clear it never fires,
 * because playback never actually stopped.
 *
 * The element's own `readyState` is the only signal that says whether the next
 * frame is decodable, so it decides whether playback is starved; the event only
 * decides when to look.
 *
 * Seeking is deliberately *not* treated as a reason to stay quiet. Seeking into
 * a range that has not been downloaded is exactly when the spinner has to
 * appear, and it is the slowest case on a cold connection. Buffering state left
 * over from before the seek is cleared by the `seeking` handler instead.
 */

/** `HTMLMediaElement.HAVE_FUTURE_DATA` — the next frame is decodable. */
const HAVE_FUTURE_DATA = 3;

/** Ignore sub-frame clock jitter when deciding that playback has recovered. */
const MIN_PROGRESS_SECONDS = 0.01;

export type MediaBufferingSnapshot = {
  paused: boolean;
  ended: boolean;
  readyState: number;
};

/** Whether a `waiting`/`stalled` hint describes real playback starvation. */
export function shouldEnterMediaBuffering({
  paused,
  ended,
  readyState,
}: MediaBufferingSnapshot): boolean {
  if (paused || ended) return false;
  return readyState < HAVE_FUTURE_DATA;
}

/**
 * Whether the clock has moved past where it stood when buffering began. The
 * element is decoding again even if no `playing` event was ever delivered.
 */
export function hasMediaPlaybackProgressed(
  bufferingStartedAt: number | null,
  currentTime: number,
): boolean {
  if (bufferingStartedAt === null) return false;
  if (!Number.isFinite(bufferingStartedAt) || !Number.isFinite(currentTime)) return false;
  return currentTime - bufferingStartedAt > MIN_PROGRESS_SECONDS;
}
