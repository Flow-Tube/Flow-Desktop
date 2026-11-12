import { emit } from "@tauri-apps/api/event";
import { CURRENT_WINDOW_LABEL } from "./appWindow";

export const DATA_CHANGED_EVENT = "flow:data-changed";
export const PLAYBACK_CLAIMED_EVENT = "flow:playback-claimed";
export const MUSIC_PLAY_EVENT = "flow:music-play";
export const OPEN_ROUTE_EVENT = "flow:open-route";
/** A global media key or tray click, sent by the backend to the window that last started playing. */
export const MEDIA_COMMAND_EVENT = "flow:media-command";
/** Asks the top bar to put the cursor in its search box. */
export const FOCUS_SEARCH_EVENT = "flow:focus-search";
/** Watch history changed: in this window as a DOM event, in the others through Tauri. */
export const WATCH_HISTORY_WRITTEN_EVENT = "flow:watch-history-written";

export interface DataChangedPayload {
  source: string;
  keys: string[];
}

/** Window-local bookkeeping that other windows must not reload for. */
const PRIVATE_KEYS = new Set(["tab_session"]);

/** One write to watch history, as much as a card's progress bar needs to follow it. */
export type WatchHistoryWrite =
  | { kind: "record"; videoId: string; watchedSeconds: number; totalSeconds: number; skipped: boolean }
  | { kind: "removed"; videoId: string }
  | { kind: "rewritten" };

export interface WatchHistoryWrittenPayload {
  source: string;
  write: WatchHistoryWrite;
}

let pendingKeys = new Set<string>();

/**
 * Tells the other windows a stored value changed, so their cached stores
 * reload. Writes in one tick go out as one event.
 */
export function announceSettingWrite(key: string): void {
  if (PRIVATE_KEYS.has(key)) return;
  const first = pendingKeys.size === 0;
  pendingKeys.add(key);
  if (!first) return;
  queueMicrotask(() => {
    const keys = [...pendingKeys];
    pendingKeys = new Set();
    void emit(DATA_CHANGED_EVENT, { source: CURRENT_WINDOW_LABEL, keys } satisfies DataChangedPayload).catch(() => {});
  });
}

/** Tells this window and the others that watch history changed, so progress bars follow it. */
export function announceWatchHistoryWrite(write: WatchHistoryWrite): void {
  window.dispatchEvent(new CustomEvent<WatchHistoryWrite>(WATCH_HISTORY_WRITTEN_EVENT, { detail: write }));
  void emit(WATCH_HISTORY_WRITTEN_EVENT, {
    source: CURRENT_WINDOW_LABEL,
    write,
  } satisfies WatchHistoryWrittenPayload).catch(() => {});
}
