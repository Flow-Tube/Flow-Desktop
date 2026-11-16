import { useInfiniteScroll } from '../../lib/useInfiniteScroll';
import { useVisibleSearchResults } from '../../lib/useVisibleSearchResults';
import type { AdvancedFilters, CombinedSearchResults, UseCombinedSearchReturn } from '../../lib/useCombinedSearch';
import type { VideoSummary } from '../../types/video';
import { AllResults } from './results/AllResults';
import { ResultsSkeleton } from './results/ResultsSkeleton';
import { SearchFailure, SearchNoResults } from './results/SearchEmptyState';
import { VIDEO_FILTER_CATEGORIES } from '../../lib/searchFilterState';
import { TabResults } from './results/TabResults';
import type { SearchLayout } from './results/VideoResults';
import { useResultActions } from './results/useResultActions';

interface SearchResultsProps {
  search: UseCombinedSearchReturn;
  layout: SearchLayout;
  onFiltersChange: (filters: AdvancedFilters) => void;
  onPlayVideo: (v: VideoSummary) => void;
  onAddToQueue: (v: VideoSummary) => void;
}

function hasAnyResult(r: CombinedSearchResults, hasCreator: boolean): boolean {
  return Boolean(
    hasCreator ||
      r.topResult ||
      r.songs.length ||
      r.videos.length ||
      r.live.length ||
      r.channels.length ||
      r.shorts.length ||
      r.shelves.length ||
      r.shortsShelves.length ||
      r.postShelves.length ||
      r.videoPlaylists.length ||
      r.albums.length ||
      r.playlists.length ||
      r.artists.length ||
      r.podcasts.length ||
      r.episodes.length,
  );
}

export function SearchResults({ search, layout, onFiltersChange, onPlayVideo, onAddToQueue }: SearchResultsProps) {
  const visible = useVisibleSearchResults(search);
  const actions = useResultActions();
  const { filterType, isLoading, isFetchingNextPage, error, query } = search;
  const sentinelRef = useInfiniteScroll({
    // A failed page waits for Retry instead of being asked for again as soon as it scrolls into view.
    hasNextPage: search.hasNextPage && !error,
    isLoading: isLoading || isFetchingNextPage,
    onLoadMore: search.fetchNextPage,
  });
  const hasAny = hasAnyResult(visible.results, Boolean(visible.creator));

  // Until a changed search is sent, an empty page means "not asked yet", not "nothing found".
  if ((isLoading || search.isSettling) && !hasAny) return <ResultsSkeleton filterType={filterType} layout={layout} />;
  if (error && !hasAny) return <SearchFailure kind={search.errorKind} message={error} onRetry={search.refetch} />;
  if (!hasAny) {
    return (
      <SearchNoResults
        query={query}
        filters={VIDEO_FILTER_CATEGORIES.has(filterType) ? search.filters : null}
        onFiltersChange={onFiltersChange}
      />
    );
  }

  return filterType === 'all' ? (
    <AllResults search={search} visible={visible} actions={actions} onPlayVideo={onPlayVideo} onAddToQueue={onAddToQueue} />
  ) : (
    <TabResults
      search={search}
      visible={visible}
      actions={actions}
      sentinelRef={sentinelRef}
      layout={layout}
      onPlayVideo={onPlayVideo}
      onAddToQueue={onAddToQueue}
    />
  );
}

export default SearchResults;
