export type MediaBufferingSignal = "waiting" | "stalled";

type MediaBufferingSnapshot = {
  signal: MediaBufferingSignal;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  readyState: number;
};

const HAVE_FUTURE_DATA = 3;
const MIN_PROGRESS_SECONDS = 0.01;

export function shouldEnterMediaBuffering({
  paused,
  ended,
  seeking,
  readyState,
}: MediaBufferingSnapshot): boolean {
  if (paused || ended || seeking) return false;

  // Media events are only hints. `stalled` may describe an idle network fetch,
  // and a queued `waiting` may arrive after playback has already recovered.
  return readyState < HAVE_FUTURE_DATA;
}

export function hasMediaPlaybackProgressed(
  bufferingStartedAt: number | null,
  currentTime: number,
): boolean {
  return (
    bufferingStartedAt !== null
    && Number.isFinite(currentTime)
    && currentTime - bufferingStartedAt > MIN_PROGRESS_SECONDS
  );
}
