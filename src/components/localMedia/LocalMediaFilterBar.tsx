import { getString } from "../../lib/i18n/index";
import type { LengthFilter, LocalSort, QualityFilter } from "../../lib/localMedia/filters";
import { useLocalMediaStore } from "../../store/useLocalMediaStore";
import { Chip } from "../ui/Chip";
import { Select } from "../ui/Select";

/** The dropdowns, then the chips, on one line as on Playlists. Video-only filters are left out on the Music tab. */
export function LocalMediaFilterBar() {
  const kind = useLocalMediaStore((s) => s.kind);
  const view = useLocalMediaStore((s) => s.view);
  const filters = useLocalMediaStore((s) => s.filters);
  const setView = useLocalMediaStore((s) => s.setView);
  const updateFilters = useLocalMediaStore((s) => s.updateFilters);
  const isVideos = kind === "video";

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center">
      <Select
        value={filters.sort}
        onChange={(sort) => updateFilters({ sort: sort as LocalSort })}
        className="w-full md:w-44"
        options={[
          { value: "dateAdded", label: getString("local_sort_date_added") },
          { value: "name", label: getString("local_sort_name") },
          { value: "length", label: getString("local_sort_length") },
          { value: "size", label: getString("local_sort_size") },
          { value: "recentlyPlayed", label: getString("local_sort_recently_played") },
        ]}
      />
      <Select
        value={filters.length}
        onChange={(length) => updateFilters({ length: length as LengthFilter })}
        className="w-full md:w-44"
        options={[
          { value: "any", label: getString("local_filter_length_any") },
          { value: "short", label: getString("local_filter_length_short") },
          { value: "medium", label: getString("local_filter_length_medium") },
          { value: "long", label: getString("local_filter_length_long") },
        ]}
      />
      {isVideos && (
        <Select
          value={filters.quality}
          onChange={(quality) => updateFilters({ quality: quality as QualityFilter })}
          className="w-full md:w-44"
          options={[
            { value: "any", label: getString("local_filter_quality_any") },
            { value: "sd", label: getString("local_filter_quality_sd") },
            { value: "hd", label: getString("local_filter_quality_hd") },
            { value: "fullHd", label: getString("local_filter_quality_full_hd") },
            { value: "uhd", label: getString("local_filter_quality_4k") },
          ]}
        />
      )}
      <div className="flex items-center gap-3 overflow-x-auto">
        <Chip active={view === "all"} onClick={() => setView("all")}>
          {getString("local_view_all")}
        </Chip>
        <Chip active={view === "folders"} onClick={() => setView("folders")}>
          {getString("local_view_folders")}
        </Chip>
        {isVideos && (
          <>
            <Chip active={filters.unwatchedOnly} onClick={() => updateFilters({ unwatchedOnly: !filters.unwatchedOnly })}>
              {getString("local_filter_unwatched")}
            </Chip>
            <Chip active={filters.portraitOnly} onClick={() => updateFilters({ portraitOnly: !filters.portraitOnly })}>
              {getString("local_filter_portrait")}
            </Chip>
          </>
        )}
      </div>
    </div>
  );
}
