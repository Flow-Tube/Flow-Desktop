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
 * repeat-one, not between consecutive album tracks when `keepAlbums` is on, and never on a track
 * too short to hold two fades.
 */
export function crossfadeTarget(s: CrossfadeQueue, seconds: number, keepAlbums = true): number {
  if (seconds <= 0 || !s.isPlaying || s.loadingStreamId !== null || s.repeatMode === "one") return -1;
  if (!(s.duration > seconds * 2)) return -1;
  const remaining = s.duration - s.progress;
  if (remaining > seconds || remaining <= 0.25) return -1;
  const index = upcomingIndex(s);
  const next = s.queue[index];
  if (!next || index === s.currentIndex || (keepAlbums && playsInAlbumOrder(s, next))) return -1;
  return index;
}

/** A song skipped sooner than this was barely heard, so there is nothing to fade out. */
const MIN_SKIP_PLAYED_SECONDS = 1;
/** A fade shorter than this is not worth it; closer to the end, the song just stops. */
const MIN_FADE_SECONDS = 2;

/** How long the song you skip away from fades under the next one, or 0 for a plain cut. */
export function skipFadeLength(seconds: number, progress: number, duration: number): number {
  if (seconds <= 0 || progress < MIN_SKIP_PLAYED_SECONDS) return 0;
  const length = Math.min(seconds, duration - progress);
  return length >= MIN_FADE_SECONDS ? length : 0;
}
