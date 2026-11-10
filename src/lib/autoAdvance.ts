import type { RepeatMode } from "../store/usePlayerStore";
import type { VideoSummary } from "../types/video";

interface QueueState {
  queue: VideoSummary[];
  currentIndex: number;
  repeatMode: RepeatMode;
  autoplayCandidates: VideoSummary[];
}

interface AutoAdvanceSettings {
  autoplay: boolean;
  queueAutoplay: boolean;
}

/**
 * What plays by itself when a video ends, in Flow for Android's order: while the queue has more,
 * only the queue switch counts and a suggestion never jumps ahead of it. Past the end of the queue,
 * only the related videos switch counts.
 */
export function nextAutoAdvanceVideo(state: QueueState, settings: AutoAdvanceSettings): VideoSummary | null {
  const { queue, currentIndex, repeatMode, autoplayCandidates } = state;
  if (queue.length === 0) return null;
  const queued = queue[currentIndex + 1] ?? (repeatMode === "all" ? queue[0] : undefined);
  if (queued) return settings.queueAutoplay ? queued : null;
  if (!settings.autoplay) return null;
  const queuedIds = new Set(queue.map((item) => item.id));
  return autoplayCandidates.find((item) => !queuedIds.has(item.id)) ?? null;
}
