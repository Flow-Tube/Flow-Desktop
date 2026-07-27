import { invokeBackend } from "./errors";

export type DownloadMediaKind = "video" | "music" | "audio";
export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "waitingForNetwork"
  | "muxing"
  | "completed"
  | "failed"
  | "cancelled";

export interface StartDownloadRequest {
  sourceUrl?: string;
  adaptive?: AdaptiveDownloadRequest;
  title: string;
  mediaKind: DownloadMediaKind;
  qualityLabel: string;
  destinationDirectory?: string;
  parallel: boolean;
  threads: number;
  /** Source identifiers used to save companion files (poster, SponsorBlock, lyrics)
   *  and to populate the persisted downloads library. */
  videoId?: string;
  thumbnailUrl?: string;
  author?: string;
  durationSeconds?: number;
  collectionDbId?: number;
}

export interface AdaptiveDownloadRequest {
  videoUrl: string;
  audioUrl: string;
  container: DownloadContainer;
  videoMimeType: string;
  audioMimeType: string;
}

export interface DownloadStarted {
  id: string;
  filePath: string;
}

export interface DownloadProgress {
  id: string;
  title: string;
  mediaKind: DownloadMediaKind;
  qualityLabel: string;
  filePath: string;
  downloadedBytes: number;
  totalBytes: number | null;
  status: DownloadStatus;
  error: string | null;
  /** Coarse failure category for a `failed` download (e.g. "network", "streaming",
   *  "internal", "download"); null unless the download terminally failed. */
  errorKind: string | null;
  logs: string[];
  videoId: string | null;
  thumbnailUrl: string | null;
  collectionDbId: number | null;
}

export type DownloadContainer = "mp4" | "mkv";

export interface DownloadableFormat {
  formatId: string;
  resolution: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  container: DownloadContainer;
  videoCodec: string;
  audioCodec: string;
  videoMimeType: string;
  audioMimeType: string;
  videoBitrate: number | null;
  audioBitrate: number | null;
  videoSizeBytes: number | null;
  audioSizeBytes: number | null;
  estimatedSizeBytes: number | null;
  videoUrl: string;
  audioUrl: string;
}

export function getDownloadFormats(videoId: string): Promise<DownloadableFormat[]> {
  return invokeBackend<DownloadableFormat[]>("get_download_formats", { videoId });
}

export function startDownload(request: StartDownloadRequest): Promise<DownloadStarted> {
  return invokeBackend<DownloadStarted>("start_download", { request });
}

export function cancelDownload(id: string): Promise<boolean> {
  return invokeBackend<boolean>("cancel_download", { id });
}

export function pauseDownload(id: string): Promise<boolean> {
  return invokeBackend<boolean>("pause_download", { id });
}

export function resumeDownload(id: string): Promise<boolean> {
  return invokeBackend<boolean>("resume_download", { id });
}

export interface DownloadRecord {
  id: number;
  videoId: string | null;
  title: string;
  author: string | null;
  mediaKind: DownloadMediaKind;
  filePath: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  qualityLabel: string | null;
  fileSizeBytes: number | null;
  collectionDbId: number | null;
  createdAt: string;
}

export function listDownloads(): Promise<DownloadRecord[]> {
  return invokeBackend<DownloadRecord[]>("list_downloads");
}

export function getDownloadedVideoIds(): Promise<string[]> {
  return invokeBackend<string[]>("get_downloaded_video_ids");
}

export function deleteDownloads(ids: number[]): Promise<void> {
  return invokeBackend<void>("delete_downloads", { ids });
}

export function clearDownloads(): Promise<void> {
  return invokeBackend<void>("clear_downloads");
}

export interface OfflineStreamInfo {
  url: string;
  contentType: string;
  /** Loopback URL for the cover art saved with the download, when present. */
  artworkUrl: string | null;
  /** Lyrics saved with the download, when present. */
  lyrics: string | null;
}

export function getOfflineStream(
  videoId: string,
  mediaKind: DownloadMediaKind,
): Promise<OfflineStreamInfo> {
  return invokeBackend<OfflineStreamInfo>("get_offline_stream", { videoId, mediaKind });
}

export type DownloadCollectionKind = "playlist" | "album";

export interface CreateCollectionRequest {
  collectionId: string;
  kind: DownloadCollectionKind;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  totalCount: number;
}

export interface CreatedCollection {
  id: number;
  folderPath: string;
  existingVideoIds: string[];
}

export interface DownloadCollectionRecord {
  id: number;
  collectionId: string;
  kind: DownloadCollectionKind;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
  folderPath: string;
  totalCount: number;
  downloadedCount: number;
  createdAt: string;
}

/** Creates (or reuses) a collection folder + record; returns the destination folder. */
export function createDownloadCollection(
  request: CreateCollectionRequest,
): Promise<CreatedCollection> {
  return invokeBackend<CreatedCollection>("create_download_collection", { request });
}

export function listDownloadCollections(): Promise<DownloadCollectionRecord[]> {
  return invokeBackend<DownloadCollectionRecord[]>("list_download_collections");
}

export function deleteDownloadCollections(ids: number[]): Promise<void> {
  return invokeBackend<void>("delete_download_collections", { ids });
}
