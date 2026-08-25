import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { getChannelDetails, getChannelTab } from "../lib/api/youtube";
import type { ChannelDetails, ChannelItem } from "../types/video";
import { ChannelHero } from "../components/channel/ChannelHero";
import { Button } from "../components/ui/Button";
import { ChannelTabs, TabId } from "../components/channel/ChannelTabs";
import { 
  ChannelShortsGrid, 
  ChannelPlaylistsGrid, 
  ChannelPostsFeed 
} from "../components/channel/ChannelGrids";
import { VideoGrid } from "../components/video/VideoGrid";
import type { VideoSummary, VideoItemSummary, ShortVideoSummary, PlaylistSummary, PostSummary } from "../types/video";
import { VideoShelf } from "../components/shelf/VideoShelf";
import { ShortsShelf } from "../components/shelf/ShortsShelf";
import { PlaylistShelf } from "../components/shelf/PlaylistShelf";
import { PostShelf } from "../components/shelf/PostShelf";
import { getWatchHistory } from "../lib/api/db";
import { usePublishTitle } from "../lib/usePublishTitle";
import { getString } from "../lib/i18n/index";
import { useGridStyle } from "../lib/useGridColumns";

interface ChannelProps {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}

const TAB_PARAMS: Record<TabId, string | undefined> = {
  home: undefined,
  videos: "EgZ2aWRlb3PyBgQKAjoA",
  shorts: "EgZzaG9ydHPyBgUKA5oBAA==",
  live: "EgdzdHJlYW1z8gYECgJ6AA==",
  podcasts: "Eghwb2RjYXN0c_IGBQoDugEA",
  playlists: "EglwbGF5bGlzdHPyBgQKAkIA",
  posts: "EgVwb3N0c_IGBAoCSgA=",
};

const SORT_PARAMS = {
  latest: "EgZ2aWRlb3PyBgQKAjoA",
  popular: "EgZ2aWRlb3MYASAAMAE=",
  oldest: "EgZ2aWRlb3MYAiAAMAE=",
};

type SortFilterId = "latest" | "popular" | "oldest";

// --- SKELETON LOADERS ---

function ChannelPageSkeleton() {
  const gridStyle = useGridStyle();
  return (
    <div className="flex-grow pb-24 bg-background relative animate-pulse">
      {/* Banner Skeleton */}
      <div className="relative w-full h-48 md:h-64 bg-chrome-zinc-900" />
      
      {/* Profile Block Skeleton */}
      <div className=" mx-auto w-full px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 relative z-10">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
            {/* Overlapping Avatar Skeleton */}
            <div className="w-32 h-32 rounded-full bg-chrome-zinc-800 border-4 border-background shrink-0 -mt-16" />
            
            {/* Metadata Skeletons */}
            <div className="text-center md:text-left space-y-3 mt-4 md:mt-0 pb-2">
              <div className="h-8 w-48 bg-chrome-zinc-800 rounded-lg mx-auto md:mx-0" />
              <div className="h-4 w-32 bg-chrome-zinc-800 rounded mx-auto md:mx-0" />
            </div>
          </div>
          
          {/* Action Row Button Skeleton */}
          <div className="w-32 h-10 bg-chrome-zinc-800 rounded-full shrink-0 mb-2 mx-auto md:mx-0" />
        </div>
      </div>

      {/* Tabs Row Skeleton */}
      <div className="w-full bg-chrome-zinc-900/50 border-b border-chrome-zinc-800 h-14" />

      {/* Grid Content Skeleton */}
      <div className=" mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flow-grid gap-y-8 pb-8" style={gridStyle}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="w-full aspect-video rounded-xl bg-chrome-zinc-800" />
              <div className="flex items-start gap-3 px-1">
                <div className="w-9 h-9 rounded-full bg-chrome-zinc-800 shrink-0" />
                <div className="flex flex-col gap-2 w-full pt-1">
                  <div className="h-4 w-3/4 bg-chrome-zinc-800 rounded" />
                  <div className="h-3 w-1/2 bg-chrome-zinc-800 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShortsGridSkeleton() {
  const gridStyle = useGridStyle({ density: "dense" });
  return (
    <div className="flow-grid gap-y-4" style={gridStyle}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="relative w-full aspect-[9/16] rounded-xl bg-chrome-zinc-800 animate-pulse border border-chrome-zinc-800/50" />
          <div className="h-4 w-3/4 bg-chrome-zinc-800 rounded animate-pulse mt-1" />
        </div>
      ))}
    </div>
  );
}

