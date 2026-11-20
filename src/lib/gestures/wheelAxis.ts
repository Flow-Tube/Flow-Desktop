/** A pause this long between wheel events ends one gesture and starts the next (as in `wheelStep`). */
export const GESTURE_GAP_MS = 150;
/** Travel needed before a gesture is locked to one axis. */
const LOCK_PX = 12;
/** How much more one axis must move than the other to count as that axis. */
const AXIS_RATIO = 1.5;
const LINE_PX = 33;

export interface WheelGestureState {
  lastAt: number;
  /** Null until the gesture has moved far enough to tell. */
  axis: "x" | "y" | null;
  /** Unlocked travel on each axis, used to pick the axis. */
  sumX: number;
  sumY: number;
  /** Travel along the locked axis, in pixels. */
  travel: number;
  /** Set once the gesture did its thing, so its momentum does nothing more. */
  done: boolean;
}

export const newWheelGestureState = (): WheelGestureState => ({
  lastAt: Number.NEGATIVE_INFINITY,
  axis: null,
  sumX: 0,
  sumY: 0,
  travel: 0,
  done: false,
});

/**
 * Follows one two-finger swipe across its wheel events, momentum included, and locks it to the axis
 * it mostly moves along. Returns true when this event started a new gesture.
 */
export function trackWheelGesture(state: WheelGestureState, deltaX: number, deltaY: number, deltaMode: number, now: number): boolean {
  const unit = deltaMode === 1 ? LINE_PX : deltaMode === 2 ? 100 : 1;
  const fresh = now - state.lastAt > GESTURE_GAP_MS;
  if (fresh) Object.assign(state, newWheelGestureState());
  state.lastAt = now;
  const dx = deltaX * unit;
  const dy = deltaY * unit;
  if (state.axis === null) {
    state.sumX += dx;
    state.sumY += dy;
    if (Math.abs(state.sumX) + Math.abs(state.sumY) >= LOCK_PX) {
      if (Math.abs(state.sumX) > AXIS_RATIO * Math.abs(state.sumY)) state.axis = "x";
      else if (Math.abs(state.sumY) > AXIS_RATIO * Math.abs(state.sumX)) state.axis = "y";
      else state.axis = Math.abs(state.sumX) > Math.abs(state.sumY) ? "x" : "y";
      state.travel = state.axis === "x" ? state.sumX : state.sumY;
    }
  } else {
    state.travel += state.axis === "x" ? dx : dy;
  }
  return fresh;
}
