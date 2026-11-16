import { useRef, useState } from 'react';
import { Music2, SlidersHorizontal, X } from 'lucide-react';
import { Chip } from '../ui/Chip';
import { FilterSelect } from '../ui/FilterSelect';
import { UnderlineTabs, type UnderlineTabGroup } from '../ui/UnderlineTabs';
import { SearchFilterPanel } from './SearchFilterPanel';
import { getString, type StringKey } from '../../lib/i18n/index';
import { isCategoryOffered } from '../../lib/searchResults';
import { activeFilters, SORT_OPTIONS } from '../../lib/searchFilterOptions';
import { useShortsEnabled } from '../../lib/useShortsContent';
import { useMusicEnabled } from '../../lib/useMusicContent';
import { DEFAULT_ADVANCED_FILTERS, MUSIC_ONLY_CATEGORIES, VIDEO_FILTER_CATEGORIES } from '../../lib/searchFilterState';
import type { AdvancedFilters, SearchCategory, SearchSortBy } from '../../lib/useCombinedSearch';

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

/** The result tabs, and under the video tabs the filters, sort and layout. */
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
  const [panelOpen, setPanelOpen] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const closePanel = () => {
    setPanelOpen(false);
    filtersButtonRef.current?.focus();
  };

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

  const filtered = VIDEO_FILTER_CATEGORIES.has(filterType);
  const active = activeFilters(filters);
  const sortOptions = SORT_OPTIONS.map((option) => ({ value: option.value, label: getString(option.labelKey) }));

  return (
    <div className="sticky top-0 z-20 -mx-8 mb-6 flex flex-col bg-background px-8">
      <div className="-mx-8 border-b border-outline-variant px-8">
        <UnderlineTabs label={getString('search_tabs_label')} groups={groups} active={filterType} onChange={onFilterChange} />
      </div>

      {filtered && (
        <div className="flex flex-col gap-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              ref={filtersButtonRef}
              type="button"
              aria-expanded={panelOpen}
              aria-controls="search-filter-panel"
              onClick={() => setPanelOpen((open) => !open)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                panelOpen
                  ? 'bg-chrome-neutral-100 text-background'
                  : 'bg-surface-container-high text-chrome-neutral-100 hover:bg-surface-container-highest'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {getString('search_filters_button')}
              {active.length > 0 && (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold tabular-nums text-on-primary">
                  {active.length}
                </span>
              )}
            </button>

            {active.map((filter) => (
              <Chip
                key={filter.key}
                active
                aria-label={getString('search_filters_remove', filter.label)}
                onClick={() => onFiltersChange(filter.without(filters))}
                className="gap-1 pe-2"
              >
                {filter.label}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Chip>
            ))}

            {active.length > 0 && (
              <button
                type="button"
                onClick={() => onFiltersChange(DEFAULT_ADVANCED_FILTERS)}
                className="rounded-full px-2 py-1 text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {getString('search_filters_clear_all')}
              </button>
            )}

            <div className="ms-auto flex items-center gap-2">
              <FilterSelect label={getString('search_sort_label')} value={sortBy} options={sortOptions} onChange={onSortChange} />
            </div>
          </div>

          {panelOpen && (
            <SearchFilterPanel filters={filters} onChange={onFiltersChange} onClose={closePanel} />
          )}
        </div>
      )}
    </div>
  );
}

export default SearchControlBar;