function PlaylistsGridSkeleton() {
  const gridStyle = useGridStyle({ gapRem: 1.5 });
  return (
    <div className="flow-grid gap-y-6" style={gridStyle}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="relative w-full aspect-video rounded-xl mt-3 bg-chrome-zinc-800 animate-pulse border border-chrome-zinc-800/50">
            <div className="absolute -top-1.5 left-2 right-2 h-2 bg-chrome-zinc-800/60 rounded-t-xl" />
            <div className="absolute -top-3 left-4 right-4 h-2 bg-chrome-zinc-800/40 rounded-t-xl" />
          </div>
          <div className="flex flex-col gap-2 mt-1">
            <div className="h-4 w-5/6 bg-chrome-zinc-800 rounded animate-pulse" />
            <div className="h-3 w-1/3 bg-chrome-zinc-800 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PostsFeedSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="w-full bg-chrome-zinc-900/40 border border-chrome-zinc-800/60 rounded-2xl p-4 sm:p-5 shadow-sm animate-pulse">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-chrome-zinc-800 shrink-0" />
            <div className="flex flex-col gap-2">
              <div className="h-4 w-24 bg-chrome-zinc-800 rounded" />
              <div className="h-3 w-16 bg-chrome-zinc-800 rounded" />
            </div>
          </div>
          <div className="pl-[52px] space-y-3">
            <div className="h-4 w-full bg-chrome-zinc-800 rounded" />
            <div className="h-4 w-5/6 bg-chrome-zinc-800 rounded" />
            <div className="h-4 w-2/3 bg-chrome-zinc-800 rounded" />
            <div className="flex items-center gap-2 mt-4 pt-2">
              <div className="h-8 w-24 bg-chrome-zinc-800 rounded-full" />
              <div className="h-8 w-16 bg-chrome-zinc-800 rounded-full" />
              <div className="h-8 w-16 bg-chrome-zinc-800 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- MAIN CHANNEL COMPONENT ---

export const Channel: React.FC<ChannelProps> = ({ onPlay, onAddToQueue }) => {
  const { channelId } = useParams<{ channelId: string }>();
  
  const [channelInfo, setChannelInfo] = useState<ChannelDetails | null>(null);
  usePublishTitle(channelInfo?.name);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  
  const [items, setItems] = useState<ChannelItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [heroError, setHeroError] = useState(false);
  const [heroRetryToken, setHeroRetryToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingTab, setLoadingTab] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [sortFilter, setSortFilter] = useState<SortFilterId>("latest");
  const [watchedVideos, setWatchedVideos] = useState<VideoSummary[]>([]);

  useEffect(() => {
    if (!channelId || !channelInfo || activeTab !== "home") {
      setWatchedVideos([]);
      return;
    }

    const loadWatchedHistory = async () => {
      try {
        const history = await getWatchHistory(150, 0);
        const filtered = history
          .filter((record) => record.channelName?.toLowerCase() === channelInfo.name.toLowerCase())
          .map((record) => ({
            id: record.videoId,
            title: record.title,
            channelName: record.channelName || channelInfo.name,
            thumbnailUrl: `https://i.ytimg.com/vi/${record.videoId}/hqdefault.jpg`,
            durationSeconds: record.totalDurationSeconds || record.watchDurationSeconds || null,
            publishedText: record.watchDate ? new Date(record.watchDate).toLocaleDateString() : null,
            viewCountText: "Watched recently",
          }));
        setWatchedVideos(filtered);
      } catch (err) {
        console.error("Failed to load watched history", err);
      }
    };

    loadWatchedHistory();
  }, [channelId, channelInfo, activeTab]);

  // Tab Cache for smooth transitions without refetching
  interface TabCacheEntry {
    items: ChannelItem[];
    nextPageToken: string | null;
  }
  const tabCacheRef = useRef<Record<string, TabCacheEntry | null>>({});

  const stashedTokensRef = useRef<{
    latest: string | null;
    popular: string | null;
    oldest: string | null;
  }>({ latest: null, popular: null, oldest: null });

  useEffect(() => {
    stashedTokensRef.current = { latest: null, popular: null, oldest: null };
    tabCacheRef.current = {};
  }, [channelId]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!channelId) return;

    const loadHero = async () => {
      setLoading(true);
      setHeroError(false);
      try {
        const details = await getChannelDetails(channelId);
        setChannelInfo(details);
      } catch (err) {
        console.error("Failed to load channel details", err);
        setHeroError(true);
      } finally {
        setLoading(false);
      }
    };

    loadHero();
  }, [channelId, heroRetryToken]);

  const cacheKey = activeSearchQuery 
    ? "" 
    : (activeTab === "videos" ? `videos_${sortFilter}` : activeTab);

  useEffect(() => {
    if (!channelId) return;
    
    const loadTab = async () => {
      // If we have cached tab data, apply it instantly
      if (cacheKey && tabCacheRef.current[cacheKey]) {
        const cached = tabCacheRef.current[cacheKey]!;
        setItems(cached.items);
        setNextPageToken(cached.nextPageToken);
        setLoadingTab(false);
        return;
      }

      setLoadingTab(true);
      setItems([]);
      setNextPageToken(null);
      try {
        let resolvedParams: string | undefined = undefined;
        let resolvedPageToken: string | undefined = undefined;

        if (activeSearchQuery) {
          resolvedParams = undefined;
          resolvedPageToken = undefined;
        } else if (activeTab === "videos") {
          const stashedToken = 
            sortFilter === "latest" ? stashedTokensRef.current.latest :
            sortFilter === "popular" ? stashedTokensRef.current.popular :
            sortFilter === "oldest" ? stashedTokensRef.current.oldest : null;
          
          if (stashedToken) {
            resolvedPageToken = stashedToken;
            resolvedParams = undefined;
          } else {
            resolvedParams = SORT_PARAMS[sortFilter];
            resolvedPageToken = undefined;
          }
        } else {
          resolvedParams = TAB_PARAMS[activeTab];
          resolvedPageToken = undefined;
        }

        const res = await getChannelTab(
          channelId, 
          resolvedParams, 
          resolvedPageToken || undefined, 
          activeSearchQuery || undefined
        );
        
        const fetchedItems = res.items;
        const fetchedNextToken = res.nextPageToken || null;

        setItems(fetchedItems);
        setNextPageToken(fetchedNextToken);

        if (activeTab === "videos" && !activeSearchQuery) {
          if (res.sortLatestToken) stashedTokensRef.current.latest = res.sortLatestToken;
          if (res.sortPopularToken) stashedTokensRef.current.popular = res.sortPopularToken;
          if (res.sortOldestToken) stashedTokensRef.current.oldest = res.sortOldestToken;
        }

        // Cache the newly loaded tab items & next page token
        if (cacheKey) {
          tabCacheRef.current[cacheKey] = {
            items: fetchedItems,
            nextPageToken: fetchedNextToken,
          };
        }
      } catch (err) {
        console.error("Failed to load tab data", err);
      } finally {
        setLoadingTab(false);
      }
    };
    
    loadTab();
  }, [channelId, activeTab, activeSearchQuery, sortFilter, cacheKey]);

  const loadMoreData = async () => {
    if (!channelId || loadingMore || !nextPageToken) return;

    setLoadingMore(true);
    try {
      const resolvedParams = 
        activeSearchQuery 
          ? undefined 
          : (activeTab === "videos" ? SORT_PARAMS[sortFilter] : TAB_PARAMS[activeTab]);

      const res = await getChannelTab(
        channelId, 
        resolvedParams, 
        nextPageToken, 
        activeSearchQuery || undefined
      );
      
      setItems((prevItems) => {
        const existingIds = new Set(prevItems.map((item) => item.id));
        const newItems = res.items.filter((item) => !existingIds.has(item.id));
        const combined = [...prevItems, ...newItems];

        // Cache the updated list with the new page token
        if (cacheKey) {
          tabCacheRef.current[cacheKey] = {
            items: combined,
            nextPageToken: res.nextPageToken || null,
          };
        }

        return combined;
      });

      setNextPageToken(res.nextPageToken || null);
    } catch (err) {
      console.error("Failed to load more channel items", err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const scrollContainer = document.querySelector("main") || containerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      if (scrollHeight - scrollTop - clientHeight < 600) {
        loadMoreData();
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [channelId, activeTab, nextPageToken, loadingMore, activeSearchQuery, sortFilter, cacheKey]);

  if (loading && !channelInfo) {
    return <ChannelPageSkeleton />;
  }

  if (heroError && !channelInfo) {
    return (
      <div className="flex flex-grow flex-col items-center justify-center gap-4 bg-background px-6 py-24 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-chrome-neutral-100">
          {getString("channel_unavailable_title")}
        </h2>
        <p className="max-w-md text-sm text-chrome-neutral-400">{getString("channel_unavailable_body")}</p>
        <Button variant="secondary" onClick={() => setHeroRetryToken((token) => token + 1)}>
          {getString("retry")}
        </Button>
      </div>
    );
  }

  const handleSearchSubmit = () => {
    if (searchQuery.trim()) {
      setActiveSearchQuery(searchQuery.trim());
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setActiveSearchQuery("");
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSearchQuery("");
    setActiveSearchQuery("");
    setSortFilter("latest");
  };

  return (
    <div 
      ref={containerRef}
      className="flex-grow pb-24 bg-background relative"
    >

      <ChannelHero 
        channelInfo={channelInfo} 
      />

      <ChannelTabs 
        activeTab={activeTab} 
        onTabChange={handleTabChange} 
        availableTabs={channelInfo?.availableTabs}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSearchSubmit={handleSearchSubmit}
        onSearchClear={handleClearSearch}
      />

      <div className=" mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === "videos" && !activeSearchQuery && (
          <div className="flex items-center gap-2.5 mb-6">
            <button
              onClick={() => setSortFilter("latest")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                sortFilter === "latest"
                  ? "bg-chrome-zinc-100 text-chrome-zinc-900 border border-chrome-zinc-100 shadow-md font-bold"
                  : "bg-chrome-zinc-900/60 hover:bg-chrome-zinc-800/50 border border-chrome-zinc-800/80 text-chrome-zinc-400 hover:text-chrome-zinc-200"
              }`}
            >
              Latest
            </button>
            <button
              onClick={() => setSortFilter("popular")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                sortFilter === "popular"
                  ? "bg-chrome-zinc-100 text-chrome-zinc-900 border border-chrome-zinc-100 shadow-md font-bold"
                  : "bg-chrome-zinc-900/60 hover:bg-chrome-zinc-800/50 border border-chrome-zinc-800/80 text-chrome-zinc-400 hover:text-chrome-zinc-200"
              }`}
            >
              Popular
            </button>
            <button
              onClick={() => setSortFilter("oldest")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                sortFilter === "oldest"
                  ? "bg-chrome-zinc-100 text-chrome-zinc-900 border border-chrome-zinc-100 shadow-md font-bold"
                  : "bg-chrome-zinc-900/60 hover:bg-chrome-zinc-800/50 border border-chrome-zinc-800/80 text-chrome-zinc-400 hover:text-chrome-zinc-200"
              }`}
            >
              Oldest
            </button>
          </div>
        )}

        {loadingTab ? (
          activeTab === "home" || activeTab === "videos" || activeTab === "live" ? (
            <VideoGrid loading={true} skeletonCount={8} onPlay={onPlay} />
          ) : activeTab === "shorts" ? (
            <ShortsGridSkeleton />
          ) : activeTab === "playlists" || activeTab === "podcasts" ? (
            <PlaylistsGridSkeleton />
          ) : activeTab === "posts" ? (
            <PostsFeedSkeleton />
          ) : (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-primary" size={32} />
            </div>
          )
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-chrome-zinc-800 rounded-3xl bg-chrome-zinc-900/40 p-6">
             <p className="text-chrome-zinc-500 text-sm font-medium">
               {activeSearchQuery ? `No videos found matching "${activeSearchQuery}".` : "No content found for this tab."}
             </p>
          </div>
        ) : (
          <div className="w-full">
            {activeSearchQuery ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-chrome-zinc-800/80">
                  <h2 className="text-base font-semibold text-chrome-neutral-200">
                    Search results for: <span className="text-primary">"{activeSearchQuery}"</span>
                  </h2>
                  <button
                    onClick={handleClearSearch}
                    className="text-xs font-medium text-chrome-neutral-400 hover:text-chrome-neutral-200 flex items-center gap-1 transition-colors bg-chrome-zinc-900 border border-chrome-zinc-800 px-2.5 py-1 rounded-full"
                  >
                    <X size={12} /> Clear search
                  </button>
                </div>
                <VideoGrid 
                  videos={items as VideoItemSummary[]} 
                  onPlay={onPlay} 
                  onAddToQueue={onAddToQueue} 
                  hideChannelAvatar={true}
                />
              </div>
            ) : activeTab === "home" ? (
              (() => {
                const videos = items.filter((item) => item.type === "video") as VideoItemSummary[];
                const shorts = items.filter((item) => item.type === "short") as ShortVideoSummary[];
                const playlists = items.filter((item) => item.type === "playlist") as PlaylistSummary[];
                const posts = items.filter((item) => item.type === "post") as PostSummary[];

                // Live Stream vs Video filter
                const liveVideos = videos.filter((v) => 
                  v.publishedText?.toLowerCase().includes("live") || 
                  v.viewCountText?.toLowerCase().includes("watching") || 
                  v.title.toLowerCase().includes("live") ||
                  v.durationSeconds === 0
                );
                const regularVideos = videos.filter((v) => !liveVideos.some((lv) => lv.id === v.id));

                // Playlist vs Podcast filter
                const podcastPlaylists = playlists.filter((p) => 
                  p.title.toLowerCase().includes("podcast")
                );
                const regularPlaylists = playlists.filter((p) => 
                  !p.title.toLowerCase().includes("podcast")
                );

                const hasAnyContent = 
                  regularVideos.length > 0 || 
                  watchedVideos.length > 0 || 
                  liveVideos.length > 0 || 
                  shorts.length > 0 || 
                  regularPlaylists.length > 0 || 
                  podcastPlaylists.length > 0 || 
                  posts.length > 0;

                if (!hasAnyContent) {
                  return (
                    <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-chrome-zinc-800 rounded-3xl bg-chrome-zinc-900/40 p-6">
                      <p className="text-chrome-zinc-500 text-sm font-medium">No home tab shelf content available.</p>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col gap-6 divide-y divide-chrome-zinc-900">
                    {regularVideos.length > 0 && (
                      <VideoShelf
                        title="Videos"
                        videos={regularVideos}
                        onPlay={onPlay}
                        onAddToQueue={onAddToQueue}
                      />
                    )}
                    {watchedVideos.length > 0 && (
                      <VideoShelf
                        title="Watched Videos"
                        videos={watchedVideos}
                        onPlay={onPlay}
                        onAddToQueue={onAddToQueue}
                      />
                    )}
                    {liveVideos.length > 0 && (
                      <VideoShelf
                        title="Live"
                        videos={liveVideos}
                        onPlay={onPlay}
                        onAddToQueue={onAddToQueue}
                      />
                    )}
                    {shorts.length > 0 && (
                      <ShortsShelf
                        title="Shorts"
                        shorts={shorts}
                        onPlay={onPlay}
                      />
                    )}
                    {regularPlaylists.length > 0 && (
                      <PlaylistShelf
                        title="Playlists"
                        playlists={regularPlaylists}
                      />
                    )}
                    {podcastPlaylists.length > 0 && (
                      <PlaylistShelf
                        title="Podcasts"
                        playlists={podcastPlaylists}
                      />
                    )}
                    {posts.length > 0 && (
                      <PostShelf
                        title="Community Posts"
                        posts={posts}
                      />
                    )}
                  </div>
                );
              })()
            ) : activeTab === "videos" || activeTab === "live" ? (
              <VideoGrid 
                videos={items as VideoItemSummary[]} 
                onPlay={onPlay} 
                onAddToQueue={onAddToQueue} 
                hideChannelAvatar={true}
              />
            ) : activeTab === "shorts" ? (
              <ChannelShortsGrid shorts={items as ShortVideoSummary[]} />
            ) : activeTab === "playlists" || activeTab === "podcasts" ? (
              <ChannelPlaylistsGrid playlists={items as PlaylistSummary[]} />
            ) : activeTab === "posts" ? (
              <ChannelPostsFeed posts={items as PostSummary[]} />
            ) : null}

            {loadingMore && (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin text-primary" size={24} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Channel;
