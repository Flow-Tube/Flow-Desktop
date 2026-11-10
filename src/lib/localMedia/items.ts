import type { SongItem } from "../../types/music";
import type { VideoSummary } from "../../types/video";
import type { LocalMediaFile } from "../api/localMedia";
import { folderNameOf } from "./filters";

/** The file as the video player's item: its artist tag is the channel, or its folder without one. */
export function localFileToVideo(file: LocalMediaFile): VideoSummary {
  return {
    id: file.id,
    title: file.title,
    channelName: file.artist || folderNameOf(file.folderPath),
    durationSeconds: Math.round(file.durationMs / 1000),
  };
}

/** The file as the music player's track; a song without artist tags is credited to its folder. */
export function localFileToSong(file: LocalMediaFile): SongItem {
  return {
    id: file.id,
    videoId: file.id,
    title: file.title,
    artists: [{ name: file.artist || folderNameOf(file.folderPath), id: null }],
    album: null,
    duration: Math.round(file.durationMs / 1000),
    musicVideoType: null,
    thumbnail: "",
    explicit: false,
    playlistId: null,
    params: null,
  };
}
