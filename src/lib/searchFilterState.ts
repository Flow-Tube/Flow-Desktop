import type { AdvancedFilters, SearchCategory, SearchSortBy } from "./useCombinedSearch";

/** Everything a search is narrowed by, kept with its history entry. */
export interface SearchFilterState {
  category: SearchCategory;
  sortBy: SearchSortBy;
  filters: AdvancedFilters;
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedFilters = {
  uploadDate: "any",
  duration: "any",
  contentType: "any",
  features: [],
  watchState: "any",
};

export const DEFAULT_SEARCH_FILTER_STATE: SearchFilterState = {
  category: "all",
  sortBy: "relevance",
  filters: DEFAULT_ADVANCED_FILTERS,
};

export function isDefaultFilterState(state: SearchFilterState): boolean {
  const { filters } = state;
  return (
    state.category === "all" &&
    state.sortBy === "relevance" &&
    filters.uploadDate === "any" &&
    filters.duration === "any" &&
    filters.contentType === "any" &&
    filters.features.length === 0 &&
    filters.watchState === "any"
  );
}

/** A stored entry from an older or newer build: what is missing takes its default. */
export function sanitizeFilterState(raw: unknown): SearchFilterState | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const stored = raw as Partial<SearchFilterState>;
  return {
    category: stored.category ?? "all",
    sortBy: stored.sortBy ?? "relevance",
    filters: {
      ...DEFAULT_ADVANCED_FILTERS,
      ...stored.filters,
      features: Array.isArray(stored.filters?.features) ? stored.filters.features : [],
    },
  };
}

/** Categories only YouTube Music answers. Artists and Playlists also have YouTube's channels and playlists. */
export const MUSIC_ONLY_CATEGORIES: ReadonlySet<SearchCategory> = new Set(["songs", "albums", "podcasts", "episodes"]);

/**
 * The stored filters this device can still run: a Shorts search falls back to All once Shorts are
 * hidden, and a music-only one once Show Music is off.
 */
export function availableWith(state: SearchFilterState, shortsEnabled: boolean, musicEnabled = true): SearchFilterState {
  const hidden = (!shortsEnabled && state.category === "shorts")
    || (!musicEnabled && MUSIC_ONLY_CATEGORIES.has(state.category));
  return hidden ? { ...state, category: "all" } : state;
}
