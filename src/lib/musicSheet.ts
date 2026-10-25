import { animate, motionValue } from "framer-motion";

/**
 * How far the full player has grown out of the dock: 0 is the dock, 1 the whole window. The dock's
 * drag and the player's open and close all move this one value, as Android's player sheet does.
 */
export const sheetProgress = motionValue(0);

/** Android's sheet spring, StiffnessMediumLow with no bounce. */
const SHEET_SPRING = { type: "spring", stiffness: 400, damping: 40 } as const;

/** Counts sheet animations, so a finished one can tell whether a newer one took over. */
let sheetRun = 0;

/**
 * Animates the sheet to `target` and leaves it exactly there: an animation that is skipped or cut
 * short can stop shy of its end, and a dock left at a sliver of progress stays see-through.
 * Resolves false when a newer animation or drag took over.
 */
export async function settleSheet(target: 0 | 1): Promise<boolean> {
  const run = ++sheetRun;
  await animate(sheetProgress, target, SHEET_SPRING);
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

/** The dock is gone by a quarter of the way, as Android's mini player is. */
export const dockOpacity = (progress: number) => clamp01(1 - progress * 4);

/** The player's ground comes in as the dock goes, so the two never show at once. */
export const sheetOpacity = (progress: number) => clamp01(progress * 4);

/** The player's content waits for the sheet to clear the dock, then comes in over the next quarter. */
export const contentOpacity = (progress: number) => clamp01((progress - 0.15) * 4);

/** The content grows the last stretch to full size, so the player scales up out of the dock. */
export const contentScale = (progress: number) => 0.92 + 0.08 * clamp01(progress);

const DOCK_RADIUS_PX = 16;

/**
 * The sheet's clip at `progress`, in the player's own box: from the dock's rectangle at 0 to the
 * whole player at 1. Without a dock to grow from, it rises from the bottom edge.
 */
export function sheetClip(progress: number, dock: Box | null, sheet: Box): string {
  const p = clamp01(progress);
  if (p >= 1) return "none";
  const from = dock ?? { top: sheet.bottom, right: sheet.right, bottom: sheet.bottom, left: sheet.left };
  const lerp = (start: number) => Math.max(0, start * (1 - p));
  const top = lerp(from.top - sheet.top);
  const right = lerp(sheet.right - from.right);
  const bottom = lerp(sheet.bottom - from.bottom);
  const left = lerp(from.left - sheet.left);
  const px = (value: number) => `${Math.round(value * 10) / 10}px`;
  return `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)} round ${px(DOCK_RADIUS_PX * (1 - p))})`;
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
