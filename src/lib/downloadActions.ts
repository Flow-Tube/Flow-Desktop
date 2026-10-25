import {
  getDownloadFormats,
  startDownload,
  type DownloadStarted,
} from "./api/downloads";
import { getMusicStream } from "./api/music";
import {
  describeDownloadFormat,
  describeMusicStream,
  musicDownloadQuality,
  selectDefaultFormat,
} from "./useDownloadDialog";
import { SETTINGS } from "./settings/schema";
import { saveLyricsWithDownload } from "./lyrics/downloadLyrics";
import { trackDownloadTags, videoDownloadTags, type TrackPosition } from "./downloadTags";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

type SettingsValues = Record<string, string>;

interface DownloadOverrides {
  destinationDirectory?: string;
  collectionDbId?: number;
  /** The song's place in the album being downloaded. */
  position?: TrackPosition;
  albumArtist?: string;
  releaseYear?: number | null;
}

export async function startVideoDownload(
  video: VideoSummary,
  values: SettingsValues,
  overrides: DownloadOverrides = {},
): Promise<DownloadStarted | null> {
  const formats = await getDownloadFormats(video.id);
  const preferred = values[SETTINGS.DEFAULT_DOWNLOAD_QUALITY] ?? "720p";
  const selected = selectDefaultFormat(formats, preferred);
  if (!selected) return null;
  return startDownload({
    adaptive: {
      videoUrl: selected.videoUrl,
      audioUrl: selected.audioUrl,
      container: selected.container,
      videoMimeType: selected.videoMimeType,
      audioMimeType: selected.audioMimeType,
    },
    title: video.title,
    mediaKind: "video",
    qualityLabel: describeDownloadFormat(selected),
    destinationDirectory: overrides.destinationDirectory ?? (values[SETTINGS.DOWNLOAD_LOCATION] || undefined),
    parallel: values[SETTINGS.PARALLEL_DOWNLOAD_ENABLED] !== "false",
    threads: Number(values[SETTINGS.DOWNLOAD_THREADS] ?? 3),
    videoId: video.id,
    thumbnailUrl: video.thumbnailUrl ?? undefined,
    author: video.channelName || undefined,
    durationSeconds: video.durationSeconds ?? undefined,
    collectionDbId: overrides.collectionDbId,
    tags: videoDownloadTags(video),
  });
}

/** Resolves the audio stream for a track and starts its download. */
export async function startMusicDownload(
  track: SongItem,
  values: SettingsValues,
  overrides: DownloadOverrides = {},
): Promise<DownloadStarted | null> {
  const id = track.videoId ?? track.id;
  const stream = await getMusicStream(id, musicDownloadQuality(values), true);
  const started = await startDownload({
    sourceUrl: stream.audioUrl,
    title: track.title,
    mediaKind: "music",
    qualityLabel: describeMusicStream(stream),
    destinationDirectory:
      overrides.destinationDirectory ?? (values[SETTINGS.MUSIC_DOWNLOAD_LOCATION] || undefined),
    parallel: values[SETTINGS.PARALLEL_DOWNLOAD_ENABLED] !== "false",
    threads: Number(values[SETTINGS.DOWNLOAD_THREADS] ?? 3),
    videoId: track.videoId ?? track.id,
    thumbnailUrl: track.thumbnail || undefined,
    author: track.artists.map((artist) => artist.name).filter(Boolean).join(", ") || undefined,
    durationSeconds: track.duration ?? undefined,
    collectionDbId: overrides.collectionDbId,
    loudnessDb: stream.loudnessDb ?? undefined,
    tags: trackDownloadTags(track, overrides.position, overrides.albumArtist, overrides.releaseYear),
  });
  saveLyricsWithDownload(track, started.id);
  return started;
}
