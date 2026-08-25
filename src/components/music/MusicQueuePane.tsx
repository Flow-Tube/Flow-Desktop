import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
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
import { GripVertical, ListX, Loader2, Radio, X } from "lucide-react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useMusicHiddenFilter } from "../../store/useMusicActionsStore";
import { getString } from "../../lib/i18n/index";
import type { SongItem } from "../../types/music";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { MusicItemCard } from "./MusicItemCard";

const videoIdOf = (t: SongItem): string => t.videoId ?? t.id;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

interface QueueRowProps {
  track: SongItem;
  isRadio: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

function QueueRow({ track, isRadio, onPlay, onRemove }: QueueRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: videoIdOf(track) });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx("group/queue relative flex items-center rounded-lg", isDragging && "z-10 opacity-80")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        title={getString("music_drag_to_reorder")}
        aria-label={getString("music_drag_to_reorder")}
        className="grid w-6 shrink-0 cursor-grab touch-none place-items-center self-stretch text-chrome-neutral-600 outline-none active:cursor-grabbing"
      >
        {isRadio ? (
          <>
            <Radio className="h-3.5 w-3.5 text-[var(--color-primary)] group-hover/queue:hidden" />
            <GripVertical className="hidden h-4 w-4 text-chrome-neutral-400 group-hover/queue:block" />
          </>
        ) : (
          <GripVertical className="h-4 w-4 opacity-0 transition-opacity group-hover/queue:opacity-100" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <MusicItemCard
          variant="track-list"
          item={track}
          onPlay={onPlay}
          appendActions={[
            {
              id: "remove-from-queue",
              label: getString("music_remove_from_queue"),
              icon: <X size={16} />,
              onSelect: onRemove,
            },
          ]}
        />
      </div>
    </div>
  );
}

export function MusicQueuePane() {
  const queue = useMusicPlayerStore((s) => s.queue);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const radioEnabled = useMusicPlayerStore((s) => s.radioEnabled);
  const radioLoading = useMusicPlayerStore((s) => s.radioLoading);
  const radioQueuedIds = useMusicPlayerStore((s) => s.radioQueuedIds);
  const loadIndex = useMusicPlayerStore((s) => s._loadIndex);
  const removeFromQueue = useMusicPlayerStore((s) => s.removeFromQueue);
  const reorderQueue = useMusicPlayerStore((s) => s.reorderQueue);
  const clearQueue = useMusicPlayerStore((s) => s.clearQueue);
  const toggleRadio = useMusicPlayerStore((s) => s.toggleRadio);
  const isHidden = useMusicHiddenFilter();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const radioSet = new Set(radioQueuedIds);
  const upcoming = queue
    .map((track, i) => ({ track, i }))
    .filter(({ track, i }) => i > currentIndex && !isHidden(track));
  const sortableIds = upcoming.map(({ track }) => videoIdOf(track));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = queue.findIndex((t) => videoIdOf(t) === active.id);
    const to = queue.findIndex((t) => videoIdOf(t) === over.id);
    if (from < 0 || to < 0) return;
    reorderQueue(from, to);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
          {getString("music_queue")}
        </h3>
        {upcoming.length > 0 && (
          <button
            type="button"
            onClick={clearQueue}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <ListX className="h-3.5 w-3.5" />
            {getString("music_clear_queue")}
          </button>
        )}
      </div>

      {/* Scroll area */}
      <div className="hide-scrollbar -mx-1 flex-1 overflow-y-auto px-1">
        {currentTrack && (
          <>
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-chrome-neutral-600">
              {getString("music_now_playing")}
            </p>
            <MusicItemCard variant="track-list" item={currentTrack} onPlay={() => void loadIndex(currentIndex)} />
          </>
        )}

        <div className="mt-4 mb-1 flex items-center justify-between px-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-chrome-neutral-600">
            {getString("music_up_next")}
          </p>
          {radioEnabled && radioLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-chrome-neutral-500" />
          )}
        </div>

        {upcoming.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col">
                {upcoming.map(({ track, i }) => (
                  <QueueRow
                    key={videoIdOf(track)}
                    track={track}
                    isRadio={radioSet.has(videoIdOf(track))}
                    onPlay={() => void loadIndex(i)}
                    onRemove={() => removeFromQueue(i)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="px-2 py-6 text-center">
            <p className="text-sm text-chrome-neutral-500">{getString("music_queue_empty")}</p>
            {!radioEnabled && (
              <p className="mt-1 text-xs text-chrome-neutral-600">{getString("music_queue_autoplay_hint")}</p>
            )}
          </div>
        )}
      </div>

      {/* Autoplay footer */}
      <div className="mt-2 flex items-center gap-3 rounded-xl border border-chrome-neutral-800 bg-surface-container-low px-3 py-2.5">
        <Radio
          className={cx("h-5 w-5 shrink-0", radioEnabled ? "text-[var(--color-primary)]" : "text-chrome-neutral-500")}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-chrome-neutral-100">{getString("music_autoplay")}</p>
          <p className="line-clamp-1 text-xs text-chrome-neutral-500">{getString("music_autoplay_desc")}</p>
        </div>
        <ToggleSwitch checked={radioEnabled} onChange={() => toggleRadio()} />
      </div>
    </div>
  );
}
