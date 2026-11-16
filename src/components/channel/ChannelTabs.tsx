import React from "react";
import { X } from "lucide-react";
import { SearchInput } from "../ui/SearchInput";
import { UnderlineTabs } from "../ui/UnderlineTabs";
import { getString, type StringKey } from "../../lib/i18n/index";
import type { ChannelTab } from "../../types/video";

interface ChannelTabsProps {
  tabs: ChannelTab[];
  activeKind: string | null;
  onTabChange: (tab: ChannelTab) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSearchSubmit: () => void;
  onSearchClear: () => void;
}

const LABELS: Record<string, StringKey> = {
  home: "channel_tab_home",
  videos: "channel_tab_videos",
  shorts: "channel_tab_shorts",
  live: "channel_tab_live",
  podcasts: "channel_tab_podcasts",
  playlists: "channel_tab_playlists",
  releases: "channel_tab_releases",
  courses: "channel_tab_courses",
  posts: "channel_tab_posts",
};

function tabLabel(tab: ChannelTab): string {
  const key = LABELS[tab.kind];
  return key ? getString(key) : tab.title;
}

export const ChannelTabs: React.FC<ChannelTabsProps> = ({
  tabs,
  activeKind,
  onTabChange,
  searchQuery,
  onSearchQueryChange,
  onSearchSubmit,
  onSearchClear,
}) => (
  <div className="sticky top-0 z-40 w-full border-b border-chrome-neutral-800 bg-background">
    <div className="mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex h-14 items-center justify-between gap-4 overflow-x-auto">
        <UnderlineTabs
          fill
          className="min-w-0"
          label={getString("channel_tabs_label")}
          groups={[{ key: "tabs", tabs: tabs.map((tab) => ({ key: tab.kind, label: tabLabel(tab) })) }]}
          active={activeKind}
          onChange={(kind) => {
            const tab = tabs.find((candidate) => candidate.kind === kind);
            if (tab) onTabChange(tab);
          }}
        />

        <div className="flex shrink-0 items-center gap-1">
          <SearchInput
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearchSubmit();
            }}
            placeholder={getString("channel_search_placeholder")}
            containerClassName="w-40 sm:w-56"
            className="h-9 rounded-full"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label={getString("channel_search_clear")}
              onClick={onSearchClear}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-high"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
);
