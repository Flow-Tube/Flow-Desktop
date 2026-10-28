import { emit } from "@tauri-apps/api/event";
import { CURRENT_WINDOW_LABEL } from "./appWindow";

export const DATA_CHANGED_EVENT = "flow:data-changed";
export const PLAYBACK_CLAIMED_EVENT = "flow:playback-claimed";
export const MUSIC_PLAY_EVENT = "flow:music-play";
export const OPEN_ROUTE_EVENT = "flow:open-route";

export interface DataChangedPayload {
  source: string;
  keys: string[];
}

/** Window-local bookkeeping that other windows must not reload for. */
const PRIVATE_KEYS = new Set(["tab_session"]);

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
