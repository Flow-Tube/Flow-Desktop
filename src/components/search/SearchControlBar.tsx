import { CategoryChips } from '../layout/CategoryChips';
import { Chip } from '../ui/Chip';
import { FilterSelect } from '../ui/FilterSelect';
import { getString } from '../../lib/i18n/index';
import { isCategoryOffered } from '../../lib/searchResults';
import type { StringKey } from '../../lib/i18n/index';
import type {
  AdvancedFilters,
  SearchCategory,
  SearchFeatureFilter,
  SearchSortBy,
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

const CATEGORY_KEYS: { key: SearchCategory; labelKey: StringKey }[] = [
  { key: 'all', labelKey: 'search_cat_all' },
  { key: 'videos', labelKey: 'search_cat_videos' },
  { key: 'live', labelKey: 'search_cat_live' },
  { key: 'songs', labelKey: 'search_cat_songs' },
  { key: 'albums', labelKey: 'search_cat_albums' },
  { key: 'playlists', labelKey: 'search_cat_playlists' },
  { key: 'artists', labelKey: 'search_cat_artists' },
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
  const categories = CATEGORY_KEYS.filter(
    (c) => c.key === filterType || isCategoryOffered(c.key, offeredMusicFilters),
  ).map((c) => ({ key: c.key, label: getString(c.labelKey) }));
  const labels = categories.map((c) => c.label);
  const activeLabel = categories.find((c) => c.key === filterType)?.label ?? labels[0];

  // YouTube reorders by these two only; newest-first is the "Uploaded" filter.
  const sortOptions: { value: SearchSortBy; label: string }[] = [
    { value: 'relevance', label: getString('search_sort_relevance') },
    { value: 'views', label: getString('search_sort_views') },
  ];
  const typeOptions: { value: AdvancedFilters['contentType']; label: string }[] = [
    { value: 'any', label: getString('search_type_any') },
    { value: 'video', label: getString('search_type_video') },
    { value: 'shorts', label: getString('search_type_shorts') },
    { value: 'movie', label: getString('search_type_movie') },
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
  ];

  const showAdvanced = filterType === 'videos' || filterType === 'live';
  const toggleFeature = (feature: SearchFeatureFilter) =>
    onFiltersChange({
      ...filters,
      features: filters.features.includes(feature)
        ? filters.features.filter((f) => f !== feature)
        : [...filters.features, feature],
    });

  return (
    <div className="sticky top-0 z-10 mb-6 flex flex-col gap-3 py-3">
      <div className="flex items-center justify-between gap-4">
        {/* Category filter (left) */}
        <CategoryChips
          sticky={false}
          className="min-w-0 flex-1 !py-0"
          categories={labels}
          activeCategory={activeLabel}
          onCategoryChange={(label) => {
            const next = categories.find((c) => c.label === label);
            if (next) onFilterChange(next.key);
          }}
        />

        {/* Advanced filters (right) */}
        {showAdvanced && (
          <div className="flex shrink-0 items-center gap-2">
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
            {filterType === 'videos' && (
              <FilterSelect
                label={getString('search_type_label')}
                value={filters.contentType}
                options={typeOptions}
                onChange={(contentType) => onFiltersChange({ ...filters, contentType })}
              />
            )}
          </div>
        )}
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-2" aria-label={getString('search_feature_label')}>
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
