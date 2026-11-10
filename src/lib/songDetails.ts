import { getString, type StringKey } from "./i18n/index";
import type { VideoDetails } from "../types/video";
import { artistsText, formatTime } from "./musicFormat";
import type { SongItem } from "../types/music";

export interface SongDetailLine {
  label: string;
  value: string;
}

/** What is known about a song: what the page already has, filled in by the video's own details once they come. */
export function songDetailLines(song: SongItem, details: VideoDetails | null): SongDetailLine[] {
  const seconds = details?.durationSeconds ?? song.duration;
  const lines: Array<[StringKey, string | null | undefined]> = [
    ["music_details_title", details?.title ?? song.title],
    ["music_details_artist", artistsText(song.artists) || details?.channelName],
    ["music_details_album", song.album?.name],
    ["music_details_views", details?.viewCountText ?? song.viewsText],
    ["music_details_likes", details?.likeCountText],
    ["music_details_subscribers", details?.subscriberCountText],
    ["music_details_duration", seconds ? formatTime(seconds) : null],
    ["music_details_uploaded", details?.publishedText],
  ];
  return lines.flatMap(([key, value]) => (value?.trim() ? [{ label: getString(key), value: value.trim() }] : []));
}
