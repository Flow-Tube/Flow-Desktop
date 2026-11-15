import { animate, motionValue } from "framer-motion";

/**
 * How far the full player has grown out of the dock: 0 is the dock, 1 the whole window. The dock's
 * drag and the player's open and close all move this one value, as Android's player sheet does.
 */
export const sheetProgress = motionValue(0);

/** Android's sheet spring: damping ratio 0.85 at stiffness 380. */
const SHEET_SPRING = { type: "spring", stiffness: 380, damping: 2 * 0.85 * Math.sqrt(380) } as const;

/**
 * The card's vertical stretch: it overshoots to 1.045 tall as it opens and lands squashed as it
 * sinks back into the mini player, springing back to 1 (Android's `MusicSheetSettleEffect`).
 */
export const sheetStretch = motionValue(1);

/** How far, in pixels, the mini player is pulled down below its place while being closed. */
export const sheetPull = motionValue(0);

/** How far, in pixels, the mini player is swiped sideways. */
export const sheetSwipe = motionValue(0);

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function stretchFor(target: 0 | 1, from: number, squash: number | undefined): void {
  if (reducedMotion()) return;
  if (target === 1 && from < 0.95) {
    void animate(sheetStretch, [1, 1.045, 1], { duration: 0.25, times: [0, 0.5, 1], ease: "linear" });
  } else if (target === 0 && from > 0.05) {
    sheetStretch.jump(squash ?? 0.96);
    // Android's medium bounce at low stiffness.
    void animate(sheetStretch, 1, { type: "spring", stiffness: 200, damping: 2 * 0.5 * Math.sqrt(200) });
  }
}

/** Counts sheet animations, so a finished one can tell whether a newer one took over. */
let sheetRun = 0;

/**
 * Animates the sheet to `target` and leaves it exactly there: an animation that is skipped or cut
 * short can stop shy of its end, and a dock left at a sliver of progress stays see-through.
 * Resolves false when a newer animation or drag took over.
 */
interface SettleOptions {
  velocity?: number;
  squash?: number;
}

let queued: SettleOptions = {};

/** Hands the next settle the feel of the gesture that asked for it, for a settle started elsewhere. */
export function queueSettle(options: SettleOptions): void {
  queued = options;
}

export async function settleSheet(target: 0 | 1, given: SettleOptions = {}): Promise<boolean> {
  measureSheet();
  const options = { ...queued, ...given };
  queued = {};
  const run = ++sheetRun;
  stretchFor(target, sheetProgress.get(), options.squash);
  await animate(sheetProgress, target, { ...SHEET_SPRING, velocity: options.velocity ?? 0 });
  if (run !== sheetRun) return false;
  sheetProgress.jump(target);
  return true;
}

/** Stops a running settle, for a drag that takes the sheet by hand. */
export function holdSheet(): void {
  sheetRun += 1;
  sheetProgress.stop();
}

/** Upward speed, in pixels a second, past which a release opens or closes whatever the position. */
const FLING_PX_PER_S = 300;

