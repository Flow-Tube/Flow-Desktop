import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ListX, Loader2, Radio } from "lucide-react";

import { selectRadioOn, useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useMusicHiddenFilter } from "../../store/useMusicActionsStore";
import { useUiStore } from "../../store/useUiStore";
import { getString } from "../../lib/i18n/index";
import {
  DEFAULT_LEFT_SWIPE,
  DEFAULT_RIGHT_SWIPE,
  parseQueueSwipeAction,
  type QueueSwipeAction,
} from "../../lib/queueRowSwipe";
import { SETTINGS } from "../../lib/settings/schema";
import { usePreference } from "../../lib/usePreference";
import type { SongItem } from "../../types/music";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { MusicItemCard } from "./MusicItemCard";
import { QueueSwipeRow } from "./QueueSwipeRow";

const videoIdOf = (t: SongItem): string => t.videoId ?? t.id;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function MusicQueuePane() {
  const queue = useMusicPlayerStore((s) => s.queue);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const queueSource = useMusicPlayerStore((s) => s.queueSource);
  const radioOn = useMusicPlayerStore(selectRadioOn);
  const radioLoading = useMusicPlayerStore((s) => s.radioLoading);
  const radioQueuedIds = useMusicPlayerStore((s) => s.radioQueuedIds);
  const radioExhausted = useMusicPlayerStore((s) => s.radioExhausted);
  const loadIndex = useMusicPlayerStore((s) => s._loadIndex);
  const removeFromQueue = useMusicPlayerStore((s) => s.removeFromQueue);
  const reorderQueue = useMusicPlayerStore((s) => s.reorderQueue);
  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const clearQueue = useMusicPlayerStore((s) => s.clearQueue);
  const undoQueueEdit = useMusicPlayerStore((s) => s.undoQueueEdit);
  const showToast = useUiStore((s) => s.showToast);
  const toggleRadio = useMusicPlayerStore((s) => s.toggleRadio);
  const closeOverlay = useMusicPlayerStore((s) => s.closeOverlay);
  const isHidden = useMusicHiddenFilter();
  const [leftSetting] = usePreference(SETTINGS.MUSIC_QUEUE_SWIPE_LEFT);
  const [rightSetting] = usePreference(SETTINGS.MUSIC_QUEUE_SWIPE_RIGHT);
  const leftSwipe = parseQueueSwipeAction(leftSetting, DEFAULT_LEFT_SWIPE);
  const rightSwipe = parseQueueSwipeAction(rightSetting, DEFAULT_RIGHT_SWIPE);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const radioSet = new Set(radioQueuedIds);
  const upcoming = queue
    .map((track, i) => ({ track, i }))
    .filter(({ track, i }) => i > currentIndex && !isHidden(track));
  const sortableIds = upcoming.map(({ track }) => videoIdOf(track));

  // A played song can be queued again, so rows are found among the upcoming
  // ones rather than by the first index with that id.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = upcoming.find(({ track }) => videoIdOf(track) === active.id)?.i;
    const to = upcoming.find(({ track }) => videoIdOf(track) === over.id)?.i;
    if (from === undefined || to === undefined) return;
    reorderQueue(from, to);
  };

  const offerUndo = (message: string) =>
    showToast({
      message,
      durationMs: 5000,
      actions: [{ label: getString("undo"), onSelect: undoQueueEdit }],
    });

  const handleRemove = (index: number) => {
    removeFromQueue(index);
    offerUndo(getString("music_queue_removed_toast"));
  };

  const handleAction = (index: number, action: QueueSwipeAction) => {
    if (action === "PLAY_NEXT") reorderQueue(index, currentIndex + 1);
    else if (action === "MOVE_TO_END") reorderQueue(index, queue.length - 1);
    else handleRemove(index);
  };

  const handleClear = () => {
    clearQueue();
    offerUndo(getString("music_queue_cleared_toast"));
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
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <ListX className="h-3.5 w-3.5" />
            {getString("music_clear_queue")}
          </button>
        )}
      </div>

      {queueSource && (
        <p className="mb-3 truncate px-1 text-xs text-chrome-neutral-400">
          {getString("playing_from")} <span className="font-medium text-chrome-neutral-200">{queueSource}</span>
        </p>
      )}

      {/* Scroll area */}
      <div className="hide-scrollbar -mx-1 flex-1 overflow-y-auto overflow-x-hidden px-1">
        {currentTrack && (
          <>
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-chrome-neutral-600">
              {getString("music_now_playing")}
            </p>
            <MusicItemCard
              variant="track-list"
              item={currentTrack}
              // The song is already loaded: clicking it resumes rather than starting it over.
              onPlay={() => {
                if (!useMusicPlayerStore.getState().isPlaying) togglePlay();
              }}
              onNavigate={closeOverlay}
            />
          </>
        )}

        <div className="mt-4 mb-1 flex items-center justify-between px-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-chrome-neutral-600">
            {getString("music_up_next")}
          </p>
          {radioOn && radioLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-chrome-neutral-500" />
          )}
        </div>

        {upcoming.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col">
                {upcoming.map(({ track, i }) => (
                  <QueueSwipeRow
                    key={videoIdOf(track)}
                    track={track}
                    isRadio={radioSet.has(videoIdOf(track))}
                    leftSwipe={leftSwipe}
                    rightSwipe={rightSwipe}
                    onPlay={() => void loadIndex(i)}
                    onAction={(action) => handleAction(i, action)}
                    onNavigate={closeOverlay}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : radioOn && radioExhausted ? (
          <div className="px-2 py-6 text-center">
            <p className="text-sm text-chrome-neutral-500">{getString("music_radio_ran_out")}</p>
            <p className="mt-1 text-xs text-chrome-neutral-600">{getString("music_radio_ran_out_hint")}</p>
          </div>
        ) : (
          <div className="px-2 py-6 text-center">
            <p className="text-sm text-chrome-neutral-500">{getString("music_queue_empty")}</p>
            {!radioOn && (
              <p className="mt-1 text-xs text-chrome-neutral-600">{getString("music_queue_autoplay_hint")}</p>
            )}
          </div>
        )}
      </div>

      {/* Autoplay footer */}
      <div className="mt-2 flex items-center gap-3 rounded-xl border border-chrome-neutral-800 bg-surface-container-low px-3 py-2.5">
        <Radio
          className={cx("h-5 w-5 shrink-0", radioOn ? "text-[var(--color-primary)]" : "text-chrome-neutral-500")}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-chrome-neutral-100">{getString("music_autoplay")}</p>
          <p className="line-clamp-1 text-xs text-chrome-neutral-500">{getString("music_autoplay_desc")}</p>
        </div>
        <ToggleSwitch checked={radioOn} onChange={() => toggleRadio()} />
      </div>
    </div>
  );
}
