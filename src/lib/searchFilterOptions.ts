import { getString, type StringKey } from './i18n/index';
import { joinIsolated } from './direction';
import type { SearchFilterState } from './searchFilterState';
import type { AdvancedFilters, SearchCategory, SearchFeatureFilter, SearchSortBy, SearchWatchState } from './useCombinedSearch';

export const CATEGORY_LABEL_KEYS: Record<SearchCategory, StringKey> = {
  all: 'search_cat_all',
  shorts: 'search_cat_shorts',
  videos: 'search_cat_videos',
  live: 'search_cat_live',
  movies: 'search_cat_movies',
  playlists: 'search_cat_playlists',
  artists: 'search_cat_artists',
  songs: 'search_cat_songs',
  albums: 'search_cat_albums',
  podcasts: 'search_cat_podcasts',
  episodes: 'search_cat_episodes',
};

export interface FilterOption<T extends string> {
  value: T;
  labelKey: StringKey;
}

export const UPLOAD_OPTIONS: FilterOption<AdvancedFilters['uploadDate']>[] = [
  { value: 'any', labelKey: 'search_uploaded_any' },
  { value: 'hour', labelKey: 'search_uploaded_hour' },
  { value: 'today', labelKey: 'search_uploaded_today' },
  { value: 'week', labelKey: 'search_uploaded_week' },
  { value: 'month', labelKey: 'search_uploaded_month' },
  { value: 'year', labelKey: 'search_uploaded_year' },
];

export const DURATION_OPTIONS: FilterOption<AdvancedFilters['duration']>[] = [
  { value: 'any', labelKey: 'search_length_any' },
  { value: 'short', labelKey: 'search_length_short' },
  { value: 'medium', labelKey: 'search_length_medium' },
  { value: 'long', labelKey: 'search_length_long' },
];

export const FEATURE_OPTIONS: FilterOption<SearchFeatureFilter>[] = [
  { value: 'hd', labelKey: 'search_feature_hd' },
  { value: '4k', labelKey: 'search_feature_4k' },
  { value: 'hdr', labelKey: 'search_feature_hdr' },
  { value: 'subtitles', labelKey: 'search_feature_subtitles' },
  { value: 'creative_commons', labelKey: 'search_feature_creative_commons' },
  { value: '360', labelKey: 'search_feature_360' },
  { value: 'vr180', labelKey: 'search_feature_vr180' },
  { value: '3d', labelKey: 'search_feature_3d' },
  { value: 'location', labelKey: 'search_feature_location' },
];

export const WATCH_OPTIONS: FilterOption<SearchWatchState>[] = [
  { value: 'any', labelKey: 'search_watch_any' },
  { value: 'unwatched', labelKey: 'search_filter_unwatched' },
  { value: 'watched', labelKey: 'search_filter_watched' },
];

// YouTube reorders by these two only; newest first is the upload-date filter.
export const SORT_OPTIONS: FilterOption<SearchSortBy>[] = [
  { value: 'relevance', labelKey: 'search_sort_relevance' },
  { value: 'views', labelKey: 'search_sort_views' },
];

const labelOf = <T extends string>(options: FilterOption<T>[], value: T) =>
  getString(options.find((option) => option.value === value)?.labelKey ?? options[0]!.labelKey);

/** One filter that narrows the results, and the filters left once it is removed. */
export interface ActiveFilter {
  key: string;
  label: string;
  without: (filters: AdvancedFilters) => AdvancedFilters;
}

/** The filters in effect, in the order the panel lists them. */
export function activeFilters(filters: AdvancedFilters): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  if (filters.uploadDate !== 'any') {
    active.push({ key: 'upload', label: labelOf(UPLOAD_OPTIONS, filters.uploadDate), without: (f) => ({ ...f, uploadDate: 'any' }) });
  }
  if (filters.duration !== 'any') {
    active.push({ key: 'duration', label: labelOf(DURATION_OPTIONS, filters.duration), without: (f) => ({ ...f, duration: 'any' }) });
  }
  for (const option of FEATURE_OPTIONS) {
    if (!filters.features.includes(option.value)) continue;
    active.push({
      key: `feature:${option.value}`,
      label: getString(option.labelKey),
      without: (f) => ({ ...f, features: f.features.filter((feature) => feature !== option.value) }),
    });
  }
  if (filters.watchState !== 'any') {
    active.push({ key: 'watch', label: labelOf(WATCH_OPTIONS, filters.watchState), without: (f) => ({ ...f, watchState: 'any' }) });
  }
  return active;
}

/** "Videos · This week · 4K": what a past search narrowed to; empty for a plain search. */
export function filterSummary(state: SearchFilterState): string {
  return joinIsolated(
    [
      state.category !== 'all' && getString(CATEGORY_LABEL_KEYS[state.category]),
      state.sortBy !== 'relevance' && labelOf(SORT_OPTIONS, state.sortBy),
      ...activeFilters(state.filters).map((filter) => filter.label),
    ],
    ' · ',
  );
}
