import type { SongItem } from "../types/music";

export type QueueRepeatMode = "none" | "one" | "all";

export interface QueuePosition {
  queue: SongItem[];
  currentIndex: number;
  repeatMode: QueueRepeatMode;
}

/**
 * The queue index that plays after the current one, or -1 when none does.
 * Shuffle rearranges the queue itself, so the next track is always the
 * following entry. Repeat-one, and repeat-all over a single song, replay what
 * is already loaded, so they have no next track to warm.
 */
export function upcomingIndex({ queue, currentIndex, repeatMode }: QueuePosition): number {
  if (queue.length === 0 || currentIndex < 0 || repeatMode === "one") return -1;
  const nextIndex = currentIndex + 1;
  if (nextIndex < queue.length) return nextIndex;
  return repeatMode === "all" && currentIndex !== 0 ? 0 : -1;
}
