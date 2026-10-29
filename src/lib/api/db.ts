import type { WatchHistoryRecord } from "../../types/db";
import { isTauriEnv } from "./env";
import { invokeBackend } from "./errors";
import { announceSettingWrite } from "../windowEvents";
import { profileStorage } from "../storage/profileStorage";

export async function getWatchHistory(
  limit: number,
  offset: number,
): Promise<WatchHistoryRecord[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Falling back to local storage watch history.");
    const saved = profileStorage.getItem("mock_watch_history");
    const list: WatchHistoryRecord[] = saved ? JSON.parse(saved) : [];
    return list.slice(offset, offset + limit);
  }
  return invokeBackend<WatchHistoryRecord[]>("get_watch_history", { limit, offset });
}

export async function getMusicHistory(
  limit: number,
  offset: number,
): Promise<WatchHistoryRecord[]> {
  if (!(await isTauriEnv())) {
    const all = await getWatchHistory(limit + offset, 0);
    return all.filter((r) => r.isMusic).slice(offset, offset + limit);
  }
  return invokeBackend<WatchHistoryRecord[]>("get_music_history", { limit, offset });
}

export async function addWatchRecord(
  record: WatchHistoryRecord,
): Promise<void> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Adding watch record to local storage.");
    const current = await getWatchHistory(100, 0);
    const updated = [record, ...current];
    profileStorage.setItem("mock_watch_history", JSON.stringify(updated));
    return;
  }
  return invokeBackend<void>("add_watch_record", { record });
}

export async function addWatchRecordsBulk(
  records: WatchHistoryRecord[],
): Promise<void> {
  if (records.length === 0) return;
  if (!(await isTauriEnv())) {
    const current = await getWatchHistory(10000, 0);
    const byId = new Map(current.map((r) => [r.videoId, r]));
    for (const record of records) byId.set(record.videoId, record);
    profileStorage.setItem("mock_watch_history", JSON.stringify([...byId.values()]));
    return;
  }
  return invokeBackend<void>("add_watch_records_bulk", { records });
}

export async function deleteWatchRecord(videoId: string): Promise<void> {
  if (!(await isTauriEnv())) {
    const current = await getWatchHistory(100, 0);
    const updated = current.filter((r) => r.videoId !== videoId);
    profileStorage.setItem("mock_watch_history", JSON.stringify(updated));
    return;
  }
  return invokeBackend<void>("delete_watch_record", { videoId });
}

export async function clearWatchHistory(): Promise<void> {
  if (!(await isTauriEnv())) {
    profileStorage.removeItem("mock_watch_history");
    return;
  }
  return invokeBackend<void>("clear_watch_history");
}

/** Clears history, subscriptions and saved playlists; a linked device first leaves its group. */
export async function resetAppData(): Promise<void> {
  if (!(await isTauriEnv())) {
    profileStorage.removeItem("mock_watch_history");
    return;
  }
  return invokeBackend<void>("reset_app_data");
}

export async function getSetting(key: string): Promise<string | null> {
  if (!(await isTauriEnv())) {
    console.warn(`Tauri not detected. Reading setting from local storage: ${key}`);
    return profileStorage.getItem(`mock_setting_${key}`);
  }
  return invokeBackend<string | null>("get_setting", { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (!(await isTauriEnv())) {
    console.warn(`Tauri not detected. Saving setting to local storage: ${key}`);
    profileStorage.setItem(`mock_setting_${key}`, value);
    return;
  }
  await invokeBackend<void>("set_setting", { key, value });
  announceSettingWrite(key);
}
