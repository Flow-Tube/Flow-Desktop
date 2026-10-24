import { addWatchRecord } from "./api/db";
import { recordMusicInteraction } from "./api/music";
import { shouldRecordWatchHistory } from "./deepFlow";
import type { SongItem } from "../types/music";

const videoIdOf = (t: SongItem): string => t.videoId ?? t.id;

/**
 * Saves a listen of `listenedSeconds` actually played (not the playhead) to the
 * shared history, as a music row so it never feeds the video brain, and to
 * MusicBrain.
 */
export async function recordSongHistory(
  track: SongItem,
  listenedSeconds: number,
  totalSeconds: number,
): Promise<void> {
  const id = videoIdOf(track);
  const channelName = track.artists.map((a) => a.name).filter(Boolean).join(", ");
  const total = Math.floor(totalSeconds || track.duration || 0);
  const watched = Math.floor(Math.max(0, listenedSeconds));

  if (shouldRecordWatchHistory()) {
    try {
      await addWatchRecord({
        videoId: id,
        title: track.title,
        channelName,
        watchDate: new Date().toISOString(),
        watchDurationSeconds: watched,
        totalDurationSeconds: total,
        isMusic: true,
      });
    } catch (e) {
      console.warn("Failed to save song to watch history", e);
    }
  }

  const percentWatched = total > 0 ? Math.min(1, Math.max(0, listenedSeconds / total)) : 0;
  try {
    await recordMusicInteraction({
      trackId: id,
      artistId: track.artists[0]?.id ?? null,
      artistName: track.artists[0]?.name ?? channelName,
      title: track.title,
      thumbnail: track.thumbnail ?? null,
      percentPlayed: percentWatched,
    });
  } catch (e) {
    console.warn("Failed to log song interaction to music brain", e);
  }
}
