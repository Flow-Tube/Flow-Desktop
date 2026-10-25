import type { SongItem } from "../../types/music";
import { upcomingIndex, type QueueRepeatMode } from "../musicQueueOrder";

export interface CrossfadeQueue {
  queue: SongItem[];
  currentIndex: number;
  currentTrack: SongItem | null;
  isShuffle: boolean;
  repeatMode: QueueRepeatMode;
  isPlaying: boolean;
  loadingStreamId: string | null;
  progress: number;
  duration: number;
}

/**
 * Tracks in album order are often meant to run into each other (a live set, a concept album, a
 * continuous mix), so they keep their gapless join instead of being faded across.
 */
const playsInAlbumOrder = (s: CrossfadeQueue, next: SongItem): boolean =>
  !s.isShuffle && !!s.currentTrack?.album?.id && s.currentTrack.album.id === next.album?.id;

/**
 * The queue index to crossfade into now, or -1. Fades start `seconds` before the end, never on
 * repeat-one, never between consecutive album tracks, and never on a track too short to hold
 * two fades.
 */
export function crossfadeTarget(s: CrossfadeQueue, seconds: number): number {
  if (seconds <= 0 || !s.isPlaying || s.loadingStreamId !== null || s.repeatMode === "one") return -1;
  if (!(s.duration > seconds * 2)) return -1;
  const remaining = s.duration - s.progress;
  if (remaining > seconds || remaining <= 0.25) return -1;
  const index = upcomingIndex(s);
  const next = s.queue[index];
  if (!next || index === s.currentIndex || playsInAlbumOrder(s, next)) return -1;
  return index;
}
