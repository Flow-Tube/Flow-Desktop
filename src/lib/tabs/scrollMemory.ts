/** Scroll offsets by history entry key. Kept out of any store: a scroll must never re-render. */
const offsets = new Map<string, number>();

/** Long enough for a cached feed to render, short enough that a slow page never yanks the view later. */
const RESTORE_WINDOW_MS = 2_000;
const RESTORE_STEP_MS = 100;

export function rememberScroll(key: string, top: number): void {
  offsets.set(key, top);
}

export function recalledScroll(key: string): number {
  return offsets.get(key) ?? 0;
}

/**
 * Pages render their content after the route changes (cached feeds a frame or
 * two later, fetched ones much later), so a saved offset is often out of reach
 * at first. Retry until it sticks, the window runs out, or the user scrolls.
 */
export function restoreScroll(container: HTMLElement, top: number): () => void {
  container.scrollTo({ top, left: 0 });
  if (top <= 0) return () => {};

  const userEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  const startedAt = Date.now();
  let timer: number | undefined;

  const stop = () => {
    window.clearInterval(timer);
    userEvents.forEach((name) => container.removeEventListener(name, stop));
  };

  timer = window.setInterval(() => {
    if (Math.abs(container.scrollTop - top) < 2 || Date.now() - startedAt > RESTORE_WINDOW_MS) {
      stop();
      return;
    }
    container.scrollTo({ top, left: 0 });
  }, RESTORE_STEP_MS);
  userEvents.forEach((name) => container.addEventListener(name, stop, { passive: true }));
  return stop;
}
