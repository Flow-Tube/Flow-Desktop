import { invokeBackend } from "./errors";

export async function writeBackupFile(path: string, contents: string): Promise<void> {
  return invokeBackend<void>("write_backup_file", { path, contents });
}

export async function writeLyricsFile(path: string, contents: string): Promise<void> {
  return invokeBackend<void>("write_lyrics_file", { path, contents });
}
