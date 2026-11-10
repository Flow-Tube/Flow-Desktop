import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";

/** Event the backend sends the main window when the tray's Continue watching item is clicked. */
export const TRAY_CONTINUE_WATCHING_EVENT = "flow:tray-continue-watching";

// Mirrors the backend TrayUpdate (serde camelCase).
export interface MusicTrayUpdate {
  nowPlaying: string;
  hasTrack: boolean;
  playing: boolean;
  continueWatching: string | null;
  labels: { play: string; pause: string; previous: string; next: string; show: string; continueWatching: string };
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

export interface ShellPageLabels {
  search: string;
  downloads: string;
  history: string;
  music: string;
}

/** Fills in the Dock menu or the Jump List. */
export async function setShellPages(labels: ShellPageLabels): Promise<void> {
  if (!(await isTauriEnv())) return;
  try {
    await invokeBackend<void>("set_shell_pages", { labels });
  } catch (error) {
    console.warn("Failed to set the Dock menu or Jump List", error);
  }
}

/** The page this launch was asked to open, once. */
export async function takeLaunchPage(): Promise<string | null> {
  if (!(await isTauriEnv())) return null;
  try {
    return await invokeBackend<string | null>("take_launch_page");
  } catch {
    return null;
  }
}

/** The `flow://open` link for a URL this launch was given on its command line, once. */
export async function takeLaunchLink(): Promise<string | null> {
  if (!(await isTauriEnv())) return null;
  try {
    return await invokeBackend<string | null>("take_launch_link");
  } catch {
    return null;
  }
}

export interface DownloadProgressBadge {
  percent: number | null;
  count: number;
  paused: boolean;
}

export async function setDownloadProgressBadge(progress: DownloadProgressBadge): Promise<void> {
  if (!(await isTauriEnv())) return;
  try {
    await invokeBackend<void>("set_download_progress", { ...progress });
  } catch (error) {
    console.warn("Failed to show download progress on the taskbar", error);
  }
}
