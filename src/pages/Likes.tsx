import React, { useMemo, useState } from "react";
import { Heart, Loader2, Trash2 } from "lucide-react";
import type { VideoSummary } from "../types/video";
import { getString } from "../lib/i18n/index";
import { HistoryDateGroup } from "../components/history/HistoryDateGroup";
import { MusicHistoryGroup } from "../components/history/MusicHistoryGroup";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { CategoryChips } from "../components/layout/CategoryChips";
import { LikesFlatList } from "../components/likes/LikesFlatList";
import { LikesToolbar } from "../components/likes/LikesToolbar";
import {
  DEFAULT_LIKES_SORT,
  likedItemKey,
  loadLikesSortOrder,
  saveLikesSortOrder,
  sortLikedItems,
} from "../lib/likedItems";
import { useMultiSelect } from "../lib/useMultiSelect";
import { useLikes, groupLikedItemsByDate } from "../lib/useLikes";
import type { PlaylistSortOrder } from "../lib/playlistSort";

type LikesFilter = "all" | "videos" | "music";

interface LikesProps {
  onPlay: (video: VideoSummary) => void;
}

export const Likes: React.FC<LikesProps> = ({ onPlay }) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<LikesFilter>("all");
  const [sortOrder, setSortOrder] = useState<PlaylistSortOrder>(loadLikesSortOrder);
  const {
    items,
    loading,
    removeLikedItem,
    clearLikes,
  } = useLikes();

  const filters = useMemo(
    () => [
      { key: "all" as const, label: getString("history_filter_all") },
      { key: "videos" as const, label: getString("history_filter_videos") },
      { key: "music" as const, label: getString("history_filter_music") },
    ],
    [],
  );
  const activeLabel = filters.find((f) => f.key === filter)?.label ?? filters[0]?.label ?? "";

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (filter === "music" && item.kind !== "music") return false;
      if (filter === "videos" && item.kind !== "video") return false;
      if (query) {
        const title = item.kind === "music" ? item.song.title : item.video.title;
        const creator = item.kind === "music"
          ? item.song.artists?.map((artist) => artist.name).join(" ")
          : item.video.channelName;
        const haystack = `${title ?? ""} ${creator ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    return sortLikedItems(filtered, sortOrder);
  }, [filter, items, searchQuery, sortOrder]);

  const visibleKeys = useMemo(() => visibleItems.map(likedItemKey), [visibleItems]);
  const selection = useMultiSelect(visibleKeys);
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selection.selectedIds.has(likedItemKey(item))),
    [visibleItems, selection.selectedIds],
  );

  // The date groups only read right newest first, and their shelves can't pick rows.
  const showDateGroups = sortOrder === DEFAULT_LIKES_SORT && !selection.selecting;
  const visibleGroups = useMemo(
    () => (showDateGroups ? groupLikedItemsByDate(visibleItems) : []),
    [showDateGroups, visibleItems],
  );

  const handleSortChange = (next: PlaylistSortOrder) => {
    setSortOrder(next);
    saveLikesSortOrder(next);
  };

  const handleClearAll = async () => {
    try {
      await clearLikes();
      setShowClearConfirm(false);
    } catch (error) {
      console.error("Failed to clear likes", error);
    }
  };

  const handleDeleteItem = async (videoId: string, isMusic: boolean) => {
    try {
      await removeLikedItem(isMusic ? "music" : "video", videoId);
    } catch (error) {
      console.error("Failed to remove liked item", error);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full pb-20">
        <header className="flex flex-col gap-5 border-b border-chrome-neutral-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100 lg:text-4xl">
              {getString("likes_title")}
            </h1>
            <p className="mt-2 text-sm text-chrome-neutral-400">
              {getString("likes_subtitle")}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:items-center">
            <SearchInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={getString("likes_search_placeholder")}
              containerClassName="w-full sm:w-72"
              disabled={loading || items.length === 0}
            />

            <Button
              type="button"
              variant="destructive"
              onClick={() => setShowClearConfirm(true)}
              disabled={loading || items.length === 0}
              className="shrink-0"
            >
              <Trash2 size={16} />
              {getString("clear_all")}
            </Button>
          </div>
        </header>

        <CategoryChips
          categories={filters.map((f) => f.label)}
          activeCategory={activeLabel}
          onCategoryChange={(label) =>
            setFilter(filters.find((f) => f.label === label)?.key ?? "all")
          }
          sticky={false}
          className="mt-2"
        />

        {!loading && items.length > 0 ? (
          <LikesToolbar
            items={visibleItems}
            sortOrder={sortOrder}
            onSortChange={handleSortChange}
            selecting={selection.selecting}
            selected={selectedItems}
            allSelected={selection.allSelected}
            onStartSelecting={selection.start}
            onToggleAll={() => selection.toggleAll(visibleKeys)}
            onDoneSelecting={selection.stop}
          />
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <Loader2 className="h-9 w-9 animate-spin text-[var(--color-primary)]" />
            <p className="mt-4 text-sm font-medium text-chrome-neutral-500">
              {getString("likes_loading")}
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-10 text-center">
            <Heart className="mb-4 h-12 w-12 text-chrome-neutral-700" />
            <h3 className="font-bold text-chrome-neutral-300">{getString("empty_likes")}</h3>
            <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
              {getString("empty_likes_body")}
            </p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
            <p className="text-sm font-medium text-chrome-neutral-300">
              {getString("likes_no_results")}
            </p>
          </div>
        ) : !showDateGroups ? (
          <LikesFlatList
            items={visibleItems}
            selecting={selection.selecting}
            selectedKeys={selection.selectedIds}
            onToggle={selection.toggle}
            onPlay={onPlay}
            onRemove={(item) => void handleDeleteItem(item.id, item.kind === "music")}
          />
        ) : (
          <div className="mt-8 flex flex-col gap-10">
            {visibleGroups.map((group) =>
              filter === "music" ? (
                <MusicHistoryGroup
                  key={group.dateLabel}
                  group={group}
                  onRemoveFromHistory={(videoId) => void handleDeleteItem(videoId, true)}
                />
              ) : (
                <HistoryDateGroup
                  key={group.dateLabel}
                  group={group}
                  onPlay={onPlay}
                  onRemoveFromHistory={(videoId) => {
                    const isMusic = group.videos.find((video) => video.id === videoId)?.isMusic ?? false;
                    void handleDeleteItem(videoId, isMusic);
                  }}
                />
              ),
            )}
          </div>
        )}
      </div>

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-black/75 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6">
            <h3 className="text-lg font-bold text-chrome-neutral-100">
              {getString("clear_likes_alert_title")}
            </h3>
            <p className="text-sm leading-relaxed text-chrome-neutral-400">
              {getString("clear_likes_alert_body")}
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowClearConfirm(false)}
              >
                {getString("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleClearAll}
              >
                {getString("clear")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Likes;
