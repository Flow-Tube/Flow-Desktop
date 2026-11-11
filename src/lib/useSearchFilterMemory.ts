import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { availableWith, type SearchFilterState } from "./searchFilterState";
import type { UseCombinedSearchReturn } from "./useCombinedSearch";
import { useShortsEnabled } from "./useShortsContent";
import { useMusicEnabled } from "./useMusicContent";
import { useSearchHistoryStore } from "../store/useSearchHistoryStore";

export function currentFilterState(search: UseCombinedSearchReturn): SearchFilterState {
  return { category: search.filterType, sortBy: search.sortBy, filters: search.filters };
}

/**
 * Ties the page's filters to the search history: running a past search brings its filters back, and
 * any later change is kept on its entry. Returns the change handler for the filter controls.
 */
export function useSearchFilterMemory(search: UseCombinedSearchReturn, query: string) {
  const location = useLocation();
  const shortsEnabled = useShortsEnabled();
  const musicEnabled = useMusicEnabled();
  const rememberFilters = useSearchHistoryStore((state) => state.rememberFilters);
  const { applyFilterState } = search;
  const latest = useRef(currentFilterState(search));
  latest.current = currentFilterState(search);

  useEffect(() => {
    const stored = (location.state as { searchFilters?: SearchFilterState } | null)?.searchFilters;
    if (stored) applyFilterState(availableWith(stored, shortsEnabled, musicEnabled));
    else if (query) rememberFilters(query, latest.current);
    // Once per navigation: a later change of the switch is handled below.
  }, [location.key]);

  useEffect(() => {
    const available = availableWith(latest.current, shortsEnabled, musicEnabled);
    if (available !== latest.current) applyFilterState(available);
  }, [shortsEnabled, musicEnabled, applyFilterState]);

  return useCallback(
    (next: SearchFilterState) => {
      applyFilterState(next);
      rememberFilters(query, next);
    },
    [applyFilterState, rememberFilters, query],
  );
}
