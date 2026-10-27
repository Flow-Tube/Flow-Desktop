import { useMemo } from "react";
import {
  GripHorizontal,
  ListVideo,
  Play,
  Repeat,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
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
import { useNavigate } from "react-router-dom";

import { getString } from "../../lib/i18n/index";
import { useProxyImageSrc } from "../../lib/useImageProxy";
import { WATCH_LATER_PLAYLIST_ID, moveStoredPlaylistTrack } from "../../lib/playlistLibrary";
import { removeVideoFromQueuePlaylist } from "../../lib/queuePlaylistEdits";
import { resolveDragMove, sortableRowStyle, useListDragSensors } from "../../lib/sortableList";
import { usePlayerStore, type RepeatMode } from "../../store/usePlayerStore";
import type { VideoSummary } from "../../types/video";

const repeatLabels: Record<RepeatMode, string> = {
  none: getString("queue_repeat_off"),
  all: getString("queue_repeat_all"),
  one: getString("queue_repeat_one"),
};

function formatDuration(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

interface QueueRowProps {
  video: VideoSummary;
  index: number;
  isCurrent: boolean;
  isManual: boolean;
  canReorder: boolean;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
}

function QueueRow({ video, index, isCurrent, isManual, canReorder, onPlay, onRemove }: QueueRowProps) {
  const toSrc = useProxyImageSrc();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id, disabled: !canReorder });

  const style = sortableRowStyle(transform, transition);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-3 py-3 transition-colors duration-200 ease-out ${
        isCurrent ? "bg-surface-container" : "hover:bg-surface-container-high"
      } ${isDragging ? "opacity-80" : ""}`}
    >
      {canReorder ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={getString("reorder_item", video.title)}
          className="shrink-0 cursor-grab rounded-md p-1 text-chrome-neutral-500 transition-colors hover:text-chrome-neutral-300 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripHorizontal size={18} strokeWidth={2.5} />
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onPlay(index)}
        className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-xl bg-surface-container-highest"
        aria-label={getString("queue_play_item", video.title)}
      >
        {video.thumbnailUrl ? (
          <img
            src={toSrc(video.thumbnailUrl)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
        <span className="absolute inset-0 grid place-items-center bg-chrome-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-5 w-5 fill-current text-chrome-white" />
        </span>
        {video.durationSeconds ? (
          <span className="absolute bottom-1 right-1 rounded bg-chrome-black/80 px-1 py-0.5 font-mono text-[10px] text-chrome-white">
            {formatDuration(video.durationSeconds)}
          </span>
        ) : null}
      </button>

      <button
        type="button"
        onClick={() => onPlay(index)}
        className="min-w-0 flex-1 text-left"
      >
        {isCurrent ? (
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            {getString("queue_now_playing")}
          </span>
        ) : isManual ? (
          <span className="text-[11px] font-semibold uppercase tracking-widest text-chrome-neutral-400">
            {getString("queue_added_label")}
          </span>
        ) : null}
        <span className="mt-0.5 block line-clamp-2 text-sm font-medium leading-snug text-chrome-neutral-100">
          {video.title}
        </span>
        <span className="mt-1 block truncate text-xs text-chrome-neutral-500">{video.channelName}</span>
      </button>

      <button
        type="button"
        title={getString("remove")}
        aria-label={getString("remove")}
        disabled={isCurrent}
        onClick={() => onRemove(index)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-chrome-neutral-500 transition-colors hover:bg-chrome-red-950/30 hover:text-chrome-red-400 disabled:opacity-25"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function QueuePanel() {
  const navigate = useNavigate();
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const playlistContext = usePlayerStore((state) => state.playlistContext);
  const manualQueueIds = usePlayerStore((state) => state.manualQueueIds);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const isShuffle = usePlayerStore((state) => state.isShuffle);
  const setIsQueuePanelOpen = usePlayerStore((state) => state.setIsQueuePanelOpen);
  const playQueueItem = usePlayerStore((state) => state.playQueueItem);
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue);
  const moveQueueItem = usePlayerStore((state) => state.moveQueueItem);
  const clearUpcoming = usePlayerStore((state) => state.clearUpcoming);
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);

  const upcomingCount = Math.max(0, queue.length - currentIndex - 1);

  // Hand-added items sit in the queue but aren't part of the playlist.
  const isPlaylistItem = (item: VideoSummary) => !manualQueueIds.has(item.id);
  const playlistPosition = queue.slice(0, currentIndex + 1).filter(isPlaylistItem).length;
  const playlistLength = queue.filter(isPlaylistItem).length;

  // A playlist can only be dragged while the move is saved to it (Manual order, shuffle off).
  const canReorderPlaylist = Boolean(playlistContext?.reorderable) && !isShuffle;
  const showReorder = !playlistContext || canReorderPlaylist;

  const sensors = useListDragSensors();
  const sortableIds = useMemo(() => queue.map((item) => item.id), [queue]);

  const handleDragEnd = (event: DragEndEvent) => {
    const move = resolveDragMove(event, sortableIds);
    if (!move) return;
    moveQueueItem(move[0], move[1]);
    if (!playlistContext || !canReorderPlaylist) return;

    const nextQueue = usePlayerStore.getState().queue;
    const moved = nextQueue[move[1]];
    if (!moved || !isPlaylistItem(moved)) return;
    // Saved after its new neighbour, not as the whole queue, so edits made to the playlist meanwhile survive.
    const anchor = nextQueue.slice(0, move[1]).reverse().find(isPlaylistItem);
    moveStoredPlaylistTrack(playlistContext.id, moved.id, anchor?.id ?? null).catch((error) => {
      console.warn("Failed to reorder stored playlist", error);
    });
  };

  const handleRemove = (index: number) => {
    const removed = queue[index];
    removeFromQueue(index);
    if (removed && playlistContext?.editable && isPlaylistItem(removed)) {
      void removeVideoFromQueuePlaylist(playlistContext, removed, index);
    }
  };

  return (
    <section className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-low text-chrome-neutral-100">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-chrome-neutral-800 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListVideo className="h-4 w-4 shrink-0 text-chrome-neutral-400" />
            <h2 className="truncate text-base font-medium text-chrome-neutral-100">
              {playlistContext ? playlistContext.title : getString("queue_title")}
            </h2>
          </div>
          {playlistContext ? (
            <div className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-xs text-chrome-neutral-500">
                {getString("queue_playlist_position", Math.max(1, playlistPosition), playlistLength)}
              </span>
              <button
                type="button"
                onClick={() =>
                  navigate(
                    playlistContext.id === WATCH_LATER_PLAYLIST_ID
                      ? "/watch-later"
                      : `/playlist/${playlistContext.id}`,
                  )
                }
                className="text-xs font-medium text-[var(--color-primary)] transition-opacity duration-200 ease-out hover:opacity-80"
              >
                {getString("queue_view_playlist")}
              </button>
            </div>
          ) : (
            <p className="mt-0.5 font-mono text-xs text-chrome-neutral-500">
              {getString("queue_upcoming_count", upcomingCount)}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={getString("close")}
          onClick={() => setIsQueuePanelOpen(false)}
          className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
        >
          <X size={18} />
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-chrome-neutral-800 px-4 py-3">
        <button
          type="button"
          onClick={cycleRepeatMode}
          title={repeatLabels[repeatMode]}
          className={`flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium transition-colors duration-200 ease-out ${
            repeatMode === "none"
              ? "bg-surface-container-high text-chrome-neutral-300 hover:bg-surface-container-highest"
              : "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
          }`}
        >
          <Repeat size={15} />
          {repeatMode === "one" ? "1" : repeatLabels[repeatMode]}
        </button>
        <button
          type="button"
          onClick={toggleShuffle}
          className={`flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium transition-colors duration-200 ease-out ${
            isShuffle
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
              : "bg-surface-container-high text-chrome-neutral-300 hover:bg-surface-container-highest"
          }`}
        >
          <Shuffle size={15} />
          {getString("shuffle")}
        </button>
        {!playlistContext ? (
          <button
            type="button"
            onClick={clearUpcoming}
            disabled={upcomingCount === 0}
            className="ml-auto rounded-full px-3 py-2 text-xs font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {getString("queue_clear_upcoming")}
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <ListVideo className="h-8 w-8 text-chrome-neutral-600" />
            <p className="mt-3 text-sm font-medium text-chrome-neutral-300">{getString("queue_empty")}</p>
            <p className="mt-1 text-xs text-chrome-neutral-500">{getString("queue_empty_body")}</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-chrome-neutral-800">
                {queue.map((video, index) => (
                  <QueueRow
                    key={video.id}
                    video={video}
                    index={index}
                    isCurrent={index === currentIndex}
                    isManual={manualQueueIds.has(video.id)}
                    canReorder={showReorder}
                    onPlay={playQueueItem}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  );
}

export default QueuePanel;
