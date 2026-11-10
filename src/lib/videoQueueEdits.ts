import type { VideoSummary } from "../types/video";

/** The queue with `video` right after the current one; if already queued further on or back, it moves. */
export function queueWithNext(
  queue: VideoSummary[],
  currentIndex: number,
  video: VideoSummary,
): { queue: VideoSummary[]; currentIndex: number } {
  const existing = queue.findIndex((item) => item.id === video.id);
  const without = existing < 0 ? queue : queue.filter((_, index) => index !== existing);
  const index = existing >= 0 && existing < currentIndex ? currentIndex - 1 : currentIndex;
  return { queue: [...without.slice(0, index + 1), video, ...without.slice(index + 1)], currentIndex: index };
}
