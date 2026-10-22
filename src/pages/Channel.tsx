import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { ChannelHero } from "../components/channel/ChannelHero";
import { ChannelTabs } from "../components/channel/ChannelTabs";
import { ChannelFilters } from "../components/channel/ChannelFilters";
import { ChannelHome } from "../components/channel/ChannelHome";
import { ChannelAboutDialog } from "../components/channel/ChannelAboutDialog";
import { ChannelShortsGrid, ChannelPlaylistsGrid, ChannelPostsFeed } from "../components/channel/ChannelGrids";
import {
  ChannelPageSkeleton,
  PlaylistsGridSkeleton,
  PostsFeedSkeleton,
  ShortsGridSkeleton,
} from "../components/channel/ChannelSkeletons";
import { Button } from "../components/ui/Button";
import { VideoGrid } from "../components/video/VideoGrid";
import { getString } from "../lib/i18n/index";
import { itemsOfLayout, layoutForKind, tabForSection, visibleTabs, type ChannelLayout } from "../lib/channelPage";
import { useChannelFeed, type ChannelFeedRequest } from "../lib/useChannelFeed";
import { useChannelPage } from "../lib/useChannelPage";
import { useChannelWatched } from "../lib/useChannelWatched";
import { useInfiniteScroll } from "../lib/useInfiniteScroll";
import { usePublishTitle } from "../lib/usePublishTitle";
import type {
  ChannelFilterOption,
  ChannelItem,
  ChannelSection,
  ChannelTab,
  PlaylistSummary,
  PostSummary,
  ShortVideoSummary,
  VideoItemSummary,
  VideoSummary,
} from "../types/video";

interface ChannelProps {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}

/** The tab a view belongs to, and what to load for it; Home's `request` is null. */
interface ChannelView {
  kind: string;
  request: ChannelFeedRequest | null;
}

const HOME: ChannelView = { kind: "home", request: null };

function TabSkeleton({ layout, onPlay }: { layout: ChannelLayout; onPlay: (video: VideoSummary) => void }) {
  switch (layout) {
    case "shorts":
      return <ShortsGridSkeleton />;
    case "playlists":
      return <PlaylistsGridSkeleton />;
    case "posts":
      return <PostsFeedSkeleton />;
    default:
      return <VideoGrid loading={true} skeletonCount={8} onPlay={onPlay} />;
  }
}

function TabItems({
  layout,
  items,
  onPlay,
  onAddToQueue,
}: {
  layout: ChannelLayout;
  items: ChannelItem[];
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}) {
  switch (layout) {
    case "shorts":
      return <ChannelShortsGrid shorts={itemsOfLayout<ShortVideoSummary>(items, "shorts")} />;
    case "playlists":
      return <ChannelPlaylistsGrid playlists={itemsOfLayout<PlaylistSummary>(items, "playlists")} />;
    case "posts":
      return <ChannelPostsFeed posts={itemsOfLayout<PostSummary>(items, "posts")} />;
    default:
      return (
        <VideoGrid
          videos={itemsOfLayout<VideoItemSummary>(items, "videos")}
          onPlay={onPlay}
          onAddToQueue={onAddToQueue}
          hideChannelAvatar={true}
        />
      );
  }
}

const EmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-chrome-neutral-800 p-6 py-20 text-center text-sm font-medium text-chrome-neutral-500">
    {children}
  </div>
);

