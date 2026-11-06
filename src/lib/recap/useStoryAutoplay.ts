import { useCallback, useEffect, useRef, useState } from "react";

import { advanceStory, STORY_PAGE_MS, storyPageAt } from "./storyClock";

/**
 * The story's clock. Runs off animation frames, which stop while the window is hidden, and writes
 * progress straight to the bar so a running page never re-renders. It stops while the page is held
 * or paused and resumes from where it was.
 */
export function useStoryAutoplay(pageCount: number) {
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const elapsed = useRef(0);
  const progressBar = useRef<HTMLDivElement | null>(null);

  const paint = () => {
    if (progressBar.current) progressBar.current.style.transform = `scaleX(${elapsed.current / STORY_PAGE_MS})`;
  };

  const goTo = useCallback(
    (next: number) => {
      const position = storyPageAt(next, pageCount);
      elapsed.current = position.elapsedMs;
      setPage(position.page);
    },
    [pageCount],
  );

  useEffect(() => {
    paint();
    if (paused || held) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const position = advanceStory({ page, elapsedMs: elapsed.current }, now - last, pageCount);
      last = now;
      elapsed.current = position.elapsedMs;
      paint();
      if (position.page !== page) {
        setPage(position.page);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [page, paused, held, pageCount]);

  return { page, paused, setPaused, setHeld, goTo, progressBar };
}
