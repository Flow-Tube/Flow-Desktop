import type { WatchHistoryRecord } from "../../types/db";
import { isTauriEnv } from "./env";
import { invokeBackend } from "./errors";
import { announceSettingWrite, announceWatchHistoryWrite, type WatchHistoryWrite } from "../windowEvents";
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

function recordWrite(record: WatchHistoryRecord): WatchHistoryWrite {
  return {
    kind: "record",
    videoId: record.videoId,
    watchedSeconds: record.watchDurationSeconds,
    totalSeconds: record.totalDurationSeconds ?? 0,
    skipped: Boolean(record.isMusic || record.isShort),
  };
}

async function saveMockWatchRecord(record: WatchHistoryRecord): Promise<void> {
  console.warn("Tauri not detected. Adding watch record to local storage.");
  const current = await getWatchHistory(100, 0);
  profileStorage.setItem("mock_watch_history", JSON.stringify([record, ...current]));
}

export async function addWatchRecord(
  record: WatchHistoryRecord,
): Promise<void> {
  if (await isTauriEnv()) await invokeBackend<void>("add_watch_record", { record });
  else await saveMockWatchRecord(record);
  announceWatchHistoryWrite(recordWrite(record));
}

/** Puts back a removed row, as newer than the removal that other devices may already hold. */
export async function restoreWatchRecord(record: WatchHistoryRecord): Promise<void> {
  if (await isTauriEnv()) await invokeBackend<void>("restore_watch_record", { record });
  else await saveMockWatchRecord(record);
  announceWatchHistoryWrite(recordWrite(record));
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
  } else {
    await invokeBackend<void>("add_watch_records_bulk", { records });
  }
  announceWatchHistoryWrite({ kind: "rewritten" });
}

export async function deleteWatchRecord(videoId: string): Promise<void> {
  if (!(await isTauriEnv())) {
    const current = await getWatchHistory(100, 0);
    const updated = current.filter((r) => r.videoId !== videoId);
    profileStorage.setItem("mock_watch_history", JSON.stringify(updated));
  } else {
    await invokeBackend<void>("delete_watch_record", { videoId });
  }
  announceWatchHistoryWrite({ kind: "removed", videoId });
}

/** The rows for these videos that exist. */
export async function getWatchRecords(videoIds: string[]): Promise<WatchHistoryRecord[]> {
  if (!(await isTauriEnv())) {
    const ids = new Set(videoIds);
    return (await getWatchHistory(10000, 0)).filter((record) => ids.has(record.videoId));
  }
  return invokeBackend<WatchHistoryRecord[]>("get_watch_records", { videoIds });
}

/** How far each video was watched, as [video id, seconds watched, length]; songs and Shorts left out. */
export type WatchProgressRow = [videoId: string, watchedSeconds: number, totalSeconds: number];

export async function getWatchProgress(): Promise<WatchProgressRow[]> {
  if (!(await isTauriEnv())) {
    return (await getWatchHistory(10000, 0))
      .filter((record) => !record.isMusic && !record.isShort && (record.totalDurationSeconds ?? 0) > 0)
      .map((record) => [record.videoId, record.watchDurationSeconds, record.totalDurationSeconds ?? 0]);
  }
  return invokeBackend<WatchProgressRow[]>("get_watch_progress");
}

/** The years anything was watched in, newest first. */
export async function getWatchHistoryYears(): Promise<number[]> {
  if (!(await isTauriEnv())) return [];
  return invokeBackend<number[]>("get_watch_history_years");
}

export async function deleteShortWatchRecords(): Promise<void> {
  if (!(await isTauriEnv())) {
    const kept = (await getWatchHistory(10000, 0)).filter((record) => !record.isShort);
    profileStorage.setItem("mock_watch_history", JSON.stringify(kept));
  } else {
    await invokeBackend<void>("delete_short_watch_records");
  }
  announceWatchHistoryWrite({ kind: "rewritten" });
}

export async function clearWatchHistory(): Promise<void> {
  if (await isTauriEnv()) await invokeBackend<void>("clear_watch_history");
  else profileStorage.removeItem("mock_watch_history");
  announceWatchHistoryWrite({ kind: "rewritten" });
}

/** Clears history, subscriptions and saved playlists; a linked device first leaves its group. */
export async function resetAppData(): Promise<void> {
  if (await isTauriEnv()) await invokeBackend<void>("reset_app_data");
  else profileStorage.removeItem("mock_watch_history");
  announceWatchHistoryWrite({ kind: "rewritten" });
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
