import { invokeBackend } from "./errors";
import { SETTING_EXPORT_KEYS } from "../settings/schema";

export type BackupFileKind = "APP_DATA" | "BRAIN" | "MASTER" | "WATCH_HISTORY" | "NEWPIPE_SUBSCRIPTIONS";

export interface ExportResult {
  /** Channels NewPipe couldn't open, left out of its file. */
  skipped: number;
}

export interface AutoBackupStatus {
  lastRunMs: number;
  lastError: "folder_missing" | "failed" | null;
  running: boolean;
}

export type ImportKind =
  | "TAKEOUT"
  | "YOUTUBE_SUBSCRIPTIONS"
  | "YOUTUBE_HISTORY"
  | "YOUTUBE_LIKES"
  | "YOUTUBE_PLAYLIST"
  | "WATCH_LATER"
  | "YOUTUBE_MUSIC_PLAYLIST"
  | "NEWPIPE_SUBSCRIPTIONS"
  | "NEWPIPE_HISTORY"
  | "NEWPIPE_PLAYLISTS"
  | "NEWPIPE_BACKUP"
  | "LIBRETUBE_SUBSCRIPTIONS"
  | "LIBRETUBE_PLAYLISTS"
  | "LIBRETUBE_BACKUP"
  | "FREETUBE_HISTORY"
  | "METROLIST";

export interface ImportReport {
  subscriptions: number;
  history: number;
  playlists: number;
  playlistVideos: number;
  musicPlaylists: number;
  musicLibrary: number;
  likes: number;
}

export type ImportFailure = "invalid_format" | "too_large" | "no_content" | "no_entries" | "no_videos" | "no_likes" | "failed";

export type ImportOutcome = { type: "done"; report: ImportReport } | { type: "failed"; reason: ImportFailure };

export type UnreadableReason = "too_large" | "no_backup" | "damaged";

export type ReadBackup =
  | { type: "backup"; data: unknown }
  | { type: "text"; text: string }
  | { type: "external"; kind: ImportKind }
  | { type: "unreadable"; reason: UnreadableReason };

export function exportBackupFile(kind: BackupFileKind, path: string): Promise<ExportResult> {
  return invokeBackend<ExportResult>("export_backup_file", { kind, path, settingKeys: SETTING_EXPORT_KEYS });
}

/** A picked file, as the desktop's backup shape whichever Flow app wrote it, or as text. */
export function readBackupFile(path: string): Promise<ReadBackup> {
  return invokeBackend<ReadBackup>("read_backup", { path });
}

/** Hands the schedule what only the frontend knows; its worker starts after this. */
export function registerAutoBackup(failureTitle: string): Promise<void> {
  return invokeBackend<void>("auto_backup_register", { settingKeys: SETTING_EXPORT_KEYS, failureTitle });
}

export function getAutoBackupStatus(): Promise<AutoBackupStatus> {
  return invokeBackend<AutoBackupStatus>("auto_backup_status");
}

/** False when a backup is already running. */
export function runAutoBackupNow(): Promise<boolean> {
  return invokeBackend<boolean>("auto_backup_run_now");
}

/** One import from another app, on the files the viewer picked. */
export function importOtherApp(kind: ImportKind, paths: string[], libraryName: string): Promise<ImportOutcome> {
  return invokeBackend<ImportOutcome>("import_other_app", { kind, paths, libraryName });
}
