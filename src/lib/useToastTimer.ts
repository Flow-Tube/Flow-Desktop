import { useEffect, useRef } from "react";

/** After the pointer leaves, the toast stays at least this long, so it never vanishes at once. */
const MIN_RESUME_MS = 1500;

/** Calls `onExpire` after `durationMs`, counting only the time the toast is not paused. Mount it
 * once per toast, since the countdown is not reset. */
export function useToastTimer(durationMs: number, paused: boolean, onExpire: () => void): void {
  const remaining = useRef(durationMs);
  const expire = useRef(onExpire);

  useEffect(() => {
    expire.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const delay = Math.max(remaining.current, MIN_RESUME_MS);
    const timeoutId = window.setTimeout(() => expire.current(), delay);
    return () => {
      window.clearTimeout(timeoutId);
      remaining.current = delay - (Date.now() - startedAt);
    };
  }, [paused]);
}
