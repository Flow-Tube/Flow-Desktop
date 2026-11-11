import type { WatchHistoryRecord } from "../types/db";

export type HistoryFilter = "all" | "videos" | "shorts" | "music";
export type HistorySort = "newest" | "oldest";

export interface HistoryView {
  filter: HistoryFilter;
  year: number | null;
  sort: HistorySort;
  query: string;
  shortsEnabled: boolean;
  /** Show Music; songs stay out of every tab while it is off. */
  musicEnabled?: boolean;
}

export const historyYear = (watchDate: string): number | null => {
  const at = new Date(watchDate);
  return Number.isNaN(at.getTime()) ? null : at.getFullYear();
};

function matchesFilter(record: WatchHistoryRecord, filter: HistoryFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "videos":
      return !record.isMusic && !record.isShort;
    case "shorts":
      return !record.isMusic && Boolean(record.isShort);
    case "music":
      return Boolean(record.isMusic);
  }
}

/** The filter in force: there is no Shorts tab while Shorts are hidden, and no Music tab while music is. */
export const effectiveHistoryFilter = (filter: HistoryFilter, shortsEnabled: boolean, musicEnabled = true): HistoryFilter =>
  (filter === "shorts" && !shortsEnabled) || (filter === "music" && !musicEnabled) ? "all" : filter;

/** The rows a view shows, in its order. `records` arrive newest first. */
export function filterHistory(
  records: WatchHistoryRecord[],
  { filter, year, sort, query, shortsEnabled, musicEnabled = true }: HistoryView,
): WatchHistoryRecord[] {
  const needle = query.trim().toLowerCase();
  const shown = records.filter((record) => {
    if (!shortsEnabled && record.isShort) return false;
    if (!musicEnabled && record.isMusic) return false;
    if (!matchesFilter(record, filter)) return false;
    if (year !== null && historyYear(record.watchDate) !== year) return false;
    return !needle || `${record.title ?? ""} ${record.channelName ?? ""}`.toLowerCase().includes(needle);
  });
  return sort === "newest" ? shown : shown.reverse();
}
