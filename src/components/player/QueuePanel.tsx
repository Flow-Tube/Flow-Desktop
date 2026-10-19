import {
  ChevronDown,
  ChevronUp,
  ListVideo,
  Play,
  Repeat,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { useProxyImageSrc } from "../../lib/useImageProxy";
import { usePlayerStore, type RepeatMode } from "../../store/usePlayerStore";

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

export function QueuePanel() {
  const toSrc = useProxyImageSrc();
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
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

  return (
    <section className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-low text-chrome-neutral-100">
      <header className="flex shrink-0 items-center justify-between border-b border-chrome-neutral-800 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListVideo className="h-4 w-4 text-chrome-neutral-400" />
            <h2 className="text-base font-medium text-chrome-neutral-100">{getString("queue_title")}</h2>
          </div>
          <p className="mt-0.5 font-mono text-xs text-chrome-neutral-500">
            {getString("queue_upcoming_count", upcomingCount)}
          </p>
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
        <button
          type="button"
          onClick={clearUpcoming}
          disabled={upcomingCount === 0}
          className="ml-auto rounded-full px-3 py-2 text-xs font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {getString("queue_clear_upcoming")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <ListVideo className="h-8 w-8 text-chrome-neutral-600" />
            <p className="mt-3 text-sm font-medium text-chrome-neutral-300">{getString("queue_empty")}</p>
            <p className="mt-1 text-xs text-chrome-neutral-500">{getString("queue_empty_body")}</p>
          </div>
        ) : (
          <div className="divide-y divide-chrome-neutral-800">
            {queue.map((video, index) => {
              const isCurrent = index === currentIndex;
              return (
                <div
                  key={`${video.id}-${index}`}
                  className={`group flex items-center gap-3 px-3 py-3 transition-colors duration-200 ease-out ${
                    isCurrent ? "bg-surface-container" : "hover:bg-surface-container-high"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => playQueueItem(index)}
                    className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-surface-container-highest"
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
                    onClick={() => playQueueItem(index)}
                    className="min-w-0 flex-1 text-left"
                  >
                    {isCurrent ? (
                      <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
                        {getString("queue_now_playing")}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block line-clamp-2 text-sm font-medium leading-snug text-chrome-neutral-100">
                      {video.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-chrome-neutral-500">{video.channelName}</span>
                  </button>

                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      title={getString("move_up")}
                      aria-label={getString("move_up")}
                      disabled={index === 0}
                      onClick={() => moveQueueItem(index, index - 1)}
                      className="grid h-7 w-7 place-items-center rounded-full text-chrome-neutral-500 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-200 disabled:opacity-25"
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      title={getString("move_down")}
                      aria-label={getString("move_down")}
                      disabled={index === queue.length - 1}
                      onClick={() => moveQueueItem(index, index + 1)}
                      className="grid h-7 w-7 place-items-center rounded-full text-chrome-neutral-500 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-200 disabled:opacity-25"
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      type="button"
                      title={getString("remove")}
                      aria-label={getString("remove")}
                      disabled={isCurrent}
                      onClick={() => removeFromQueue(index)}
                      className="grid h-7 w-7 place-items-center rounded-full text-chrome-neutral-500 transition-colors hover:bg-chrome-red-950/30 hover:text-chrome-red-400 disabled:opacity-25"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default QueuePanel;
