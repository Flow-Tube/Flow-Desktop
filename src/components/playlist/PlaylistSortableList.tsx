import { useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { VideoCard } from "../video/VideoCard";
import { Select } from "../ui/Select";
import { playlistSortLabel, showsDateAdded, type PlaylistSortOrder } from "../../lib/playlistSort";
import type { VideoSummary } from "../../types/video";

interface PlaylistSortableListProps {
  videos: VideoSummary[];
  displayVideos: VideoSummary[];
  sortOrder: PlaylistSortOrder;
  sortOptions: PlaylistSortOrder[];
  onSortChange: (order: PlaylistSortOrder) => void;
  onReorder: (videos: VideoSummary[]) => void;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

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
  onPlay,
  onAddToQueue,
}: {
  displayVideos: VideoSummary[];
  sortEnabled: boolean;
  showAddedDate: boolean;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}) {
  if (displayVideos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-chrome-neutral-800 py-20 text-center">
        <p className="text-sm font-medium text-chrome-neutral-400">This playlist has no videos yet.</p>
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
  onReorder,
  onPlay,
  onAddToQueue,
}: PlaylistSortableListProps) {
  const sortEnabled = sortOrder === "manual";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sortableIds = useMemo(
    () => displayVideos.map((video) => video.id),
    [displayVideos],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = videos.findIndex((video) => video.id === active.id);
    const newIndex = videos.findIndex((video) => video.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = [...videos];
    const [moved] = next.splice(oldIndex, 1);
    if (!moved) return;
    next.splice(newIndex, 0, moved);
    onReorder(next);
  };

  const listBody = (
    <PlaylistVideoRows
      displayVideos={displayVideos}
      sortEnabled={sortEnabled}
      showAddedDate={showsDateAdded(sortOrder)}
      onPlay={onPlay}
      onAddToQueue={onAddToQueue}
    />
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="shrink-0 border-b border-chrome-neutral-800/50 bg-background pb-4">
          <Select
            value={sortOrder}
            onChange={(val) => onSortChange(val as PlaylistSortOrder)}
            options={sortOptions.map((order) => ({ value: order, label: playlistSortLabel(order) }))}
            className="w-full max-w-xs"
          />
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
      </div>
    </section>
  );
}
