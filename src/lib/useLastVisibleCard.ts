import { useEffect, type RefObject } from "react";

/** Attribute a grid puts on each card with its position. */
export const GRID_INDEX_ATTRIBUTE = "data-grid-index";

/**
 * Reports the highest position among the cards inside `containerRef` that are on screen, so a
 * feed knows how close the viewer is to its end. Re-observes when `count` changes.
 */
export function useLastVisibleCard(
  containerRef: RefObject<HTMLElement | null>,
  count: number,
  onChange: ((lastVisible: number) => void) | undefined,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!onChange || !container || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = Number(entry.target.getAttribute(GRID_INDEX_ATTRIBUTE));
        if (Number.isNaN(index)) continue;
        if (entry.isIntersecting) visible.add(index);
        else visible.delete(index);
      }
      if (visible.size > 0) onChange(Math.max(...visible));
    });
    container.querySelectorAll(`[${GRID_INDEX_ATTRIBUTE}]`).forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [containerRef, count, onChange]);
}
