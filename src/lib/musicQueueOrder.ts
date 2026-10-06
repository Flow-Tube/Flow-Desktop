import type { SongItem } from "../types/music";

export type QueueRepeatMode = "none" | "one" | "all";

export interface QueuePosition {
  queue: SongItem[];
  currentIndex: number;
  isShuffle: boolean;
  repeatMode: QueueRepeatMode;
}

const pickRandomIndex = (length: number, exclude: number): number => {
  if (length <= 1) return 0;
  let next = exclude;
  while (next === exclude) next = Math.floor(Math.random() * length);
  return next;
};

// Shuffle's next pick, made once per track so the track warmed ahead of time is
// the one that actually plays.
let shuffleNext: { from: number; to: number } | null = null;

/**
 * The queue index that plays after the current one, or -1 when none does.
 * Repeat-one replays what is already loaded, so it has no next track.
 */
export function upcomingIndex({ queue, currentIndex, isShuffle, repeatMode }: QueuePosition): number {
  if (queue.length === 0 || currentIndex < 0 || repeatMode === "one") return -1;
  if (isShuffle && queue.length > 1) {
    if (!shuffleNext || shuffleNext.from !== currentIndex || shuffleNext.to >= queue.length) {
      shuffleNext = { from: currentIndex, to: pickRandomIndex(queue.length, currentIndex) };
    }
    return shuffleNext.to;
  }
  const nextIndex = currentIndex + 1;
  if (nextIndex < queue.length) return nextIndex;
  return repeatMode === "all" ? 0 : -1;
}

/** Forget shuffle's pending pick, for when the queue is torn down. */
export function resetQueueOrder(): void {
  shuffleNext = null;
}
