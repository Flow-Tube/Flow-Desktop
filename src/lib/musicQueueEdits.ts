import type { SongItem } from "../types/music";

/**
 * The play order and, while shuffle is on, the order it was shuffled from.
 * Every edit lands in both, so turning shuffle off restores the original order
 * with the user's additions and removals intact.
 */
export interface QueueLists {
  queue: SongItem[];
  unshuffledQueue: SongItem[] | null;
  currentIndex: number;
}

const idOf = (track: SongItem): string => track.videoId ?? track.id;

/** Whether `track` is already waiting to play (played songs may be queued again). */
export function isUpcoming({ queue, currentIndex }: QueueLists, track: SongItem): boolean {
  const id = idOf(track);
  return queue.some((t, i) => i > currentIndex && idOf(t) === id);
}

export function appendTracks(lists: QueueLists, tracks: SongItem[]): QueueLists {
  if (tracks.length === 0) return lists;
  return {
    ...lists,
    queue: [...lists.queue, ...tracks],
    unshuffledQueue: lists.unshuffledQueue ? [...lists.unshuffledQueue, ...tracks] : null,
  };
}

/** Puts `track` right after the current one, moving it there if it was already waiting. */
export function insertNext(lists: QueueLists, track: SongItem): QueueLists {
  const id = idOf(track);
  const { currentIndex } = lists;
  const current = lists.queue[currentIndex];
  const waiting = lists.queue.findIndex((t, i) => i > currentIndex && idOf(t) === id);
  const entry = lists.queue[waiting] ?? track;
  const queue = lists.queue.filter((_, i) => i !== waiting);
  queue.splice(currentIndex + 1, 0, entry);

  let unshuffledQueue = lists.unshuffledQueue;
  if (unshuffledQueue) {
    unshuffledQueue = unshuffledQueue.filter((t) => t !== entry);
    const at = current ? unshuffledQueue.indexOf(current) : -1;
    unshuffledQueue.splice(at >= 0 ? at + 1 : unshuffledQueue.length, 0, entry);
  }
  return { queue, unshuffledQueue, currentIndex };
}

export function removeAt(lists: QueueLists, index: number): QueueLists {
  const entry = lists.queue[index];
  if (!entry) return lists;
  return {
    queue: lists.queue.filter((_, i) => i !== index),
    unshuffledQueue: lists.unshuffledQueue?.filter((t) => t !== entry) ?? null,
    currentIndex: index < lists.currentIndex ? lists.currentIndex - 1 : lists.currentIndex,
  };
}

/** Drops every entry `shouldRemove` matches except the one playing. */
export function removeWhere(lists: QueueLists, shouldRemove: (track: SongItem) => boolean): QueueLists {
  const current = lists.queue[lists.currentIndex];
  const keep = (track: SongItem) => track === current || !shouldRemove(track);
  const queue = lists.queue.filter(keep);
  if (queue.length === lists.queue.length) return lists;
  return {
    queue,
    unshuffledQueue: lists.unshuffledQueue?.filter(keep) ?? null,
    currentIndex: current ? queue.indexOf(current) : Math.min(lists.currentIndex, queue.length - 1),
  };
}
