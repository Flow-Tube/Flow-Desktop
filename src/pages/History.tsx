import React, { useCallback, useMemo, useRef, useState } from "react";
import { Clock, Loader2, Trash2 } from "lucide-react";
import { VList, type VListHandle } from "virtua";
import type { VideoSummary } from "../types/video";
import { getString } from "../lib/i18n/index";
import { HistoryDateGroup } from "../components/history/HistoryDateGroup";
import { MusicHistoryGroup } from "../components/history/MusicHistoryGroup";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { CategoryChips } from "../components/layout/CategoryChips";
import { useHistory, groupHistoryByDate } from "../lib/useHistory";
import { useDebounce } from "../lib/useDebounce";

type HistoryFilter = "all" | "videos" | "music";

interface HistoryProps {
  onPlay: (video: VideoSummary) => void;
}

export const History: React.FC<HistoryProps> = ({ onPlay }) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const {
    history,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    removeHistoryItem,
    clearHistory,
  } = useHistory();

  const debouncedQuery = useDebounce(searchQuery, 200);

  const toggleGroup = useCallback((dateLabel: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(dateLabel)) next.delete(dateLabel);
      else next.add(dateLabel);
      return next;
    });
  }, []);

  const listRef = useRef<VListHandle>(null);
  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || !hasMore) return;
    if (el.scrollOffset + el.viewportSize >= el.scrollSize - 800) {
      void loadMore();
    }
  }, [hasMore, loadMore]);

  const filters = useMemo(
    () => [
      { key: "all" as const, label: getString("history_filter_all") },
      { key: "videos" as const, label: getString("history_filter_videos") },
      { key: "music" as const, label: getString("history_filter_music") },
    ],
    [],
  );
  const activeLabel = filters.find((f) => f.key === filter)?.label ?? filters[0]?.label ?? "";

  const visibleGroups = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();
    const filtered = history.filter((record) => {
      if (filter === "music" && !record.isMusic) return false;
      if (filter === "videos" && record.isMusic) return false;
      if (query) {
        const haystack = `${record.title ?? ""} ${record.channelName ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    return groupHistoryByDate(filtered);
  }, [history, filter, debouncedQuery]);

  const handleClearAll = async () => {
    try {
      await clearHistory();
      setShowClearConfirm(false);
    } catch (e) {
      console.error("Failed to clear watch history", e);
    }
  };

  const handleDeleteItem = async (videoId: string) => {
    try {
      await removeHistoryItem(videoId);
    } catch (e) {
      console.error("Failed to delete watch history record", e);
    }
  };

  const groupItems = useMemo(() => {
    const items = visibleGroups.map((group) => (
      <div key={group.dateLabel} className="pb-10">
        {filter === "music" ? (
          <MusicHistoryGroup group={group} onRemoveFromHistory={handleDeleteItem} />
        ) : (
          <HistoryDateGroup
            group={group}
            onPlay={onPlay}
            onRemoveFromHistory={handleDeleteItem}
            isExpanded={expandedGroups.has(group.dateLabel)}
            onToggleExpand={() => toggleGroup(group.dateLabel)}
          />
        )}
      </div>
    ));
    if (hasMore && loadingMore) {
      items.push(
        <div key="__loading_more" className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-chrome-neutral-600" />
        </div>,
      );
    }
    return items;
  }, [visibleGroups, filter, expandedGroups, hasMore, loadingMore]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden py-6">
      <div className="mx-auto w-full shrink-0 px-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 border-b border-chrome-neutral-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100 lg:text-4xl">
              {getString("watch_history_title")}
            </h1>
            <p className="mt-2 text-sm text-chrome-neutral-400">
              {getString("watch_history_subtitle")}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:items-center">
            <SearchInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={getString("search_history_placeholder")}
              containerClassName="w-full sm:w-72"
              disabled={loading || history.length === 0}
            />

            <Button
              type="button"
              variant="destructive"
              onClick={() => setShowClearConfirm(true)}
              disabled={loading || history.length === 0}
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
      </div>

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center py-32 px-4 sm:px-6 lg:px-8">
          <Loader2 className="h-9 w-9 animate-spin text-[var(--color-primary)]" />
          <p className="mt-4 text-sm font-medium text-chrome-neutral-500">
            {getString("history_loading")}
          </p>
        </div>
      ) : history.length === 0 ? (
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mt-8 flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-10 text-center">
            <Clock className="mb-4 h-12 w-12 text-chrome-neutral-700" />
            <h3 className="font-bold text-chrome-neutral-300">{getString("empty_watch_history")}</h3>
            <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
              {getString("empty_watch_history_body")}
            </p>
          </div>
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mt-8 w-full rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
            <p className="text-sm font-medium text-chrome-neutral-300">
              No history results match your search.
            </p>
          </div>
        </div>
      ) : (
        <VList
          ref={listRef}
          onScroll={handleListScroll}
          className="mt-8 w-full flex-1 min-h-0 px-4 sm:px-6 lg:px-8"
        >
          {groupItems}
        </VList>
      )}

      {/* Clear watch history confirmation overlay modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-black/75 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6">
            <h3 className="text-lg font-bold text-chrome-neutral-100">
              {getString("clear_watch_history_alert_title")}
            </h3>
            <p className="text-sm leading-relaxed text-chrome-neutral-400">
              {getString("clear_watch_history_alert_body")}
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

export default History;
