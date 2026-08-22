import { afterEach, describe, expect, it, vi } from "vitest";

import type { VideoSummary } from "../types/video";

vi.mock("../lib/streamResolution", () => ({
  prefetchStreamInfo: vi.fn(),
}));

import { usePlayerStore } from "./usePlayerStore";

const video = (id: string): VideoSummary => ({
  id,
  title: `Video ${id}`,
  channelName: "Flow",
});

afterEach(() => {
  usePlayerStore.getState().clearQueue();
  usePlayerStore.getState().setRepeatMode("none");
  usePlayerStore.getState().setAutoplayCandidates([]);
});

describe("video fullscreen", () => {
  it("resets fullscreen when the player is dismissed", () => {
    usePlayerStore.getState().setCurrentVideo(video("fullscreen"));
    usePlayerStore.getState().setIsVideoFullscreen(true);

    usePlayerStore.getState().dismissVideoPlayer();

    expect(usePlayerStore.getState().isVideoFullscreen).toBe(false);
  });
});

describe("video queue", () => {
  it("keeps the current video when the first upcoming item is added", () => {
    const current = video("current");
    const next = video("next");
    usePlayerStore.getState().setCurrentVideo(current);

    expect(usePlayerStore.getState().addToQueue(next)).toBe("added");
    expect(usePlayerStore.getState().queue).toEqual([current, next]);
    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(usePlayerStore.getState().addToQueue(next)).toBe("duplicate");
  });

  it("advances in order and wraps only when repeat queue is enabled", () => {
    const items = [video("one"), video("two")];
    usePlayerStore.getState().setQueue(items, 0);

    expect(usePlayerStore.getState().playNext()).toEqual(items[1]);
    expect(usePlayerStore.getState().playNext()).toBeNull();
    expect(usePlayerStore.getState().currentIndex).toBe(1);

    usePlayerStore.getState().setRepeatMode("all");
    expect(usePlayerStore.getState().playNext()).toEqual(items[0]);
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("appends a related candidate when autoplay reaches the end", () => {
    const current = video("current");
    const candidate = video("recommended");
    usePlayerStore.getState().setQueue([current], 0);
    usePlayerStore.getState().setAutoplayCandidates([candidate]);

    expect(usePlayerStore.getState().playNext(true)).toEqual(candidate);
    expect(usePlayerStore.getState().queue).toEqual([current, candidate]);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });

  it("preserves the active item while reordering around it", () => {
    const items = [video("one"), video("two"), video("three")];
    usePlayerStore.getState().setQueue(items, 1);

    usePlayerStore.getState().moveQueueItem(0, 2);

    expect(usePlayerStore.getState().queue.map((item) => item.id)).toEqual(["two", "three", "one"]);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("two");
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });
});
