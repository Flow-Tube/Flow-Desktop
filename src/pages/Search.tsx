import { useSearchParams } from "react-router-dom";
import type { VideoSummary } from "../types/video";
import { useCombinedSearch } from "../lib/useCombinedSearch";
import { currentFilterState, useSearchFilterMemory } from "../lib/useSearchFilterMemory";
import { SearchControlBar } from "../components/search/SearchControlBar";
import { SearchResults } from "../components/search/SearchResults";
import { SearchHome } from "../components/search/SearchHome";
import type { SearchLayout } from "../components/search/results/VideoResults";
import { usePreference } from "../lib/usePreference";
import { SETTINGS } from "../lib/settings/schema";

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
  const [storedLayout, setLayout] = usePreference(SETTINGS.SEARCH_RESULTS_LAYOUT);
  const layout: SearchLayout = storedLayout === "grid" ? "grid" : "list";

  return (
    <div className="grow overflow-y-auto">
      <div className="mx-auto w-full max-w-400 px-8 pb-20">
        {query.trim() ? (
          <>
            <SearchControlBar
              filterType={search.filterType}
              onFilterChange={(category) => changeFilters({ ...state, category })}
              sortBy={search.sortBy}
              onSortChange={(sortBy) => changeFilters({ ...state, sortBy })}
              filters={search.filters}
              onFiltersChange={(filters) => changeFilters({ ...state, filters })}
              offeredMusicFilters={search.offeredMusicFilters}
              layout={layout}
              onLayoutChange={setLayout}
            />
            <SearchResults
              search={{ ...search, setFilterType: (category) => changeFilters({ ...state, category }) }}
              layout={layout}
              onFiltersChange={(filters) => changeFilters({ ...state, filters })}
              onPlayVideo={onPlay}
              onAddToQueue={onAddToQueue}
            />
          </>
        ) : (
          <SearchHome />
        )}
      </div>
    </div>
  );
}

export default Search;
