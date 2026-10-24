import { useSearchParams } from "react-router-dom";
import type { VideoSummary } from "../types/video";
import { useCombinedSearch } from "../lib/useCombinedSearch";
import { SearchControlBar } from "../components/search/SearchControlBar";
import { SearchResults } from "../components/search/SearchResults";

interface SearchProps {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}


export function Search({ onPlay, onAddToQueue }: SearchProps) {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";

  const search = useCombinedSearch({ query });

  return (
    <div className="grow overflow-y-auto">
      <div className="mx-auto w-full max-w-400 px-8 pb-20">
        <SearchControlBar
          filterType={search.filterType}
          onFilterChange={search.setFilterType}
          sortBy={search.sortBy}
          onSortChange={search.setSortBy}
          filters={search.filters}
          onFiltersChange={search.setFilters}
          offeredMusicFilters={search.offeredMusicFilters}
        />
        <SearchResults
          search={search}
          onPlayVideo={onPlay}
          onAddToQueue={onAddToQueue}
        />
      </div>
    </div>
  );
}

export default Search;
