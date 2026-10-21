import { addWatchRecord } from "./api/db";
import { recordSeenShorts, reportShortView } from "./api/shorts";
import { shouldRecordWatchHistory } from "./deepFlow";
import type { ShortItem } from "../types/shorts";

/** How long a Short has to stay on screen before it counts as seen. */
export const SEEN_SHORT_DWELL_MS = 1000;
/** Below this a Short was flicked past: it stays out of history. */
const HISTORY_MIN_MS = 2000;
/** A jump back from this close to the end is the Short looping, so it was played out. */
const LOOP_NEAR_END = 0.9;

interface View {
  short: ShortItem;
  positionMs: number;
  durationMs: number;
  completed: boolean;
  seenTimer: ReturnType<typeof setTimeout>;
}

let current: View | null = null;

/**
 * Follows the Short on screen. Each viewing is reported once, when the next one starts or the
 * feed closes, so the engine hears one verdict per Short rather than every second of it.
 */
export function startShortView(short: ShortItem) {
  if (current?.short.id === short.id) return;
  finishShortView();
  current = {
    short,
    positionMs: 0,
    durationMs: 0,
    completed: false,
    seenTimer: setTimeout(() => {
      void recordSeenShorts([short.id]).catch((error) => {
        console.warn("Failed to record a seen Short", error);
      });
    }, SEEN_SHORT_DWELL_MS),
  };
}

export function noteShortProgress(id: string, positionMs: number, durationMs: number) {
  if (current?.short.id !== id) return;
  if (durationMs > 0) current.durationMs = durationMs;
  const looped =
    current.durationMs > 0 &&
    current.positionMs >= current.durationMs * LOOP_NEAR_END &&
    positionMs < current.positionMs;
  if (looped) current.completed = true;
  current.positionMs = Math.max(current.positionMs, positionMs);
}

export function noteShortEnded(id: string) {
  if (current?.short.id === id) current.completed = true;
}

export function finishShortView() {
  const view = current;
  current = null;
  if (!view) return;
  clearTimeout(view.seenTimer);
  // Never started playing: there is nothing to learn from.
  if (view.durationMs <= 0) return;
  // In history a watched Short can open related reel chains, as Flow for Android's do.
  if (view.positionMs >= HISTORY_MIN_MS && shouldRecordWatchHistory()) {
    void addWatchRecord({
      videoId: view.short.id,
      title: view.short.title,
      channelName: view.short.channelName,
      channelId: view.short.channelId ?? null,
      watchDate: new Date().toISOString(),
      watchDurationSeconds: Math.floor(view.positionMs / 1000),
      totalDurationSeconds: Math.ceil(view.durationMs / 1000),
      isMusic: false,
    }).catch((error) => {
      console.warn("Failed to save a Short to history", error);
    });
  }
  void reportShortView({
    videoId: view.short.id,
    title: view.short.title,
    channelName: view.short.channelName,
    channelId: view.short.channelId ?? null,
    positionMs: Math.round(view.positionMs),
    durationMs: Math.round(view.durationMs),
    completed: view.completed,
  }).catch((error) => {
    console.warn("Failed to report a Short view", error);
  });
}
