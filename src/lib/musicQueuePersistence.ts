import type { SongItem } from "../types/music";

/**
 * The music queue as it is saved between launches, and the rules for bringing
 * it back, ported from Android's QueuePersistence and RestoredMusicQueue.
 */
export interface SavedMusicQueue {
  version: 1;
  queue: SongItem[];
  currentIndex: number;
  currentTrackId: string | null;
  positionSeconds: number;
  queueSource: string | null;
  /** The order shuffle restores, as indexes into `queue`; null while shuffle is off. */
  unshuffledOrder: number[] | null;
  radioQueuedIds: string[];
  radioStationActive: boolean;
}

export interface QueueSnapshot {
  queue: SongItem[];
  currentIndex: number;
  progress: number;
  queueSource: string | null;
  unshuffledQueue: SongItem[] | null;
  radioQueuedIds: string[];
  radioStationActive: boolean;
}

export interface RestoredQueue {
  queue: SongItem[];
  currentIndex: number;
  /** Where the restored song picks up; 0 starts it over. */
  resumeAt: number;
  queueSource: string | null;
  unshuffledQueue: SongItem[] | null;
  radioQueuedIds: string[];
  radioStationActive: boolean;
}

/** A song this close to its end starts over rather than playing only its last seconds. */
export const RESUME_END_MARGIN_SECONDS = 5;

const idOf = (track: SongItem): string => track.videoId ?? track.id;

export function serializeQueue(snapshot: QueueSnapshot): SavedMusicQueue {
  const { queue, unshuffledQueue } = snapshot;
  const current = queue[snapshot.currentIndex];
  const order = unshuffledQueue?.map((track) => queue.indexOf(track)).filter((index) => index >= 0) ?? null;
  return {
    version: 1,
    queue,
    currentIndex: snapshot.currentIndex,
    currentTrackId: current ? idOf(current) : null,
    positionSeconds: Math.max(0, snapshot.progress),
    queueSource: snapshot.queueSource,
    unshuffledOrder: order,
    radioQueuedIds: snapshot.radioQueuedIds,
    radioStationActive: snapshot.radioStationActive,
  };
}

const isSongLike = (value: unknown): value is SongItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SongItem).id === "string" &&
  typeof (value as SongItem).title === "string" &&
  Array.isArray((value as SongItem).artists);

/** Reads saved JSON back, or null when there is no queue worth restoring. */
export function parseSavedQueue(json: string | null): RestoredQueue | null {
  if (!json) return null;
  let saved: Partial<SavedMusicQueue>;
  try {
    saved = JSON.parse(json) as Partial<SavedMusicQueue>;
  } catch {
    return null;
  }
  if (saved.version !== 1 || !Array.isArray(saved.queue)) return null;
  const queue = saved.queue.filter(isSongLike);
  if (queue.length === 0 || queue.length !== saved.queue.length) return null;

  // The track id wins over a stale index.
  const byId = saved.currentTrackId ? queue.findIndex((t) => idOf(t) === saved.currentTrackId) : -1;
  const currentIndex = byId >= 0 ? byId : Math.min(Math.max(0, saved.currentIndex ?? 0), queue.length - 1);
  const track = queue[currentIndex];
  const duration = track?.duration ?? 0;
  const position = Math.max(0, saved.positionSeconds ?? 0);
  const resumesInside = duration <= 0 || position < duration - RESUME_END_MARGIN_SECONDS;

  const order = saved.unshuffledOrder;
  const unshuffledQueue =
    Array.isArray(order) && order.length === queue.length && new Set(order).size === queue.length
      ? order.map((index) => queue[index]).filter((t): t is SongItem => t !== undefined)
      : null;

  return {
    queue,
    currentIndex,
    resumeAt: resumesInside ? position : 0,
    queueSource: typeof saved.queueSource === "string" ? saved.queueSource : null,
    unshuffledQueue: unshuffledQueue && unshuffledQueue.length === queue.length ? unshuffledQueue : null,
    radioQueuedIds: Array.isArray(saved.radioQueuedIds) ? saved.radioQueuedIds.filter((id) => typeof id === "string") : [],
    radioStationActive: saved.radioStationActive === true,
  };
}