export const Channel: React.FC<ChannelProps> = ({ onPlay, onAddToQueue }) => {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const { page, loading, failed, retry } = useChannelPage(channelId);
  const details = page?.details ?? null;
  usePublishTitle(details?.name);

  const [view, setView] = useState<ChannelView>(HOME);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    setView(HOME);
    setSearchQuery("");
    setActiveSearch("");
    setAboutOpen(false);
  }, [channelId]);

  const tabs = useMemo(() => visibleTabs(details?.tabs ?? []), [details]);
  const request: ChannelFeedRequest | null = activeSearch
    ? { key: `q:${activeSearch}`, query: activeSearch }
    : view.request;
  const feed = useChannelFeed(channelId, request, page?.home ?? null);
  const isHome = !activeSearch && view.kind === "home";
  const layout = activeSearch ? "videos" : layoutForKind(view.kind);
  const watched = useChannelWatched(channelId, isHome && !!details);
  const sentinelRef = useInfiniteScroll({
    hasNextPage: !isHome && !!feed.feed?.nextPageToken,
    isLoading: feed.loading || feed.loadingMore,
    onLoadMore: feed.loadMore,
  });

  const openTab = useCallback((tab: ChannelTab) => {
    setSearchQuery("");
    setActiveSearch("");
    setView(
      tab.kind === "home" || !tab.params
        ? HOME
        : { kind: tab.kind, request: { key: `p:${tab.params}`, params: tab.params } },
    );
  }, []);

  const canSeeAll = useCallback(
    (section: ChannelSection) => !!section.more?.playlistId || !!tabForSection(section, tabs),
    [tabs],
  );

  const openSeeAll = useCallback(
    (section: ChannelSection) => {
      const playlistId = section.more?.playlistId;
      if (playlistId) {
        navigate(`/playlist/${playlistId}`);
        return;
      }
      const tab = tabForSection(section, tabs);
      const params = section.more?.params;
      if (!tab || !params) return;
      setView({ kind: tab.kind, request: { key: `p:${params}`, params } });
    },
    [navigate, tabs],
  );

  const selectFilter = useCallback((option: ChannelFilterOption) => {
    setView((current) => {
      if (option.continuation) {
        return { ...current, request: { key: `c:${option.continuation}`, continuation: option.continuation } };
      }
      if (option.params) return { ...current, request: { key: `p:${option.params}`, params: option.params } };
      return current;
    });
  }, []);

  const closeAbout = useCallback(() => setAboutOpen(false), []);

  if (loading && !details) return <ChannelPageSkeleton />;

  if (failed || !details) {
    return (
      <div className="flex flex-grow flex-col items-center justify-center gap-4 bg-background px-6 py-24 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-chrome-neutral-100">
          {getString("channel_unavailable_title")}
        </h2>
        <p className="max-w-md text-sm text-chrome-neutral-400">{getString("channel_unavailable_body")}</p>
        <Button variant="secondary" onClick={retry}>
          {getString("retry")}
        </Button>
      </div>
    );
  }

  const submitSearch = () => {
    if (searchQuery.trim()) setActiveSearch(searchQuery.trim());
  };
  const clearSearch = () => {
    setSearchQuery("");
    setActiveSearch("");
  };
  const items = feed.feed?.items ?? [];

  return (
    <div className="relative flex-grow bg-background pb-24">
      <ChannelHero channelInfo={details} onOpenAbout={details.aboutToken ? () => setAboutOpen(true) : undefined} />

      <ChannelTabs
        tabs={tabs}
        activeKind={activeSearch ? null : view.kind}
        onTabChange={openTab}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSearchSubmit={submitSearch}
        onSearchClear={clearSearch}
      />

      <div className="mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {activeSearch && (
          <div className="mb-6 flex items-center justify-between border-b border-chrome-neutral-800 pb-3">
            <h2 className="text-base font-semibold text-chrome-neutral-200">
              {getString("channel_search_results", activeSearch)}
            </h2>
            <button
              type="button"
              onClick={clearSearch}
              className="flex items-center gap-1 rounded-full border border-chrome-neutral-800 bg-surface-container-low px-2.5 py-1 text-xs font-medium text-chrome-neutral-400 transition-colors hover:text-chrome-neutral-200"
            >
              <X size={12} /> {getString("channel_search_clear")}
            </button>
          </div>
        )}

        {!isHome && feed.feed && <ChannelFilters groups={feed.feed.filters} onSelect={selectFilter} />}

        {feed.loading ? (
          <TabSkeleton layout={layout} onPlay={onPlay} />
        ) : feed.failed ? (
          <EmptyState>
            {getString("channel_tab_error")}
            <Button variant="secondary" onClick={feed.retry}>
              {getString("retry")}
            </Button>
          </EmptyState>
        ) : isHome ? (
          <ChannelHome
            sections={feed.feed?.sections ?? []}
            watched={watched}
            canSeeAll={canSeeAll}
            onSeeAll={openSeeAll}
            onPlay={onPlay}
            onAddToQueue={onAddToQueue}
          />
        ) : items.length === 0 ? (
          <EmptyState>
            {activeSearch ? getString("channel_search_empty", activeSearch) : getString("channel_tab_empty")}
          </EmptyState>
        ) : (
          <TabItems layout={layout} items={items} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        )}

        <div ref={sentinelRef} aria-hidden="true" />
        {feed.loadingMore && (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-[var(--color-primary)]" size={24} />
          </div>
        )}
      </div>

      <ChannelAboutDialog channel={details} open={aboutOpen} onClose={closeAbout} />
    </div>
  );
};

export default Channel;
