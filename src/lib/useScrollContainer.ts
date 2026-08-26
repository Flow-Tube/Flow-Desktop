import { createContext, useContext, type RefObject } from "react";

/**
 * The element that actually scrolls a routed page.
 *
 * `PageWrapper` puts `overflow-y-auto` on its `<main>`, and the page components
 * render *inside* it, so a page's own root element never scrolls no matter what
 * overflow it declares — it is an auto-height block, and its box simply grows to
 * fit. Anything that needs the real scrollport (an IntersectionObserver root,
 * a scroll listener, a scroll-position read) has to reach it from here rather
 * than take a ref to its own root and assume.
 */
export const ScrollContainerContext = createContext<RefObject<HTMLElement | null> | null>(null);

/** Null outside a `PageWrapper` route — callers should fall back to the viewport. */
export function useScrollContainer(): RefObject<HTMLElement | null> | null {
  return useContext(ScrollContainerContext);
}
