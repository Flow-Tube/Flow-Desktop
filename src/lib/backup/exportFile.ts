import { flushRecapQueue } from "../recap/recapQueue";
import { pickSaveFile } from "../dialogs";
import { exportBackupFile, type BackupFileKind, type ExportResult } from "../api/backup";

const FILE_NAMES: Record<BackupFileKind, (now: number) => string> = {
  APP_DATA: (now) => `flow_backup_${now}.json`,
  BRAIN: (now) => `flow_brain_backup_${now}.zip`,
  MASTER: (now) => `flow_master_backup_${now}.zip`,
  NEWPIPE_SUBSCRIPTIONS: (now) => `newpipe_subscriptions_${now}.json`,
  WATCH_HISTORY: () => "flow-watch-history.json",
};

/** The name a save dialog offers; the same stems Flow for Android uses. */
export function backupFileName(kind: BackupFileKind, now = Date.now()): string {
  return FILE_NAMES[kind](now);
}

/** Asks where to save, then writes the file. Null when the viewer cancels. */
export async function saveBackupFile(kind: BackupFileKind, title: string): Promise<ExportResult | null> {
  const name = backupFileName(kind);
  const extension = name.endsWith(".zip") ? "zip" : "json";
  const path = await pickSaveFile(title, name, [{ name: extension.toUpperCase(), extensions: [extension] }]);
  if (!path) return null;
  await flushRecapQueue();
  return exportBackupFile(kind, path);
}
