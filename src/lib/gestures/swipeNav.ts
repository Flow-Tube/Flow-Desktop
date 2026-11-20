/** Sideways travel that goes back or forward. */
export const SWIPE_COMMIT_PX = 120;

/** Places a sideways swipe never navigates from: the player, sliders, fields, dialogs. */
const KEEPS_SWIPES = '#flow-player-root, [role="slider"], input, textarea, select, [contenteditable="true"], [aria-modal="true"], [data-keeps-swipes]';

/** True when `element` can still scroll sideways the way `deltaX` pushes, in either text direction. */
export function canScrollSideways(element: Element, deltaX: number): boolean {
  const range = element.scrollWidth - element.clientWidth;
  if (range <= 1) return false;
  const overflow = getComputedStyle(element).overflowX;
  if (overflow !== "auto" && overflow !== "scroll") return false;
  // Right-to-left boxes count scrollLeft from 0 at the start down to -range at the end.
  const rtl = getComputedStyle(element).direction === "rtl";
  const min = rtl ? -range : 0;
  const max = rtl ? 0 : range;
  return deltaX > 0 ? element.scrollLeft < max - 1 : element.scrollLeft > min + 1;
}

/** Whether a sideways swipe starting over `target` may go back or forward. */
export function swipeMayNavigate(target: EventTarget | null, deltaX: number): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(KEEPS_SWIPES)) return false;
  for (let element: Element | null = target; element && element !== document.documentElement; element = element.parentElement) {
    if (canScrollSideways(element, deltaX)) return false;
  }
  return true;
}

/**
 * -1 for back and 1 for forward. Fingers moving toward the start of the line go forward, as in
 * Safari: in a left-to-right layout a swipe to the right (negative deltaX) goes back, mirrored in
 * right-to-left.
 */
export function swipeHistoryDelta(travel: number, rtl: boolean): -1 | 1 {
  const fingersRight = travel < 0;
  return fingersRight !== rtl ? -1 : 1;
}
