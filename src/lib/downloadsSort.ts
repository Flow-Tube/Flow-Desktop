import { formatBytes } from "./downloadOptions";
import { getString, type StringKey } from "./i18n/index";
import { profileStorage } from "./storage/profileStorage";
import type { DownloadRecord } from "./api/downloads";

const SORT_STORAGE_KEY = "flow_downloads_sort";

export const DOWNLOAD_SORTS = ["newest", "oldest", "largest", "title", "channel"] as const;

export type DownloadSort = (typeof DOWNLOAD_SORTS)[number];

export const downloadSortLabel = (sort: DownloadSort): string => getString(`downloads_sort_${sort}` as StringKey);

export const loadDownloadSort = (): DownloadSort => {
  const stored = profileStorage.getItem(SORT_STORAGE_KEY);
  return DOWNLOAD_SORTS.find((sort) => sort === stored) ?? "newest";
};

export const saveDownloadSort = (sort: DownloadSort) => {
  try {
    profileStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch (error) {
    console.error("Failed to persist the downloads sort", error);
  }
};

/** SQLite stamps a row in UTC without saying so. */
const savedAt = (record: DownloadRecord): number => {
  const at = Date.parse(`${record.createdAt.replace(" ", "T")}Z`);
  return Number.isNaN(at) ? 0 : at;
};

const byText = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });

export function sortDownloadRecords(records: DownloadRecord[], sort: DownloadSort): DownloadRecord[] {
  const sorted = [...records];
  switch (sort) {
    case "newest":
      return sorted.sort((a, b) => savedAt(b) - savedAt(a));
    case "oldest":
      return sorted.sort((a, b) => savedAt(a) - savedAt(b));
    case "largest":
      return sorted.sort((a, b) => (b.fileSizeBytes ?? 0) - (a.fileSizeBytes ?? 0));
    case "title":
      return sorted.sort((a, b) => byText(a.title, b.title));
    case "channel":
      return sorted.sort((a, b) => byText(a.author, b.author));
  }
}

/** A saved download's size and date, whichever of them are known. */
export function downloadDetail(record: DownloadRecord): string {
  const at = savedAt(record);
  return [
    formatBytes(record.fileSizeBytes ?? null),
    at > 0 ? new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null,
  ].filter(Boolean).join(" • ");
}

/** Bytes the library takes, by kind. */
export function downloadedBytes(records: DownloadRecord[]): { video: number; music: number } {
  let video = 0;
  let music = 0;
  for (const record of records) {
    if (record.mediaKind === "video") video += record.fileSizeBytes ?? 0;
    else music += record.fileSizeBytes ?? 0;
  }
  return { video, music };
}
