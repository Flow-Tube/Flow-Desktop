import { invokeBackend } from "./errors";

export async function writeBackupFile(path: string, contents: string): Promise<void> {
  return invokeBackend<void>("write_backup_file", { path, contents });
}

export async function writeLyricsFile(path: string, contents: string): Promise<void> {
  return invokeBackend<void>("write_lyrics_file", { path, contents });
}

/** Asks where to save the Recap poster, given as base64, and saves it. False when the dialog is cancelled. */
export async function saveRecapPoster(base64: string, suggestedName: string, title: string): Promise<boolean> {
  return invokeBackend<boolean>("save_recap_poster", { base64, suggestedName, title });
}
