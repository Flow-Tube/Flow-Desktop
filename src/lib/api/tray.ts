import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";

/** Event the backend emits when a tray menu item is clicked. */
export const MUSIC_TRAY_ACTION_EVENT = "music-tray-action";

export type MusicTrayAction = "toggle" | "previous" | "next";

// Mirrors the backend TrayUpdate (serde camelCase).
export interface MusicTrayUpdate {
  nowPlaying: string;
  hasTrack: boolean;
  playing: boolean;
  labels: { play: string; pause: string; previous: string; next: string; show: string };
}

export async function musicTraySupported(): Promise<boolean> {
  if (!(await isTauriEnv())) return false;
  try {
    return await invokeBackend<boolean>("music_tray_supported");
  } catch {
    return false;
  }
}

export async function updateMusicTray(update: MusicTrayUpdate): Promise<void> {
  if (!(await isTauriEnv())) return;
  try {
    await invokeBackend<void>("music_tray_update", { update });
  } catch (error) {
    console.warn("Failed to update the music tray", error);
  }
}

export async function hideMusicTray(): Promise<void> {
  if (!(await isTauriEnv())) return;
  try {
    await invokeBackend<void>("music_tray_hide");
  } catch (error) {
    console.warn("Failed to hide the music tray", error);
  }
}
