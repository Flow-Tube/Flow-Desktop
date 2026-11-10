import { useSearchParams } from "react-router-dom";
import type { VideoSummary } from "../types/video";
import { useCombinedSearch } from "../lib/useCombinedSearch";
import { currentFilterState, useSearchFilterMemory } from "../lib/useSearchFilterMemory";
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
  const changeFilters = useSearchFilterMemory(search, query);
  const state = currentFilterState(search);

  return (
    <div className="grow overflow-y-auto">
      <div className="mx-auto w-full max-w-400 px-8 pb-20">
        <SearchControlBar
          filterType={search.filterType}
          onFilterChange={(category) => changeFilters({ ...state, category })}
          sortBy={search.sortBy}
          onSortChange={(sortBy) => changeFilters({ ...state, sortBy })}
          filters={search.filters}
          onFiltersChange={(filters) => changeFilters({ ...state, filters })}
          offeredMusicFilters={search.offeredMusicFilters}
        />
        <SearchResults
          search={{ ...search, setFilterType: (category) => changeFilters({ ...state, category }) }}
          onPlayVideo={onPlay}
          onAddToQueue={onAddToQueue}
        />
      </div>
    </div>
  );
}

export default Search;
