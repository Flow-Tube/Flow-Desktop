import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { getWatchProgress } from "../lib/api/db";
import { CURRENT_WINDOW_LABEL } from "../lib/appWindow";
import {
  WATCH_HISTORY_WRITTEN_EVENT,
  type WatchHistoryWrite,
  type WatchHistoryWrittenPayload,
} from "../lib/windowEvents";
import { HISTORY_UPDATED_EVENT } from "./useHistoryStore";

/** Seconds watched of a video's length, as history last recorded them. */
export interface WatchProgressEntry {
  watchedSeconds: number;
  totalSeconds: number;
}

// Android's card rule: a peek is not progress, and the end credits count as finished.
const MIN_SHARE = 0.03;
const FULL_SHARE = 0.9;

/** The width of a card's progress bar, in percent: 0 for none. */
export function progressPercent(entry: WatchProgressEntry | undefined): number {
  if (!entry || entry.totalSeconds <= 0) return 0;
  const share = entry.watchedSeconds / entry.totalSeconds;
  if (share < MIN_SHARE) return 0;
  if (share >= FULL_SHARE) return 100;
  return Math.round(share * 100);
}

function entryOf(watchedSeconds: number, totalSeconds: number): WatchProgressEntry | null {
  const entry = { watchedSeconds, totalSeconds };
  return progressPercent(entry) > 0 ? entry : null;
}

interface WatchProgressState {
  progress: Map<string, WatchProgressEntry>;
  load: () => Promise<void>;
  apply: (write: WatchHistoryWrite) => void;
}

let loadGeneration = 0;
// Writes that land while a load is reading SQLite, replayed over its older answer.
let writesDuringLoad: WatchHistoryWrite[] | null = null;

export const useWatchProgressStore = create<WatchProgressState>((set, get) => ({
  progress: new Map(),
  load: async () => {
    const generation = ++loadGeneration;
    writesDuringLoad = [];
    try {
      const rows = await getWatchProgress();
      if (generation !== loadGeneration) return;
      const progress = new Map<string, WatchProgressEntry>();
      for (const [videoId, watchedSeconds, totalSeconds] of rows) {
        const entry = entryOf(watchedSeconds, totalSeconds);
        if (entry) progress.set(videoId, entry);
      }
      const replay = writesDuringLoad;
      writesDuringLoad = null;
      set({ progress });
      for (const write of replay) get().apply(write);
    } catch (error) {
      if (generation === loadGeneration) writesDuringLoad = null;
      console.warn("Failed to read watch progress", error);
    }
  },
  apply: (write) => {
    if (write.kind === "rewritten") {
      void get().load();
      return;
    }
    writesDuringLoad?.push(write);
    const current = get().progress;
    const entry =
      write.kind === "record" && !write.skipped ? entryOf(write.watchedSeconds, write.totalSeconds) : null;
    const previous = current.get(write.videoId);
    if (!entry && !previous) return;
    if (
      entry &&
      previous &&
      entry.watchedSeconds === previous.watchedSeconds &&
      entry.totalSeconds === previous.totalSeconds
    ) {
      return;
    }
    const progress = new Map(current);
    if (entry) progress.set(write.videoId, entry);
    else progress.delete(write.videoId);
    set({ progress });
  },
}));

/** How far a video was watched, in percent of its card's bar. Re-renders only when that number changes. */
export function useWatchProgressPercent(videoId: string): number {
  return useWatchProgressStore((state) => progressPercent(state.progress.get(videoId)));
}

/**
 * Loads the progress once and follows every later write: this window's own,
 * other windows' through Tauri, and history rewritten behind it (a sync merge).
 */
export function startWatchProgress(): () => void {
  const store = useWatchProgressStore.getState();
  void store.load();
  const onLocalWrite = (event: Event) => store.apply((event as CustomEvent<WatchHistoryWrite>).detail);
  const onHistoryUpdated = () => void store.load();
  window.addEventListener(WATCH_HISTORY_WRITTEN_EVENT, onLocalWrite);
  window.addEventListener(HISTORY_UPDATED_EVENT, onHistoryUpdated);
  const unlisten = listen<WatchHistoryWrittenPayload>(WATCH_HISTORY_WRITTEN_EVENT, ({ payload }) => {
    if (payload.source !== CURRENT_WINDOW_LABEL) store.apply(payload.write);
  }).catch(() => null);
  return () => {
    window.removeEventListener(WATCH_HISTORY_WRITTEN_EVENT, onLocalWrite);
    window.removeEventListener(HISTORY_UPDATED_EVENT, onHistoryUpdated);
    void unlisten.then((stop) => stop?.());
  };
}
