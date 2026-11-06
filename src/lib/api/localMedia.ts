import { listen } from "@tauri-apps/api/event";

import type { CaptionTrack } from "../../types/video";
import { invokeBackend } from "./errors";

export type LocalMediaKind = "video" | "audio";

export interface LocalMediaFile {
  id: string;
  path: string;
  folderPath: string;
  kind: LocalMediaKind;
  title: string;
  fileName: string;
  artist: string;
  album: string;
  durationMs: number;
  sizeBytes: number;
  addedMs: number;
  modifiedMs: number;
  width: number;
  height: number;
  frameRate: number | null;
  bitrateKbps: number | null;
  videoCodec: string;
  audioCodec: string;
}

export interface LocalMediaFolder {
  path: string;
  role: "include" | "exclude";
  available: boolean;
}

export interface LocalMediaPlay {
  fileId: string;
  positionMs: number;
  durationMs: number;
  lastPlayedMs: number;
}

export interface LocalScanStatus {
  running: boolean;
  done: number;
  total: number;
  truncated: boolean;
  failed: boolean;
}

export interface LocalMediaLibrary {
  folders: LocalMediaFolder[];
  files: LocalMediaFile[];
  plays: LocalMediaPlay[];
  scan: LocalScanStatus;
}

export interface LocalStreamInfo {
  url: string;
  contentType: string;
  title: string;
  artist: string;
  videoCodec: string;
  audioCodec: string;
  durationSeconds: number;
  positionSeconds: number;
  lyrics: { text: string; embedded: boolean } | null;
  captions: CaptionTrack[];
}

export function getLocalMediaLibrary(): Promise<LocalMediaLibrary> {
  return invokeBackend<LocalMediaLibrary>("local_media_library");
}

/** Opens the system's folder picker; null when it is cancelled. */
export function addLocalMediaFolder(title: string, exclude: boolean): Promise<string | null> {
  return invokeBackend<string | null>("local_media_add_folder", { title, exclude });
}

export function removeLocalMediaFolder(path: string): Promise<void> {
  return invokeBackend<void>("local_media_remove_folder", { path });
}

export function excludeLocalMediaFolder(path: string): Promise<void> {
  return invokeBackend<void>("local_media_exclude_folder", { path });
}

export function rescanLocalMedia(): Promise<void> {
  return invokeBackend<void>("local_media_rescan");
}

export function cancelLocalMediaScan(): Promise<void> {
  return invokeBackend<void>("local_media_cancel_scan");
}

export function saveLocalPlayback(id: string, positionSeconds: number, durationSeconds: number): Promise<void> {
  return invokeBackend<void>("local_media_report_playback", { id, positionSeconds, durationSeconds });
}

export function getLocalStream(id: string): Promise<LocalStreamInfo> {
  return invokeBackend<LocalStreamInfo>("get_local_stream", { id });
}

/** A loopback link to the file's cover, or null when it has none. */
export function getLocalCover(id: string): Promise<string | null> {
  return invokeBackend<string | null>("local_media_cover", { id });
}

/** Opens the system's file picker for a video's subtitle file; null when it is cancelled. */
export function pickLocalSubtitle(id: string, title: string, filterName: string): Promise<CaptionTrack | null> {
  return invokeBackend<CaptionTrack | null>("local_media_pick_subtitle", { id, title, filterName });
}

export function trashLocalFile(id: string): Promise<void> {
  return invokeBackend<void>("local_media_trash", { id });
}

export function onLocalScanStatus(handler: (status: LocalScanStatus) => void): Promise<() => void> {
  return listen<LocalScanStatus>("local-media-scan", (event) => handler(event.payload));
}
