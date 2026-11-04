import { volumeAfterWheel } from "./musicPlayerKeys";

/** Pixels of wheel travel per volume step while a gesture keeps going. */
const STEP_PX = 100;
/** A pause this long ends a gesture, so each slow wheel notch moves the volume on its own. */
const GESTURE_GAP_MS = 150;
const LINE_PX = 33;

export interface WheelGesture {
  travel: number;
  lastAt: number;
}

export const newWheelGesture = (): WheelGesture => ({ travel: 0, lastAt: Number.NEGATIVE_INFINITY });

/**
 * Turns wheel events into volume steps: -1 is louder, 1 is quieter, 0 is none yet. A trackpad swipe
 * sends dozens of small events plus momentum, and counting each one as a step would run the whole
 * range in one flick. So a gesture steps once at its start and then once per `STEP_PX` of travel.
 */
export function wheelStep(
  gesture: WheelGesture,
  deltaY: number,
  deltaMode: number,
  now: number,
): -1 | 0 | 1 {
  if (deltaY === 0) return 0;
  const direction = deltaY < 0 ? -1 : 1;
  const px = deltaY * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? STEP_PX : 1);
  const fresh = now - gesture.lastAt > GESTURE_GAP_MS || Math.sign(gesture.travel) === -direction;
  gesture.lastAt = now;
  if (fresh) {
    gesture.travel = 0;
    return direction;
  }
  gesture.travel += px;
  if (Math.abs(gesture.travel) < STEP_PX) return 0;
  gesture.travel = direction * (Math.abs(gesture.travel) % STEP_PX);
  return direction;
}

export interface WheelVolumeChange {
  volume?: number;
  unmute: boolean;
}

/**
 * What one step does. While muted the saved level is kept: scrolling down changes nothing, and
 * scrolling up unmutes to that level.
 */
export function wheelVolumeChange(volume: number, muted: boolean, step: -1 | 1): WheelVolumeChange {
  if (!muted) return { volume: volumeAfterWheel(volume, step), unmute: false };
  if (step > 0) return { unmute: false };
  return volume > 0 ? { unmute: true } : { volume: volumeAfterWheel(0, step), unmute: true };
}
