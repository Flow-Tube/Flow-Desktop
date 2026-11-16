import { Music2 } from 'lucide-react';
import { Chip } from '../ui/Chip';
import { FilterSelect } from '../ui/FilterSelect';
import { UnderlineTabs, type UnderlineTabGroup } from '../ui/UnderlineTabs';
import { getString } from '../../lib/i18n/index';
import { isCategoryOffered } from '../../lib/searchResults';
import { useShortsEnabled } from '../../lib/useShortsContent';
import { useMusicEnabled } from '../../lib/useMusicContent';
import { MUSIC_ONLY_CATEGORIES, VIDEO_FILTER_CATEGORIES } from '../../lib/searchFilterState';
import type { StringKey } from '../../lib/i18n/index';
import type {
  AdvancedFilters,
  SearchCategory,
  SearchFeatureFilter,
  SearchSortBy,
  SearchWatchState,
} from '../../lib/useCombinedSearch';

interface SearchControlBarProps {
  filterType: SearchCategory;
  onFilterChange: (c: SearchCategory) => void;
  sortBy: SearchSortBy;
  onSortChange: (s: SearchSortBy) => void;
  filters: AdvancedFilters;
  onFiltersChange: (f: AdvancedFilters) => void;
  /** The music filters offered for this query; categories it leaves out are hidden. */
  offeredMusicFilters: string[] | null;
}

// Shorts second, as YouTube has it, so the tab people reach for most is never far.
const YOUTUBE_TABS: { key: SearchCategory; labelKey: StringKey }[] = [
  { key: 'all', labelKey: 'search_cat_all' },
  { key: 'shorts', labelKey: 'search_cat_shorts' },
  { key: 'videos', labelKey: 'search_cat_videos' },
  { key: 'live', labelKey: 'search_cat_live' },
  { key: 'movies', labelKey: 'search_cat_movies' },
  { key: 'playlists', labelKey: 'search_cat_playlists' },
  { key: 'artists', labelKey: 'search_cat_artists' },
];

const MUSIC_TABS: { key: SearchCategory; labelKey: StringKey }[] = [
  { key: 'songs', labelKey: 'search_cat_songs' },
  { key: 'albums', labelKey: 'search_cat_albums' },
  { key: 'podcasts', labelKey: 'search_cat_podcasts' },
  { key: 'episodes', labelKey: 'search_cat_episodes' },
];

