import type { MusicStreamInfo, SongItem } from "../../types/music";

/** How far past the listed length a reported one has to be before it is taken as wrong. */
const OVERREPORT_RATIO = 1.25;

/**
 * The length a song really plays for. WebKit on macOS reports YouTube's fragmented MP4 (AAC)
 * audio at twice its length, though the file's own header has it right, so the element plays the
 * song and then runs on in silence. A length well past the one YouTube lists is that bug, and the
 * listed one wins; otherwise the element knows best, and it is 0 while neither is known.
 */
export function playableLength(reported: number, listed: number | null): number {
  const known = listed !== null && listed > 0 ? listed : 0;
  if (!Number.isFinite(reported) || reported <= 0) return known;
  return known > 0 && reported > known * OVERREPORT_RATIO ? known : reported;
}

/** Whether `position` is past the end of a song whose element reports more than it holds. */
export function pastListedEnd(position: number, reported: number, listed: number | null): boolean {
  const length = playableLength(reported, listed);
  return length > 0 && length < reported && position >= length;
}

/** A stream's listed length in seconds: YouTube's for that file, else the song's own. */
export function listedSeconds(
  info: Pick<MusicStreamInfo, "approxDurationMs">,
  track: Pick<SongItem, "duration">,
): number | null {
  if (info.approxDurationMs) return info.approxDurationMs / 1000;
  return track.duration ?? null;
}
