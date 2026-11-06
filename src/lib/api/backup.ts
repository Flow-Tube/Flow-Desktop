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

export type UnreadableReason = "too_large" | "no_backup" | "damaged";

export type ReadBackup =
  | { type: "backup"; data: unknown }
  | { type: "text"; text: string }
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
