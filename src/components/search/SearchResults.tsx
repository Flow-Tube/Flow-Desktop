import { useInfiniteScroll } from '../../lib/useInfiniteScroll';
import { getString } from '../../lib/i18n/index';
import { useVisibleSearchResults } from '../../lib/useVisibleSearchResults';
import type { CombinedSearchResults, UseCombinedSearchReturn } from '../../lib/useCombinedSearch';
import type { VideoSummary } from '../../types/video';
import { AllResults } from './results/AllResults';
import { ResultsSkeleton } from './results/ResultsSkeleton';
import { SearchEmptyState } from './results/SearchEmptyState';
import { TabResults } from './results/TabResults';
import { useResultActions } from './results/useResultActions';

interface SearchResultsProps {
  search: UseCombinedSearchReturn;
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
      r.videoPlaylists.length ||
      r.albums.length ||
      r.playlists.length ||
      r.artists.length ||
      r.podcasts.length ||
      r.episodes.length,
  );
}

export function SearchResults({ search, onPlayVideo, onAddToQueue }: SearchResultsProps) {
  const visible = useVisibleSearchResults(search);
  const actions = useResultActions();
  const { filterType, isLoading, isFetchingNextPage, error, query } = search;
  const sentinelRef = useInfiniteScroll({
    hasNextPage: search.hasNextPage,
    isLoading: isLoading || isFetchingNextPage,
    onLoadMore: search.fetchNextPage,
  });
  const hasAny = hasAnyResult(visible.results, Boolean(visible.creator));

  if (!query) {
    return <SearchEmptyState title={getString('search_empty_title')} body={getString('search_empty_body')} />;
  }
  if (isLoading && !hasAny) return <ResultsSkeleton filterType={filterType} />;
  if (error && !hasAny) return <SearchEmptyState title={getString('search_error_title')} body={error} tone="error" />;
  if (!hasAny) {
    return <SearchEmptyState title={getString('search_no_results_title', query)} body={getString('search_no_results_body')} />;
  }

  return filterType === 'all' ? (
    <AllResults search={search} visible={visible} actions={actions} onPlayVideo={onPlayVideo} onAddToQueue={onAddToQueue} />
  ) : (
    <TabResults
      search={search}
      visible={visible}
      actions={actions}
      sentinelRef={sentinelRef}
      onPlayVideo={onPlayVideo}
      onAddToQueue={onAddToQueue}
    />
  );
}

export default SearchResults;
