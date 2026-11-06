import { LayoutGrid, List } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import type { LengthFilter, LocalSort, QualityFilter } from "../../lib/localMedia/filters";
import { useBoolPref } from "../../lib/usePreference";
import { SETTINGS } from "../../lib/settings/schema";
import { useLocalMediaStore } from "../../store/useLocalMediaStore";
import { Chip } from "../ui/Chip";
import { FilterSelect } from "../ui/FilterSelect";
import { IconButton } from "../ui/IconButton";

/** The controls under the search field. Video-only filters are left out on the Music tab. */
export function LocalMediaFilterBar() {
  const kind = useLocalMediaStore((s) => s.kind);
  const view = useLocalMediaStore((s) => s.view);
  const filters = useLocalMediaStore((s) => s.filters);
  const setView = useLocalMediaStore((s) => s.setView);
  const updateFilters = useLocalMediaStore((s) => s.updateFilters);
  const [asGrid, setAsGrid] = useBoolPref(SETTINGS.LOCAL_MEDIA_VIDEOS_AS_GRID);
  const isVideos = kind === "video";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip active={view === "all"} onClick={() => setView("all")}>
        {getString("local_view_all")}
      </Chip>
      <Chip active={view === "folders"} onClick={() => setView("folders")}>
        {getString("local_view_folders")}
      </Chip>
      <FilterSelect<LocalSort>
        label={getString("local_sort_label")}
        value={filters.sort}
        onChange={(sort) => updateFilters({ sort })}
        options={[
          { value: "dateAdded", label: getString("local_sort_date_added") },
          { value: "name", label: getString("local_sort_name") },
          { value: "length", label: getString("local_sort_length") },
          { value: "size", label: getString("local_sort_size") },
          { value: "recentlyPlayed", label: getString("local_sort_recently_played") },
        ]}
      />
      <FilterSelect<LengthFilter>
        label={getString("local_filter_length_label")}
        value={filters.length}
        onChange={(length) => updateFilters({ length })}
        options={[
          { value: "any", label: getString("local_filter_length_any") },
          { value: "short", label: getString("local_filter_length_short") },
          { value: "medium", label: getString("local_filter_length_medium") },
          { value: "long", label: getString("local_filter_length_long") },
        ]}
      />
      {isVideos && (
        <>
          <FilterSelect<QualityFilter>
            label={getString("local_filter_quality_label")}
            value={filters.quality}
            onChange={(quality) => updateFilters({ quality })}
            options={[
              { value: "any", label: getString("local_filter_quality_any") },
              { value: "sd", label: getString("local_filter_quality_sd") },
              { value: "hd", label: getString("local_filter_quality_hd") },
              { value: "fullHd", label: getString("local_filter_quality_full_hd") },
              { value: "uhd", label: getString("local_filter_quality_4k") },
            ]}
          />
          <Chip active={filters.unwatchedOnly} onClick={() => updateFilters({ unwatchedOnly: !filters.unwatchedOnly })}>
            {getString("local_filter_unwatched")}
          </Chip>
          <Chip active={filters.portraitOnly} onClick={() => updateFilters({ portraitOnly: !filters.portraitOnly })}>
            {getString("local_filter_portrait")}
          </Chip>
          <IconButton
            type="button"
            onClick={() => setAsGrid(!asGrid)}
            aria-label={getString(asGrid ? "local_list_view" : "local_grid_view")}
            title={getString(asGrid ? "local_list_view" : "local_grid_view")}
            className="ml-auto"
          >
            {asGrid ? <List size={18} /> : <LayoutGrid size={18} />}
          </IconButton>
        </>
      )}
    </div>
  );
}
