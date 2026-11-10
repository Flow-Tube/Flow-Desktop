import { usePlayerStore, type PlaylistContext } from "../store/usePlayerStore";
import { getPlaylistDetails } from "./api/youtube";
import { appendUniqueVideos, loadRemainingPlaylistVideos } from "./playlistPages";

/**
 * Makes the linked playlist the queue around the video the link names. The video plays straight
 * away from its first page, and later pages join the queue as they arrive unless another queue
 * has replaced this one by then. If the list can't be read, the video simply plays alone.
 */
export async function playLinkedPlaylist(playlistId: string, videoId: string): Promise<void> {
  let details;
  try {
    details = await getPlaylistDetails(playlistId);
  } catch {
    return;
  }
  const player = usePlayerStore.getState();
  // The user may have moved on while the list loaded; their choice stands.
  if (player.currentVideo && player.currentVideo.id !== videoId) return;
  const videos = details.videos ?? [];
  if (videos.length === 0) return;

  const context: PlaylistContext = { id: details.id || playlistId, title: details.title, editable: false, reorderable: false };
  const onFirstPage = videos.findIndex((video) => video.id === videoId);
  if (onFirstPage >= 0) {
    player.setQueue(videos, onFirstPage, context);
  } else {
    // Further down a long list: it stays first, with the list after it.
    const current = player.currentVideo;
    if (current) player.setQueue([current, ...videos], 0, context);
  }

  const all = await loadRemainingPlaylistVideos(playlistId, videos, details.nextPageToken).catch(() => videos);
  usePlayerStore.setState((state) =>
    state.playlistContext?.id === context.id ? { queue: appendUniqueVideos(state.queue, all) } : state,
  );
}
