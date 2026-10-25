import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, useTransform, type MotionValue } from "framer-motion";
import { ArrowDownToLine, GripVertical, ListStart, Radio, X } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { leavesList, swipeActionFor, type QueueSwipeAction } from "../../lib/queueRowSwipe";
import { useQueueRowSwipe } from "../../lib/useQueueRowSwipe";
import type { SongItem } from "../../types/music";
import { MusicItemCard } from "./MusicItemCard";

const videoIdOf = (t: SongItem): string => t.videoId ?? t.id;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const ACTION_LOOK: Record<QueueSwipeAction, { label: () => string; icon: ReactNode; colors: string }> = {
  PLAY_NEXT: {
    label: () => getString("music_play_next"),
    icon: <ListStart className="h-5 w-5" />,
    colors: "bg-[var(--player-primary-container)] text-[var(--player-on-primary-container)]",
  },
  MOVE_TO_END: {
    label: () => getString("music_move_to_end"),
    icon: <ArrowDownToLine className="h-5 w-5" />,
    colors: "bg-surface-container-highest text-chrome-neutral-100",
  },
  REMOVE: {
    label: () => getString("music_remove_from_queue"),
    icon: <X className="h-5 w-5" />,
    colors: "bg-error text-white",
  },
};

/** Android's reveal: a pill as wide as the row has moved, with the action's icon at its far end. */
function SwipeReveal({ x, side, action, targeted }: {
  x: MotionValue<number>;
  side: -1 | 1;
  action: QueueSwipeAction;
  targeted: boolean;
}) {
  const width = useTransform(x, (value) => Math.abs(value));
  const iconOpacity = useTransform(x, (value) => Math.min(1, Math.abs(value) / 56) * (targeted ? 1 : 0.88));
  const look = ACTION_LOOK[action];
  const towardsLeft = side < 0;
  return (
    <motion.div
      aria-hidden
      style={{ width }}
      className={cx(
        "pointer-events-none absolute inset-y-0.5 flex items-center overflow-hidden rounded-full transition-opacity duration-150",
        towardsLeft ? "right-2 justify-end" : "left-2 justify-start",
        look.colors,
        targeted ? "opacity-100" : "opacity-80",
      )}
    >
      <motion.span
        style={{ opacity: iconOpacity }}
        className={cx("px-3.5 transition-transform duration-100", targeted ? "scale-110" : "scale-95")}
      >
        {look.icon}
      </motion.span>
    </motion.div>
  );
}

interface QueueSwipeRowProps {
  track: SongItem;
  isRadio: boolean;
  leftSwipe: QueueSwipeAction;
  rightSwipe: QueueSwipeAction;
  onPlay: () => void;
  onAction: (action: QueueSwipeAction) => void;
  onNavigate: () => void;
}

/**
 * An Up next row: hold the handle to reorder, swipe either way for what the swipe settings say,
 * as on Android. The same actions sit in the row's menu, and Delete removes the focused row.
 */
export function QueueSwipeRow({ track, isRadio, leftSwipe, rightSwipe, onPlay, onAction, onNavigate }: QueueSwipeRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: videoIdOf(track),
  });
  const rowRef = useRef<HTMLDivElement | null>(null);
  const swipe = useQueueRowSwipe(
    !isDragging,
    () => rowRef.current?.offsetWidth ?? 0,
    (towardsLeft) => leavesList(towardsLeft ? leftSwipe : rightSwipe),
    (towardsLeft) => onAction(towardsLeft ? leftSwipe : rightSwipe),
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    onAction("REMOVE");
  };

  const menuAction = (action: QueueSwipeAction, id: string) => ({
    id,
    label: ACTION_LOOK[action].label(),
    icon: ACTION_LOOK[action].icon,
    onSelect: () => onAction(action),
  });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        rowRef.current = node;
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onKeyDown={onKeyDown}
      className={cx("group/queue relative overflow-hidden rounded-lg", isDragging && "z-10 opacity-80")}
    >
      {swipe.side !== 0 && (
        <SwipeReveal
          x={swipe.x}
          side={swipe.side}
          action={swipeActionFor(swipe.side, leftSwipe, rightSwipe)}
          targeted={swipe.targeted}
        />
      )}
      <motion.div
        style={{ x: swipe.x }}
        {...swipe.bind}
        className="relative flex select-none items-center rounded-lg"
      >
        <button
          type="button"
          data-drag-handle
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
            onNavigate={onNavigate}
            appendActions={[
              menuAction("PLAY_NEXT", "queue-play-next"),
              menuAction("MOVE_TO_END", "queue-move-to-end"),
              menuAction("REMOVE", "remove-from-queue"),
            ]}
          />
        </div>
      </motion.div>
    </div>
  );
}
