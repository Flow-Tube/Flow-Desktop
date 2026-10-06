import type { SongItem } from "../types/music";
import type { MusicAudioQuality } from "./api/music";
import { musicAudioEngine } from "./audio/musicAudioEngine";
import { resolveMusicStream } from "./musicStreamResolution";
import { findDownloadedRecord } from "./useDownloads";
import { recordPlayerEvent } from "./playerDiagnostics";

/**
 * How long before a track ends the next one starts buffering on the standby
 * element. Long enough to get a song's first seconds on a slow link, short
 * enough that a skip rarely wastes the download.
 */
export const PRELOAD_LEAD_SECONDS = 30;

let preloading: string | null = null;

/**
 * Buffer `track` on the standby element so it can take over the instant the
 * current one ends. `stillUpcoming` is asked again after the network wait,
 * because the queue may have changed while the link was resolving.
 *
 * Downloaded tracks are left alone: they load from disk at once, and their
 * saved artwork and lyrics are applied by the normal load path.
 */
export async function preloadTrack(
  track: SongItem,
  quality: MusicAudioQuality,
  stillUpcoming: (videoId: string) => boolean,
): Promise<void> {
  const videoId = track.videoId ?? track.id;
  if (preloading === videoId || musicAudioEngine.hasPreloaded(videoId)) return;
  if (findDownloadedRecord(videoId, "audio")) return;

  preloading = videoId;
  recordPlayerEvent(`music preload start: ${videoId}`);
  try {
    const info = await resolveMusicStream(videoId, quality);
    if (stillUpcoming(videoId)) musicAudioEngine.preload(videoId, info.audioUrl, info.loudnessDb);
  } catch {
    // Speculative: if it fails, the track resolves again when it is played.
  } finally {
    if (preloading === videoId) preloading = null;
  }
}
