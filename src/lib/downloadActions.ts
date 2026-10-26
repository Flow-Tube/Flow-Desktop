import {
  startDownload,
  type DownloadableFormat,
  type DownloadStarted,
  type StartDownloadRequest,
  type VideoSelection,
} from "./api/downloads";
import type { MusicAudioQuality } from "./api/music";
import { SETTINGS } from "./settings/schema";
import { saveLyricsWithDownload } from "./lyrics/downloadLyrics";
import { trackDownloadTags, videoDownloadTags, type TrackPosition } from "./downloadTags";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

type SettingsValues = Record<string, string>;

/** "Auto" and anything unreadable mean 1080p, not the largest file on offer. */
export const AUTO_DOWNLOAD_HEIGHT = 1080;

export function preferredDownloadHeight(values: SettingsValues): number {
  const height = Number.parseInt(values[SETTINGS.DEFAULT_DOWNLOAD_QUALITY] ?? "", 10);
  return Number.isFinite(height) && height > 0 ? height : AUTO_DOWNLOAD_HEIGHT;
}

/** Songs are saved as AAC so they can carry tags: the best AAC on offer, unless the
 *  user asked for low quality. */
export function musicDownloadQuality(values: SettingsValues): MusicAudioQuality {
  return values[SETTINGS.MUSIC_AUDIO_QUALITY] === "Low" ? "Low" : "High";
}

export interface DownloadOverrides {
  destinationDirectory?: string;
  collectionDbId?: number;
  /** The song's place in the album being downloaded. */
  position?: TrackPosition;
  albumArtist?: string;
  releaseYear?: number | null;
  /** The file name the user typed, which also becomes the title tag. */
  title?: string;
}

export function videoSelectionFor(format: DownloadableFormat): VideoSelection {
  return {
    formatId: format.formatId,
    height: format.height,
    fps: format.fps,
    videoCodec: format.videoCodec,
    container: format.container,
  };
}

function transferOptions(values: SettingsValues) {
  return {
    parallel: values[SETTINGS.PARALLEL_DOWNLOAD_ENABLED] !== "false",
    threads: Number(values[SETTINGS.DOWNLOAD_THREADS] ?? 3),
  };
}

export function videoDownloadRequest(
  video: VideoSummary,
  values: SettingsValues,
  selection: VideoSelection,
  qualityLabel: string,
  overrides: DownloadOverrides = {},
): StartDownloadRequest {
  return {
    videoId: video.id,
    video: selection,
    title: overrides.title?.trim() || video.title,
    mediaKind: "video",
    qualityLabel,
    destinationDirectory: overrides.destinationDirectory ?? (values[SETTINGS.DOWNLOAD_LOCATION] || undefined),
    ...transferOptions(values),
    thumbnailUrl: video.thumbnailUrl ?? undefined,
    author: video.channelName || undefined,
    durationSeconds: video.durationSeconds ?? undefined,
    collectionDbId: overrides.collectionDbId,
    tags: videoDownloadTags(video),
  };
}

/** Starts a video at the default quality without asking which formats exist; the
 *  backend picks the closest one when the download runs. */
export function startVideoDownload(
  video: VideoSummary,
  values: SettingsValues,
  overrides: DownloadOverrides = {},
): Promise<DownloadStarted> {
  const height = preferredDownloadHeight(values);
  const selection: VideoSelection = {
    formatId: "",
    height,
    fps: null,
    videoCodec: "",
    container: "mp4",
  };
  return startDownload(videoDownloadRequest(video, values, selection, `${height}p`, overrides));
}

export function musicDownloadRequest(
  track: SongItem,
  values: SettingsValues,
  qualityLabel: string,
  overrides: DownloadOverrides = {},
): StartDownloadRequest {
  return {
    videoId: track.videoId ?? track.id,
    music: { quality: musicDownloadQuality(values), preferAac: true },
    title: overrides.title?.trim() || track.title,
    mediaKind: "music",
    qualityLabel,
    destinationDirectory:
      overrides.destinationDirectory ?? (values[SETTINGS.MUSIC_DOWNLOAD_LOCATION] || undefined),
    ...transferOptions(values),
    thumbnailUrl: track.thumbnail || undefined,
    author: track.artists.map((artist) => artist.name).filter(Boolean).join(", ") || undefined,
    durationSeconds: track.duration ?? undefined,
    collectionDbId: overrides.collectionDbId,
    tags: trackDownloadTags(track, overrides.position, overrides.albumArtist, overrides.releaseYear),
  };
}

/** Starts a song; its stream is resolved by the backend when the download runs. */
export async function startMusicDownload(
  track: SongItem,
  values: SettingsValues,
  overrides: DownloadOverrides = {},
): Promise<DownloadStarted> {
  const started = await startDownload(musicDownloadRequest(track, values, "AAC", overrides));
  saveLyricsWithDownload(track, started.id);
  return started;
}

