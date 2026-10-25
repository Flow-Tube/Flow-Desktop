import { useLayoutEffect, useState, type RefObject } from "react";

/** The element's content width in px, followed as it resizes; `fallback` until measured. */
export function useElementWidth(ref: RefObject<Element | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next > 0) setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
