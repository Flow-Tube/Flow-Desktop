import { create } from "zustand";

import {
  clearWatchHistory,
  deleteShortWatchRecords,
  deleteWatchRecord,
  getWatchHistory,
  restoreWatchRecord,
} from "../lib/api/db";
import type { WatchHistoryRecord } from "../types/db";

export const HISTORY_PAGE_SIZE = 200;
/** Fired after watch history changed behind the stores, for example by a sync. */
export const HISTORY_UPDATED_EVENT = "flow:history-updated";

interface HistoryState {
  records: WatchHistoryRecord[];
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  offset: number;
  load: (force?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  remove: (videoId: string) => Promise<void>;
  /** Puts a removed row back where its watch date places it. */
  restore: (record: WatchHistoryRecord) => Promise<void>;
  removeShorts: () => Promise<void>;
  clear: () => Promise<void>;
}

let inFlight = false;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  records: [],
  loaded: false,
  loading: false,
  loadingMore: false,
  hasMore: false,
  offset: 0,
  load: async (force = false) => {
    if (inFlight) return;
    if (get().loaded && !force) return;
    inFlight = true;
    set({ loading: true });
    try {
      const records = await getWatchHistory(HISTORY_PAGE_SIZE, 0);
      set({
        records,
        offset: records.length,
        hasMore: records.length === HISTORY_PAGE_SIZE,
        loaded: true,
      });
    } catch (error) {
      console.error("Failed to fetch history", error);
    } finally {
      inFlight = false;
      set({ loading: false });
    }
  },
  loadMore: async () => {
    if (inFlight) return;
    inFlight = true;
    set({ loadingMore: true });
    try {
      const records = await getWatchHistory(HISTORY_PAGE_SIZE, get().offset);
      set((state) => {
        const seen = new Set(state.records.map((r) => r.videoId));
        const fresh = records.filter((r) => !seen.has(r.videoId));
        return {
          records: fresh.length > 0 ? [...state.records, ...fresh] : state.records,
          offset: state.offset + records.length,
          hasMore: records.length === HISTORY_PAGE_SIZE,
        };
      });
    } catch (error) {
      console.error("Failed to fetch more history", error);
    } finally {
      inFlight = false;
      set({ loadingMore: false });
    }
  },
  remove: async (videoId) => {
    await deleteWatchRecord(videoId);
    set((state) => ({
      records: state.records.filter((item) => item.videoId !== videoId),
      offset: Math.max(0, state.offset - 1),
    }));
  },
  restore: async (record) => {
    await restoreWatchRecord(record);
    set((state) => {
      if (state.records.some((item) => item.videoId === record.videoId)) return state;
      const at = state.records.findIndex((item) => item.watchDate < record.watchDate);
      // Older than every loaded page: a later page brings it back.
      if (at === -1 && state.hasMore) return state;
      const records = [...state.records];
      records.splice(at === -1 ? records.length : at, 0, record);
      return { records, offset: state.offset + 1 };
    });
  },
  removeShorts: async () => {
    await deleteShortWatchRecords();
    set((state) => {
      const records = state.records.filter((item) => !item.isShort);
      return { records, offset: Math.max(0, state.offset - (state.records.length - records.length)) };
    });
  },
  clear: async () => {
    await clearWatchHistory();
    set({ records: [], offset: 0, hasMore: false });
  },
}));
