import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api/music", () => ({
  getMusicWatchQueue: vi.fn(),
  getMusicQueueContinuation: vi.fn(),
  rankMusicCandidates: vi.fn(),
}));

import { useMusicPlayerStore } from "./useMusicPlayerStore";

describe("the published music clock", () => {
  beforeEach(() => {
    useMusicPlayerStore.setState({ progress: 0, duration: 200 });
  });

  it("notifies subscribers once per whole second", () => {
    const listener = vi.fn();
    const unsubscribe = useMusicPlayerStore.subscribe(listener);
    const { _syncTime } = useMusicPlayerStore.getState();
    for (const t of [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]) _syncTime(t, 200);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(useMusicPlayerStore.getState().progress).toBe(2);
  });

  it("publishes a new duration even within the same second", () => {
    useMusicPlayerStore.getState()._syncTime(0.4, 215);
    expect(useMusicPlayerStore.getState().duration).toBe(215);
  });

  it("keeps the listed duration when the element reports an endless stream", () => {
    useMusicPlayerStore.getState()._syncTime(3.2, Number.POSITIVE_INFINITY);
    expect(useMusicPlayerStore.getState()).toMatchObject({ progress: 3.2, duration: 200 });
  });
});
