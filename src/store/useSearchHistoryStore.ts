import { useMemo } from "react";
import { create } from "zustand";
import { deepFlowAllowsHistory } from "../lib/deepFlow";
import { SETTINGS } from "../lib/settings/schema";
import {
  isDefaultFilterState,
  sanitizeFilterState,
  type SearchFilterState,
} from "../lib/searchFilterState";
import { recapQueriesCleared, recapSearch } from "../lib/recap/recapQueue";
import { profileStorage } from "../lib/storage/profileStorage";
import { getSettingValue, useAppSettingsStore } from "./useAppSettingsStore";

const STORAGE_KEY = "flow_search_history";
export const SEARCH_HISTORY_DEFAULT_LIMIT = 50;
/** The largest Max history size on offer. */
const SEARCH_HISTORY_STORED_LIMIT = 500;
const SEARCH_HISTORY_DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

export interface SearchHistoryEntry {
  query: string;
  at: number;
  /** The filters last used with this search, so running it again finds the same results. */
  filters?: SearchFilterState;
}

function load(): SearchHistoryEntry[] {
  try {
    const raw = profileStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is SearchHistoryEntry =>
        typeof entry?.query === "string" && entry.query.trim() !== "" && typeof entry?.at === "number")
      .map((entry) => ({ ...entry, filters: sanitizeFilterState(entry.filters) }))
      .slice(0, SEARCH_HISTORY_STORED_LIMIT);
  } catch {
    return [];
  }
}

function persist(entries: SearchHistoryEntry[]) {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn("Failed to save search history", error);
  }
}

const maxSize = (raw: string | undefined): number => {
  const size = Number(raw);
  return Number.isFinite(size) && size > 0 ? size : SEARCH_HISTORY_DEFAULT_LIMIT;
};

/** What the viewer's settings let the list show: nothing when saving is off, and nothing past its age or size. */
export function visibleSearchEntries(
  entries: SearchHistoryEntry[],
  values: Record<string, string | undefined>,
  now: number,
): SearchHistoryEntry[] {
  if (values[SETTINGS.SEARCH_HISTORY_ENABLED] === "false") return [];
  const days = Number(values[SETTINGS.SEARCH_HISTORY_RETENTION_DAYS] ?? SEARCH_HISTORY_DEFAULT_RETENTION_DAYS);
  const oldest = values[SETTINGS.AUTO_DELETE_SEARCH_HISTORY] === "true" && days > 0 ? now - days * DAY_MS : 0;
  return entries
    .filter((entry) => entry.at >= oldest)
    .slice(0, maxSize(values[SETTINGS.SEARCH_HISTORY_MAX_SIZE]));
}

const sameQuery = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface SearchHistoryState {
  entries: SearchHistoryEntry[];
  /** Newest first; a repeated query moves to the top. Skipped when saving searches is off, and in Deep Flow unless history is allowed there. */
  record: (query: string) => void;
  /** Keeps these filters on the search's entry; the default set clears them. No entry, no change. */
  rememberFilters: (query: string, filters: SearchFilterState) => void;
  filtersOf: (query: string) => SearchFilterState | undefined;
  remove: (query: string) => void;
  clear: () => void;
  /** Forgets what's past a new Max history size, so raising it again doesn't bring them back. */
  trimTo: (size: number) => void;
}

export const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  entries: load(),
  record: (query) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const saving = getSettingValue(SETTINGS.SEARCH_HISTORY_ENABLED) !== "false";
    // With search history off the search still counts, but its words aren't kept. Android's rule.
    recapSearch(saving ? trimmed : null);
    if (!saving || !deepFlowAllowsHistory()) return;
    set((state) => {
      const earlier = state.entries.find((entry) => sameQuery(entry.query, trimmed));
      const entries = [
        { query: trimmed, at: Date.now(), filters: earlier?.filters },
        ...state.entries.filter((entry) => !sameQuery(entry.query, trimmed)),
      ].slice(0, maxSize(getSettingValue(SETTINGS.SEARCH_HISTORY_MAX_SIZE)));
      persist(entries);
      return { entries };
    });
  },
  rememberFilters: (query, filters) => set((state) => {
    if (!state.entries.some((entry) => sameQuery(entry.query, query))) return state;
    const kept = isDefaultFilterState(filters) ? undefined : filters;
    const entries = state.entries.map((entry) => (sameQuery(entry.query, query) ? { ...entry, filters: kept } : entry));
    persist(entries);
    return { entries };
  }),
  filtersOf: (query) => get().entries.find((entry) => sameQuery(entry.query, query))?.filters,
  remove: (query) => set((state) => {
    const entries = state.entries.filter((entry) => !sameQuery(entry.query, query));
    persist(entries);
    return { entries };
  }),
  clear: () => {
    recapQueriesCleared();
    persist([]);
    set({ entries: [] });
  },
  trimTo: (size) => set((state) => {
    if (state.entries.length <= size) return state;
    const entries = state.entries.slice(0, size);
    persist(entries);
    return { entries };
  }),
}));

export function useVisibleSearchHistory(): SearchHistoryEntry[] {
  const entries = useSearchHistoryStore((state) => state.entries);
  const values = useAppSettingsStore((state) => state.values);
  return useMemo(() => visibleSearchEntries(entries, values, Date.now()), [entries, values]);
}
