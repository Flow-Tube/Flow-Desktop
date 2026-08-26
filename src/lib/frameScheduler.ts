/**
 * Coalesces repeated requests into one callback per animation frame.
 *
 * Used for work that reads layout (scroll offsets, element geometry), where a
 * per-event read is wasted: the result cannot change again until the next paint.
 *
 * Scheduling cancels and replaces any pending frame rather than returning early
 * on a busy flag. An early-return guard latches permanently if the handle is
 * ever left set — which is exactly what happens when a component's cleanup
 * cancels the frame without clearing it and the component then mounts again, as
 * StrictMode does on every mount in development. A latched scheduler is silent:
 * the work simply never runs again.
 */
export interface FrameScheduler {
  /** Runs `work` before the next paint, replacing any already-pending run. */
  schedule: () => void;
  /** Drops a pending run. Scheduling afterwards still works. */
  cancel: () => void;
}

export function createFrameScheduler(work: () => void): FrameScheduler {
  let frame: number | null = null;

  const cancel = () => {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  };

  return {
    schedule: () => {
      cancel();
      frame = requestAnimationFrame(() => {
        frame = null;
        work();
      });
    },
    cancel,
  };
}
