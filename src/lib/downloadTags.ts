import type { DownloadTagsInput } from "./api/downloads";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

/** What a video card already knows; the backend fills the date, description and
 *  chapters from the video's details. */
export function videoDownloadTags(video: VideoSummary): DownloadTagsInput {
  return {
    channelName: video.channelName || undefined,
    channelId: video.channelId ?? undefined,
    viewCount: video.viewCount ?? undefined,
  };
}

export interface TrackPosition {
  number: number;
  total: number;
}

/** A song's credits, album and, when it comes from an album, its place in it. */
export function trackDownloadTags(
  track: SongItem,
  position?: TrackPosition,
  albumArtist?: string,
  releaseYear?: number | null,
): DownloadTagsInput {
  const artists = track.artists.map((artist) => artist.name.trim()).filter(Boolean);
  return {
    artists,
    channelId: track.artists.find((artist) => artist.id)?.id ?? undefined,
    album: track.album?.name || undefined,
    albumId: track.album?.id || undefined,
    albumArtist: albumArtist || undefined,
    trackNumber: position?.number,
    trackTotal: position?.total,
    playlistId: track.playlistId ?? undefined,
    releaseDate: releaseYear ? String(releaseYear) : undefined,
  };
}
