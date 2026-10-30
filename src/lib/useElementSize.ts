import { useEffect, useState, type RefObject } from "react";

import { createFrameScheduler } from "./frameScheduler";

export interface ElementSize {
  width: number;
  height: number;
}

/** An element's content size, re-read at most once per frame while it resizes. */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    const scheduler = createFrameScheduler(measure);
    const observer = new ResizeObserver(() => scheduler.schedule());
    // No immediate read: painting size 0 first lets the artwork grow in on mount.
    observer.observe(element);
    return () => {
      observer.disconnect();
      scheduler.cancel();
    };
  }, [ref]);

  return size;
}
