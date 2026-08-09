import { CategoryChips } from '../layout/CategoryChips';
import { FilterSelect } from '../ui/FilterSelect';
import { getString } from '../../lib/i18n/index';
import type { StringKey } from '../../lib/i18n/index';
import type {
  AdvancedFilters,
  SearchCategory,
  SearchSortBy,
} from '../../lib/useCombinedSearch';

interface SearchControlBarProps {
  filterType: SearchCategory;
  onFilterChange: (c: SearchCategory) => void;
  sortBy: SearchSortBy;
  onSortChange: (s: SearchSortBy) => void;
  filters: AdvancedFilters;
  onFiltersChange: (f: AdvancedFilters) => void;
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
}: SearchControlBarProps) {
  const categories = CATEGORY_KEYS.map((c) => ({ key: c.key, label: getString(c.labelKey) }));
  const labels = categories.map((c) => c.label);
  const activeLabel = categories.find((c) => c.key === filterType)?.label ?? labels[0];

  const sortOptions: { value: SearchSortBy; label: string }[] = [
    { value: 'relevance', label: getString('search_sort_relevance') },
    { value: 'date', label: getString('search_sort_date') },
    { value: 'views', label: getString('search_sort_views') },
    { value: 'rating', label: getString('search_sort_rating') },
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
  const featureOptions: { value: AdvancedFilters['feature']; label: string }[] = [
    { value: 'any', label: getString('search_feature_any') },
    { value: 'hd', label: getString('search_feature_hd') },
    { value: '4k', label: getString('search_feature_4k') },
    { value: 'subtitles', label: getString('search_feature_subtitles') },
    { value: 'creative_commons', label: getString('search_feature_creative_commons') },
    { value: 'hdr', label: getString('search_feature_hdr') },
  ];

  const showAdvanced = filterType === 'videos' || filterType === 'live';
  // The Live category already consumes Innertube's single feature slot.
  const showFeatureFilter = filterType === 'videos';

  return (
    <div className="sticky top-0 z-10 mb-6 flex items-center justify-between gap-4 py-3">
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
          {showFeatureFilter && (
            <FilterSelect
              label={getString('search_feature_label')}
              value={filters.feature}
              options={featureOptions}
              onChange={(feature) => onFiltersChange({ ...filters, feature })}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default SearchControlBar;
