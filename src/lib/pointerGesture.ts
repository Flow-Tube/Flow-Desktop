import type { PlaybackRate } from "../store/usePlayerStore";
import { normalizePlaybackRate } from "./settings/playerRuntime";

/** How long a press must stay still before it speeds playback up. */
export const LONG_PRESS_MS = 420;

/** How far a press can wander and still count as still. */
export const DRAG_THRESHOLD_PX = 4;

/** The long-press speed setting's value that turns hold-to-speed-up off. */
export const LONG_PRESS_OFF = "off";

/** The speed a long press plays at, or null when the setting turns it off. */
export function longPressRate(setting: string): PlaybackRate | null {
  return setting === LONG_PRESS_OFF ? null : normalizePlaybackRate(setting, 2);
}

export interface PressMove {
  /** Only the pop-out player is its own window to move. */
  canDragWindow: boolean;
  /** The press already sped playback up. */
  boosting: boolean;
  dx: number;
  dy: number;
}

/**
 * Whether a press that moved turns into dragging the window. Moving before the
 * hold timer fires means the press was never going to be a hold; a press held
 * still stays a speed-up, as it does in the main window.
 */
export function shouldStartWindowDrag({ canDragWindow, boosting, dx, dy }: PressMove): boolean {
  return canDragWindow && !boosting && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
}
