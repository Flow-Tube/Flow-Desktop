import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CategoryChips } from "../components/layout/CategoryChips";
import { SearchInput } from "../components/ui/SearchInput";
import { Select } from "../components/ui/Select";
import { ShortCard } from "../components/shorts/ShortCard";
import { ShortsIcon } from "../components/ui/ShortsIcon";
import { getString } from "../lib/i18n/index";
import { useGridStyle } from "../lib/useGridColumns";
import {
  loadSavedShorts,
  SAVED_SHORTS_LIBRARY_UPDATED_EVENT,
} from "../lib/savedShortsLibrary";
import type { ShortVideoSummary } from "../types/video";

type ShortsFilter = "All" | "Channels";
type ShortsSort = "Recently Saved" | "A-Z";

const FILTERS: ShortsFilter[] = ["All", "Channels"];
const SORTS: ShortsSort[] = ["Recently Saved", "A-Z"];

export const SavedShorts: React.FC = () => {
  const gridStyle = useGridStyle({ density: "dense" });
  const [shorts, setShorts] = useState<ShortVideoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<ShortsFilter>("All");
  const [sort, setSort] = useState<ShortsSort>("Recently Saved");

  const refresh = async () => {
    setLoading(true);
    try {
      setShorts(await loadSavedShorts());
    } catch (error) {
      console.warn("Failed to load saved Shorts", error);
      setShorts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    window.addEventListener(SAVED_SHORTS_LIBRARY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SAVED_SHORTS_LIBRARY_UPDATED_EVENT, refresh);
  }, []);

  const visibleShorts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return shorts
      .filter((short) => {
        if (filter === "Channels" && !short.channelName) return false;
        if (!query) return true;
        return [short.title, short.channelName ?? ""].some((value) => (
          value.toLowerCase().includes(query)
        ));
      })
      .sort((a, b) => {
        if (sort === "A-Z") return a.title.localeCompare(b.title);
        return 0;
      });
  }, [filter, searchQuery, shorts, sort]);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="space-y-6 pb-20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">
              {getString("saved_shorts_title")}
            </h1>
            <p className="mt-1 text-sm text-chrome-neutral-400">
              {getString("saved_shorts_subtitle")}
            </p>
          </div>

          <SearchInput
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={getString("saved_shorts_search")}
            containerClassName="w-full sm:w-72"
          />
        </div>

        <div className="mt-6 mb-6 flex flex-col gap-4 md:flex-row md:items-center">
          <Select
            value={sort}
            onChange={(value) => setSort(value as ShortsSort)}
            options={SORTS.map((option) => ({ value: option, label: option }))}
            className="w-full md:w-52"
          />

          <CategoryChips
            categories={FILTERS}
            activeCategory={filter}
            onCategoryChange={(category) => {
              if (FILTERS.includes(category as ShortsFilter)) {
                setFilter(category as ShortsFilter);
              }
            }}
            sticky={false}
            className="py-0"
          />
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-32">
            <Loader2 className="animate-spin text-[var(--color-primary)]" size={36} />
            <p className="text-sm font-medium text-chrome-neutral-500">
              {getString("saved_shorts_loading")}
            </p>
          </div>
        ) : shorts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 py-24 text-center">
            <ShortsIcon className="mb-4 h-12 w-12 text-chrome-neutral-600" />
            <h3 className="font-medium text-chrome-neutral-200">
              {getString("saved_shorts_empty_title")}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
              {getString("saved_shorts_empty_body")}
            </p>
          </div>
        ) : visibleShorts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 py-20 text-center">
            <ShortsIcon className="mb-4 h-11 w-11 text-chrome-neutral-600" />
            <h3 className="font-medium text-chrome-neutral-200">
              {getString("saved_shorts_no_match_title")}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
              {getString("saved_shorts_no_match_body")}
            </p>
          </div>
        ) : (
          <div className="flow-grid gap-y-4" style={gridStyle}>
            {visibleShorts.map((short) => (
              <ShortCard
                key={short.id}
                short={short}
                queue={visibleShorts}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SavedShorts;
