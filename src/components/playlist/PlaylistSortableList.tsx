import { getString } from "../../lib/i18n/index";
import { useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { resolveDragMove, sortableRowStyle, useListDragSensors } from "../../lib/sortableList";
import { VideoCard } from "../video/VideoCard";
import { IconButton } from "../ui/IconButton";
import { SearchInput } from "../ui/SearchInput";
import { Select } from "../ui/Select";
import { playlistSortLabel, showsDateAdded, type PlaylistSortOrder } from "../../lib/playlistSort";
import type { VideoSummary } from "../../types/video";

interface PlaylistSortableListProps {
  videos: VideoSummary[];
  displayVideos: VideoSummary[];
  sortOrder: PlaylistSortOrder;
  sortOptions: PlaylistSortOrder[];
  onSortChange: (order: PlaylistSortOrder) => void;
  /** What the rows are filtered by; a filter hides rows, so dragging waits until it clears. */
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onReorder: (videos: VideoSummary[]) => void;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
  /** Shown after the last row, such as the next-page loader. */
  footer?: ReactNode;
}

interface SortablePlaylistRowProps {
  video: VideoSummary;
  sortEnabled: boolean;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}

function SortablePlaylistRow({
  video,
  sortEnabled,
  onPlay,
  onAddToQueue,
}: SortablePlaylistRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: video.id,
    disabled: !sortEnabled,
  });

  const style = sortableRowStyle(transform, transition);

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-80" : undefined}>
      <VideoCard
        variant="list"
        video={video}
        onPlay={onPlay}
        onAddToQueue={onAddToQueue}
        showDragHandle={sortEnabled}
        isDragActive={isDragging}
        dragHandleProps={{
          ref: setActivatorNodeRef,
          ...attributes,
          ...listeners,
        }}
      />
    </div>
  );
}

function PlaylistVideoRows({
  displayVideos,
  sortEnabled,
  showAddedDate,
  searchQuery,
  onPlay,
  onAddToQueue,
}: {
  displayVideos: VideoSummary[];
  sortEnabled: boolean;
  showAddedDate: boolean;
  searchQuery: string;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}) {
  if (displayVideos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-chrome-neutral-800 py-20 text-center">
        <p className="text-sm font-medium text-chrome-neutral-400">
          {searchQuery.trim()
            ? getString("playlist_search_no_results", searchQuery.trim())
            : getString("playlist_this_playlist_has_no_videos_yet")}
        </p>
      </div>
    );
  }

  if (sortEnabled) {
    return (
      <div className="flex flex-col gap-3">
        {displayVideos.map((video) => (
          <SortablePlaylistRow
            key={video.id}
            video={video}
            sortEnabled={sortEnabled}
            onPlay={onPlay}
            onAddToQueue={onAddToQueue}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {displayVideos.map((video) => (
        <VideoCard
          key={video.id}
          variant="list"
          video={video}
          onPlay={onPlay}
          onAddToQueue={onAddToQueue}
          showDragHandle={false}
          showAddedDate={showAddedDate}
        />
      ))}
    </div>
  );
}

export function PlaylistSortableList({
  videos,
  displayVideos,
  sortOrder,
  sortOptions,
  onSortChange,
  searchQuery,
  onSearchChange,
  onReorder,
  onPlay,
  onAddToQueue,
  footer,
}: PlaylistSortableListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const sortEnabled = sortOrder === "manual" && !searchOpen;

  const closeSearch = () => {
    setSearchOpen(false);
    onSearchChange("");
  };

  const sensors = useListDragSensors();

  const sortableIds = useMemo(
    () => displayVideos.map((video) => video.id),
    [displayVideos],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const move = resolveDragMove(event, videos.map((video) => video.id));
    if (!move) return;

    const next = [...videos];
    const [moved] = next.splice(move[0], 1);
    if (!moved) return;
    next.splice(move[1], 0, moved);
    onReorder(next);
  };

  const listBody = (
    <PlaylistVideoRows
      displayVideos={displayVideos}
      sortEnabled={sortEnabled}
      showAddedDate={showsDateAdded(sortOrder)}
      searchQuery={searchQuery}
      onPlay={onPlay}
      onAddToQueue={onAddToQueue}
    />
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-chrome-neutral-800/50 bg-background pb-4">
          <Select
            value={sortOrder}
            onChange={(val) => onSortChange(val as PlaylistSortOrder)}
            options={sortOptions.map((order) => ({ value: order, label: playlistSortLabel(order) }))}
            className="w-full max-w-xs"
          />
          {searchOpen ? (
            <>
              <SearchInput
                autoFocus
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeSearch();
                }}
                placeholder={getString("playlist_search_in")}
                aria-label={getString("playlist_search_in")}
                containerClassName="min-w-0 flex-1"
              />
              <IconButton aria-label={getString("playlist_search_close")} onClick={closeSearch}>
                <X size={18} />
              </IconButton>
            </>
          ) : (
            <IconButton aria-label={getString("playlist_search_in")} title={getString("playlist_search_in")} onClick={() => setSearchOpen(true)}>
              <Search size={18} />
            </IconButton>
          )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        {sortEnabled ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {listBody}
            </SortableContext>
          </DndContext>
        ) : (
          listBody
        )}
        {footer}
      </div>
    </section>
  );
}