export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where a released sheet settles: a fling goes its way, a slow release to the nearer end. */
export function sheetTarget(progress: number, upwardVelocity: number): 0 | 1 {
  if (upwardVelocity > FLING_PX_PER_S) return 1;
  if (upwardVelocity < -FLING_PX_PER_S) return 0;
  return progress >= 0.5 ? 1 : 0;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The mini player is gone by halfway, as Android's is. */
export const dockOpacity = (progress: number) => clamp01(1 - progress * 2);

/** The player's ground comes in under the mini player as the card grows. */
export const sheetOpacity = (progress: number) => clamp01(progress * 4);

/** The player's content comes in from a quarter of the way, as on Android. */
export const contentOpacity = (progress: number) => clamp01((progress - 0.25) / 0.75);

/** The content rises 24 px as it fades in. */
export const contentRise = (progress: number) => 24 * (1 - contentOpacity(progress));

/** A mini player pulled down this many heights closes; it can be pulled at most 1.5 heights. */
const CLOSE_PULL_HEIGHTS = 0.5;
const CLOSE_PULL_LIMIT_HEIGHTS = 1.5;
/** A downward flick this fast, in px a second, closes it whatever the distance. */
const CLOSE_FLING_PX_PER_S = 300;
/** It is gone by 0.6 of its height, so it never sits see-through over the page below. */
const CLOSE_FADE_HEIGHTS = 0.6;

export const clampPull = (pull: number, height: number) => Math.min(height * CLOSE_PULL_LIMIT_HEIGHTS, Math.max(0, pull));

/** The mini player's opacity while pulled down, eased out as Android's `FastOutSlowIn`. */
export function pullOpacity(pull: number, height: number): number {
  const t = clamp01(pull / (height * CLOSE_FADE_HEIGHTS));
  return 1 - t * t * (3 - 2 * t);
}

/** Whether a pull down on the mini player closes it: past half its height, or flicked down. */
export function shouldClosePulled(pull: number, height: number, downwardVelocity: number): boolean {
  return pull > 0 && (pull > height * CLOSE_PULL_HEIGHTS || downwardVelocity > CLOSE_FLING_PX_PER_S);
}

/** Movement that counts as a direction, and the speed that counts as a fling, for a drag on the open player. */
const DIRECTION_PX = 5;
const OPEN_FLING_PX_PER_S = 150;

/**
 * Where a drag on the open player settles, Android's rule: a move up stays open, a move down past
 * 5 px collapses, a smaller one goes with a fling, and otherwise to the nearer end.
 */
export function openDragTarget(progress: number, downward: number, downwardVelocity: number): 0 | 1 {
  if (downward <= 0) return 1;
  if (downward > DIRECTION_PX) return 0;
  if (Math.abs(downwardVelocity) > OPEN_FLING_PX_PER_S) return downwardVelocity > 0 ? 0 : 1;
  return progress > 0.5 ? 1 : 0;
}

/** How squashed the card lands after a drag down, more the further it was open (0.97 at most). */
export const collapseSquash = (progress: number) => 1 - 0.03 * clamp01(progress);

export interface CardBox {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

/**
 * The card at `progress`, Android's `MusicSheetGeometry`: from the mini player's resting box,
 * rounded as the mini player is, to the whole player below the title bar, square. A pull down moves
 * the resting card down. Without a mini player to grow from, it rises from the bottom edge.
 */
export function cardBox(progress: number, pull: number, dock: Box | null, sheet: Box, restRadius: number): CardBox {
  const p = clamp01(progress);
  const from = dock ?? { top: sheet.bottom, right: sheet.right, bottom: sheet.bottom, left: sheet.left };
  const lerp = (start: number, end: number) => start + (end - start) * p;
  const left = lerp(from.left, sheet.left);
  const top = lerp(from.top, sheet.top) + pull;
  return {
    left,
    top,
    width: lerp(from.right, sheet.right) - left,
    height: lerp(from.bottom, sheet.bottom) + pull - top,
    radius: restRadius * (1 - p),
  };
}

/** The full player's box: the window below the title bar. */
export function sheetBox(): Box {
  const titlebar = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--app-titlebar-height"),
  );
  return { top: titlebar || 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 };
}

let dockElement: HTMLElement | null = null;

/** The dock's pill, which the sheet grows out of and shrinks back into. */
export function registerSheetDock(element: HTMLElement | null): void {
  dockElement = element;
}

export function sheetDockBox(): Box | null {
  return dockElement?.isConnected ? dockElement.getBoundingClientRect() : null;
}

let rest: { dock: Box | null; sheet: Box } = { dock: null, sheet: { top: 0, right: 0, bottom: 0, left: 0 } };

/**
 * Measures where the card rests and where it opens to, for the frames that follow. Measured at the
 * start of a drag or a settle and when the window or the mini player resizes, never per frame: a
 * layout read each frame while the card moves made every frame lay the page out again. Offsets
 * are used, not the screen box, so the sheet's own entrance slide never shifts the resting box.
 */
export function measureSheet(): void {
  const el = dockElement?.isConnected ? dockElement : null;
  const dock = el ? { left: el.offsetLeft, top: el.offsetTop, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight } : null;
  rest = { dock: dock && dock.right > dock.left ? dock : null, sheet: sheetBox() };
  sheetMeasured.set(sheetMeasured.get() + 1);
}

/** Counts measurements, so the card's box is worked out again after one even when nothing moves. */
export const sheetMeasured = motionValue(0);

/** The last measured resting box and open box. */
export const sheetRest = () => rest;
