import type { SongItem } from "../types/music";

type Random = () => number;

/** An unbiased Fisher-Yates shuffle into a new array. */
export function fisherYates<T>(items: readonly T[], random: Random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = out[i] as T;
    out[i] = out[j] as T;
    out[j] = swap;
  }
  return out;
}

/**
 * Shuffle turned on mid-queue: what already played stays behind the current
 * track, so Previous still walks back through it, and only the songs still to
 * come are rearranged.
 */
export function shuffleUpcoming(queue: SongItem[], currentIndex: number, random: Random = Math.random): SongItem[] {
  if (currentIndex < 0) return fisherYates(queue, random);
  return [...queue.slice(0, currentIndex + 1), ...fisherYates(queue.slice(currentIndex + 1), random)];
}

/**
 * A fresh queue started under shuffle: the chosen track plays first and every
 * other one follows in random order, so each plays exactly once.
 */
export function shuffleFrom(queue: SongItem[], startIndex: number, random: Random = Math.random): SongItem[] {
  const start = queue[startIndex];
  if (!start) return fisherYates(queue, random);
  return [start, ...fisherYates(queue.filter((_, i) => i !== startIndex), random)];
}

/**
 * Shuffle turned off: the original order comes back, with whatever the user
 * removed while shuffled left out and whatever was added kept at the end.
 * Entries are matched by reference, so a song queued twice stays twice.
 */
export function restoreOriginalOrder(
  original: SongItem[],
  shuffled: SongItem[],
  current: SongItem | null,
): { queue: SongItem[]; currentIndex: number } {
  const present = new Set(shuffled);
  const kept = original.filter((track) => present.has(track));
  const keptSet = new Set(kept);
  const queue = [...kept, ...shuffled.filter((track) => !keptSet.has(track))];
  return { queue, currentIndex: current ? queue.indexOf(current) : -1 };
}
