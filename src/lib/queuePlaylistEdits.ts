import {
  WATCH_LATER_PLAYLIST_ID,
  getStoredPlaylistById,
  removeVideoFromStoredPlaylist,
  restoreStoredPlaylistTrack,
} from "./playlistLibrary";
import { showSaveFailedToast, showSaveToast, type SaveDestination } from "./saveToast";
import { usePlayerStore, type PlaylistContext } from "../store/usePlayerStore";
import type { VideoSummary } from "../types/video";

const destinationOf = (context: PlaylistContext): SaveDestination =>
  context.id === WATCH_LATER_PLAYLIST_ID
    ? { kind: "watchLater" }
    : { kind: "playlist", id: context.id, name: context.title };

/**
 * Takes a queue removal through to the playlist the queue was started from. The row's
 * button looks the same as a queue-only removal, so the toast says so and offers Undo,
 * which puts the video back in both places.
 */
export async function removeVideoFromQueuePlaylist(
  context: PlaylistContext,
  video: VideoSummary,
  queueIndex: number,
): Promise<void> {
  const destination = destinationOf(context);
  const item = { title: video.title, image: video.thumbnailUrl, shape: "landscape" as const };
  try {
    const tracks = (await getStoredPlaylistById(context.id))?.tracks ?? [];
    const index = tracks.findIndex((track) => track.id === video.id);
    const track = tracks[index];
    if (!track) return;
    const afterId = tracks[index - 1]?.id ?? null;

    await removeVideoFromStoredPlaylist(context.id, video.id);
    showSaveToast({
      destination,
      item,
      removed: true,
      undo: async () => {
        await restoreStoredPlaylistTrack(context.id, track, afterId);
        const player = usePlayerStore.getState();
        if (player.playlistContext?.id === context.id) player.restoreQueueItem(video, queueIndex);
      },
    });
  } catch (error) {
    console.error("Failed to remove video from stored playlist", error);
    showSaveFailedToast({
      destination,
      item,
      removed: true,
      retry: () => removeVideoFromQueuePlaylist(context, video, queueIndex),
    });
  }
}
