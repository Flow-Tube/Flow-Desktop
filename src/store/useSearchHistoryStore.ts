import { create } from "zustand";
import { shouldRecordWatchHistory } from "../lib/deepFlow";

const STORAGE_KEY = "flow_search_history";
export const SEARCH_HISTORY_LIMIT = 50;

export interface SearchHistoryEntry {
  query: string;
  at: number;
}

function load(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is SearchHistoryEntry =>
        typeof entry?.query === "string" && entry.query.trim() !== "" && typeof entry?.at === "number")
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persist(entries: SearchHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn("Failed to save search history", error);
  }
}

const sameQuery = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface SearchHistoryState {
  entries: SearchHistoryEntry[];
  /** Newest first; a repeated query moves to the top. Skipped in Deep Flow unless history is allowed there. */
  record: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
}

export const useSearchHistoryStore = create<SearchHistoryState>((set) => ({
  entries: load(),
  record: (query) => {
    const trimmed = query.trim();
    if (!trimmed || !shouldRecordWatchHistory()) return;
    set((state) => {
      const entries = [
        { query: trimmed, at: Date.now() },
        ...state.entries.filter((entry) => !sameQuery(entry.query, trimmed)),
      ].slice(0, SEARCH_HISTORY_LIMIT);
      persist(entries);
      return { entries };
    });
  },
  remove: (query) => set((state) => {
    const entries = state.entries.filter((entry) => !sameQuery(entry.query, query));
    persist(entries);
    return { entries };
  }),
  clear: () => {
    persist([]);
    set({ entries: [] });
  },
}));