export function SearchControlBar({
  filterType,
  onFilterChange,
  sortBy,
  onSortChange,
  filters,
  onFiltersChange,
  offeredMusicFilters,
}: SearchControlBarProps) {
  const shortsEnabled = useShortsEnabled();
  const musicEnabled = useMusicEnabled();
  // A tab YouTube Music doesn't offer for this query stays only while it is open.
  const shown = (key: SearchCategory) => {
    if (key === 'shorts') return shortsEnabled;
    if (MUSIC_ONLY_CATEGORIES.has(key) && !musicEnabled) return false;
    return key === filterType || isCategoryOffered(key, offeredMusicFilters);
  };
  const tabs = (list: typeof YOUTUBE_TABS) =>
    list.filter((tab) => shown(tab.key)).map((tab) => ({ key: tab.key, label: getString(tab.labelKey) }));
  const groups: UnderlineTabGroup<SearchCategory>[] = [
    { key: 'youtube', tabs: tabs(YOUTUBE_TABS) },
    {
      key: 'music',
      label: getString('search_tabs_music'),
      icon: <Music2 className="h-4 w-4" aria-hidden="true" />,
      tabs: tabs(MUSIC_TABS),
    },
  ].filter((group) => group.tabs.length > 0);

  // YouTube reorders by these two only; newest-first is the "Uploaded" filter.
  const sortOptions: { value: SearchSortBy; label: string }[] = [
    { value: 'relevance', label: getString('search_sort_relevance') },
    { value: 'views', label: getString('search_sort_views') },
  ];
  const uploadOptions: { value: AdvancedFilters['uploadDate']; label: string }[] = [
    { value: 'any', label: getString('search_uploaded_any') },
    { value: 'hour', label: getString('search_uploaded_hour') },
    { value: 'today', label: getString('search_uploaded_today') },
    { value: 'week', label: getString('search_uploaded_week') },
    { value: 'month', label: getString('search_uploaded_month') },
    { value: 'year', label: getString('search_uploaded_year') },
  ];
  const durationOptions: { value: AdvancedFilters['duration']; label: string }[] = [
    { value: 'any', label: getString('search_length_any') },
    { value: 'short', label: getString('search_length_short') },
    { value: 'medium', label: getString('search_length_medium') },
    { value: 'long', label: getString('search_length_long') },
  ];
  const featureOptions: { value: SearchFeatureFilter; label: string }[] = [
    { value: 'hd', label: getString('search_feature_hd') },
    { value: '4k', label: getString('search_feature_4k') },
    { value: 'subtitles', label: getString('search_feature_subtitles') },
    { value: 'creative_commons', label: getString('search_feature_creative_commons') },
    { value: 'hdr', label: getString('search_feature_hdr') },
    { value: '360', label: getString('search_feature_360') },
    { value: 'vr180', label: getString('search_feature_vr180') },
    { value: '3d', label: getString('search_feature_3d') },
    { value: 'location', label: getString('search_feature_location') },
  ];

  const showAdvanced = VIDEO_FILTER_CATEGORIES.has(filterType);
  const recent = filters.uploadDate === 'week';
  const toggleWatchState = (state: SearchWatchState) =>
    onFiltersChange({ ...filters, watchState: filters.watchState === state ? 'any' : state });
  const toggleFeature = (feature: SearchFeatureFilter) =>
    onFiltersChange({
      ...filters,
      features: filters.features.includes(feature)
        ? filters.features.filter((f) => f !== feature)
        : [...filters.features, feature],
    });

  return (
    <div className="sticky top-0 z-20 -mx-8 mb-6 flex flex-col gap-3 bg-background px-8 pb-3">
      <div className="-mx-8 border-b border-outline-variant px-8">
        <UnderlineTabs label={getString('search_tabs_label')} groups={groups} active={filterType} onChange={onFilterChange} />
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label={getString('search_sort_label')}
            value={sortBy}
            options={sortOptions}
            onChange={onSortChange}
          />
          <FilterSelect
            label={getString('search_uploaded_label')}
            value={filters.uploadDate}
            options={uploadOptions}
            onChange={(uploadDate) => onFiltersChange({ ...filters, uploadDate })}
          />
          <FilterSelect
            label={getString('search_length_label')}
            value={filters.duration}
            options={durationOptions}
            onChange={(duration) => onFiltersChange({ ...filters, duration })}
          />
        </div>
      )}

      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-2" aria-label={getString('search_feature_label')}>
          <Chip
            active={recent}
            aria-pressed={recent}
            onClick={() => onFiltersChange({ ...filters, uploadDate: recent ? 'any' : 'week' })}
          >
            {getString('search_filter_recently_uploaded')}
          </Chip>
          <Chip
            active={filters.watchState === 'unwatched'}
            aria-pressed={filters.watchState === 'unwatched'}
            onClick={() => toggleWatchState('unwatched')}
          >
            {getString('search_filter_unwatched')}
          </Chip>
          <Chip
            active={filters.watchState === 'watched'}
            aria-pressed={filters.watchState === 'watched'}
            onClick={() => toggleWatchState('watched')}
          >
            {getString('search_filter_watched')}
          </Chip>
          {featureOptions.map((option) => (
            <Chip
              key={option.value}
              active={filters.features.includes(option.value)}
              aria-pressed={filters.features.includes(option.value)}
              onClick={() => toggleFeature(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

export default SearchControlBar;
