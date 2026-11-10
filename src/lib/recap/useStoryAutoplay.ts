import { useCallback, useEffect, useRef, useState } from "react";

import { advanceStory, hasFinished, storyPageAt } from "./storyClock";

/**
 * The story's clock. Runs off animation frames and writes progress straight to the bar, so a running
 * page never re-renders. It stops while the page is held or paused and while Flow isn't the window
 * in front, and resumes from where it was. The last page waits, and `replay` starts over.
 */
export function useStoryAutoplay(durations: readonly number[], onFrame?: (fraction: number) => void) {
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [away, setAway] = useState(() => document.hidden);
  const [finished, setFinished] = useState(false);
  const elapsed = useRef(0);
  const shownPage = useRef(0);
  const progressBar = useRef<HTMLDivElement | null>(null);
  const frameListener = useRef(onFrame);
  frameListener.current = onFrame;
  const pageCount = durations.length;

  const paint = useCallback(() => {
    const fraction = Math.min(1, elapsed.current / (durations[shownPage.current] ?? 1));
    if (progressBar.current) progressBar.current.style.transform = `scaleX(${fraction})`;
    frameListener.current?.(fraction);
  }, [durations]);

  const show = useCallback((next: number) => {
    shownPage.current = next;
    elapsed.current = 0;
    setPage(next);
    setFinished(false);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      const position = storyPageAt(next, pageCount);
      // Stepping past either end stays put; it must not rewind the page's clock.
      if (position.page !== shownPage.current) show(position.page);
    },
    [pageCount, show],
  );

  const replay = useCallback(() => {
    show(0);
    setPaused(false);
  }, [show]);

  useEffect(() => {
    const check = () => setAway(document.hidden);
    const leave = () => setAway(true);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  useEffect(() => {
    paint();
    if (paused || held || away || finished) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const position = advanceStory({ page, elapsedMs: elapsed.current }, now - last, durations);
      last = now;
      elapsed.current = position.elapsedMs;
      paint();
      if (position.page !== page) {
        show(position.page);
        return;
      }
      if (hasFinished(position, durations)) {
        setFinished(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [page, paused, held, away, finished, durations, paint, show]);

  return { page, paused, finished, setPaused, setHeld, goTo, replay, progressBar };
}
