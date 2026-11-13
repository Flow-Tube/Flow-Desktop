import { invokeBackend } from "./errors";

export async function writeBackupFile(path: string, contents: string): Promise<void> {
  return invokeBackend<void>("write_backup_file", { path, contents });
}

export async function writeLyricsFile(path: string, contents: string): Promise<void> {
  return invokeBackend<void>("write_lyrics_file", { path, contents });
}

/** Asks where to save a PNG (the Recap poster, a lyric card), given as base64. False when the dialog is cancelled. */
export async function savePngImage(base64: string, suggestedName: string, title: string): Promise<boolean> {
  return invokeBackend<boolean>("save_recap_poster", { base64, suggestedName, title });
}
