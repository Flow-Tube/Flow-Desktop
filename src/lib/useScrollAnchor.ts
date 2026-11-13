import { useEffect, useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";
import { createFrameScheduler } from "./frameScheduler";
import { useScrollContainer } from "./useScrollContainer";

/** Marks the elements a page may keep in place, with a value that stays with each one. */
export const SCROLL_ANCHOR_ATTRIBUTE = "data-scroll-anchor";

export interface ScrollAnchor {
  key: string;
  /** Viewport offset of the element's top. */
  top: number;
  /** Scroll offset when it was read; at the top of the page nothing is held. */
  scrollTop: number;
}

/**
 * The first marked element whose bottom is below `viewportTop`. Marked elements are in reading
 * order, so their bottoms only grow and a binary search needs a dozen reads, not one per card.
 */
export function findScrollAnchor(elements: ArrayLike<Element>, viewportTop: number, scrollTop: number): ScrollAnchor | null {
  let low = 0;
  let high = elements.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (elements[middle]!.getBoundingClientRect().bottom > viewportTop) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  const element = found < 0 ? undefined : elements[found];
  if (!element) return null;
  const key = element.getAttribute(SCROLL_ANCHOR_ATTRIBUTE);
  return key == null ? null : { key, top: element.getBoundingClientRect().top, scrollTop };
}

/** How far to scroll so the anchor's element is back where it was, or 0. */
export function anchorCorrection(anchor: ScrollAnchor | null, root: ParentNode): number {
  if (!anchor || anchor.scrollTop <= 0) return 0;
  const element = root.querySelector(`[${SCROLL_ANCHOR_ATTRIBUTE}="${CSS.escape(anchor.key)}"]`);
  if (!element) return 0;
  const delta = element.getBoundingClientRect().top - anchor.top;
  return Math.abs(delta) >= 1 ? delta : 0;
}

/**
 * Keeps the element being read in place when content above it changes, as Chromium's scroll
 * anchoring does on its own. WebKit has none, so on Linux and macOS a list that grows or reorders
 * above the reader pushes what they were reading down the page. Where the browser already
 * anchored, the measured correction is zero. Elements are marked with
 * {@link SCROLL_ANCHOR_ATTRIBUTE} inside `rootRef`; `deps` lists whatever can move them.
 */
export function useScrollAnchor(rootRef: RefObject<HTMLElement | null>, deps: DependencyList): void {
  const scrollerRef = useScrollContainer();
  const anchorRef = useRef<ScrollAnchor | null>(null);

  useEffect(() => {
    const scroller = scrollerRef?.current;
    if (!scroller) return;
    const scheduler = createFrameScheduler(() => {
      const root = rootRef.current;
      if (!root) return;
      anchorRef.current = findScrollAnchor(
        root.querySelectorAll(`[${SCROLL_ANCHOR_ATTRIBUTE}]`),
        scroller.getBoundingClientRect().top,
        scroller.scrollTop,
      );
    });
    scroller.addEventListener("scroll", scheduler.schedule, { passive: true });
    scheduler.schedule();
    return () => {
      scroller.removeEventListener("scroll", scheduler.schedule);
      scheduler.cancel();
    };
  }, [rootRef, scrollerRef]);

  useLayoutEffect(() => {
    const scroller = scrollerRef?.current;
    const root = rootRef.current;
    if (!scroller || !root) return;
    const correction = anchorCorrection(anchorRef.current, root);
    if (correction !== 0) scroller.scrollTop += correction;
    // The correction fires no scroll event where the offset is clamped, so read the anchor again.
    anchorRef.current = findScrollAnchor(
      root.querySelectorAll(`[${SCROLL_ANCHOR_ATTRIBUTE}]`),
      scroller.getBoundingClientRect().top,
      scroller.scrollTop,
    );
    // The caller's deps are the point: re-run whenever what is above the reader can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
