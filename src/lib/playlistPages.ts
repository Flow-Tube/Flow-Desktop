import { getMixPlaylist, getPlaylistDetails } from "./api/youtube";
import { isMix } from "./mixPlaylist";
import type { PlaylistDetailsResponse, VideoSummary } from "../types/video";

/**
 * A playlist's first page. A Mix is read from its watch queue, around `videoId` when its id
 * names no video, since YouTube refuses to browse one; it has no further pages.
 */
export function firstPlaylistPage(playlistId: string, videoId?: string | null): Promise<PlaylistDetailsResponse> {
  return isMix(playlistId) ? getMixPlaylist(playlistId, videoId) : getPlaylistDetails(playlistId);
}

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
 * `first` plus every later page of the playlist, starting from `pageToken`. `finished` is false
 * when the page guard stopped the walk before the playlist ended.
 *
 * Later pages carry videos only; their title and owner are placeholders, so callers
 * keep the first page's metadata.
 */
export async function walkRemainingPlaylistPages(
  playlistId: string,
  first: VideoSummary[],
  pageToken: string | null | undefined,
): Promise<{ videos: VideoSummary[]; finished: boolean }> {
  let videos = first;
  let token = pageToken;
  for (let page = 1; token && page < PLAYLIST_PAGE_GUARD; page += 1) {
    const details = await getPlaylistDetails(playlistId, token);
    videos = appendUniqueVideos(videos, details.videos ?? []);
    token = details.nextPageToken;
  }
  return { videos, finished: !token };
}

export async function loadRemainingPlaylistVideos(
  playlistId: string,
  first: VideoSummary[],
  pageToken: string | null | undefined,
): Promise<VideoSummary[]> {
  return (await walkRemainingPlaylistPages(playlistId, first, pageToken)).videos;
}
