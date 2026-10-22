import { getPlaylistDetails } from "./api/youtube";
import type { VideoSummary } from "../types/video";

/** Pages a playlist reads before stopping, so a huge or looping playlist ends. */
export const PLAYLIST_PAGE_GUARD = 30;

/** `current` with the videos of `next` it does not already hold, in order. */
export function appendUniqueVideos(current: VideoSummary[], next: VideoSummary[]): VideoSummary[] {
  const seen = new Set(current.map((video) => video.id));
  const added = next.filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
  return added.length > 0 ? [...current, ...added] : current;
}

/**
 * `first` plus every later page of the playlist, starting from `pageToken`.
 *
 * Later pages carry videos only; their title and owner are placeholders, so callers
 * keep the first page's metadata.
 */
export async function loadRemainingPlaylistVideos(
  playlistId: string,
  first: VideoSummary[],
  pageToken: string | null | undefined,
): Promise<VideoSummary[]> {
  let videos = first;
  let token = pageToken;
  for (let page = 1; token && page < PLAYLIST_PAGE_GUARD; page += 1) {
    const details = await getPlaylistDetails(playlistId, token);
    videos = appendUniqueVideos(videos, details.videos ?? []);
    token = details.nextPageToken;
  }
  return videos;
}
