import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFrameScheduler } from "./frameScheduler";

describe("createFrameScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advances past the next animation frame. */
  const nextFrame = () => vi.advanceTimersByTime(32);

  it("runs the work once for a burst of requests in the same frame", () => {
    const work = vi.fn();
    const scheduler = createFrameScheduler(work);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(work).not.toHaveBeenCalled();

    nextFrame();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("runs again on the next frame after the first run", () => {
    const work = vi.fn();
    const scheduler = createFrameScheduler(work);

    scheduler.schedule();
    nextFrame();
    scheduler.schedule();
    nextFrame();

    expect(work).toHaveBeenCalledTimes(2);
  });

  it("drops a pending run when cancelled", () => {
    const work = vi.fn();
    const scheduler = createFrameScheduler(work);

    scheduler.schedule();
    scheduler.cancel();
    nextFrame();

    expect(work).not.toHaveBeenCalled();
  });

  /*
    The regression this exists for. A cancel that left the frame handle set made
    every later schedule() a no-op, and the caller — ShelfScroller — silently
    stopped measuring, so its nav arrows never appeared at all. StrictMode makes
    this the *normal* path in development: it mounts, unmounts, and remounts
    every component, and refs survive that simulated unmount.
  */
  it("still schedules after a cancel, rather than latching off", () => {
    const work = vi.fn();
    const scheduler = createFrameScheduler(work);

    scheduler.schedule();
    scheduler.cancel();

    scheduler.schedule();
    nextFrame();

    expect(work).toHaveBeenCalledTimes(1);
  });

  it("is safe to cancel when nothing is pending", () => {
    const scheduler = createFrameScheduler(vi.fn());

    expect(() => {
      scheduler.cancel();
      scheduler.cancel();
    }).not.toThrow();
  });
});
