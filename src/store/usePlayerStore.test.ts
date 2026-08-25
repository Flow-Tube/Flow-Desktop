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

describe("pop-out mini player handoff", () => {
  it("stops rendering here once the pop-out window owns playback", () => {
    usePlayerStore.getState().setQueue([video("popped")], 0);

    usePlayerStore.getState().enterVideoWindowPip();

    expect(usePlayerStore.getState().videoPlayerMode).toBe("window");
    expect(usePlayerStore.getState().isVideoFullscreen).toBe(false);
  });

  it("hands playback back only to the video it belongs to", () => {
    usePlayerStore.getState().setQueue([video("handoff")], 0);
    usePlayerStore.getState().setPipHandoff("handoff", 128, true);

    expect(usePlayerStore.getState().consumePipHandoff("other")).toBeNull();
    expect(usePlayerStore.getState().consumePipHandoff("handoff")).toEqual({
      positionSeconds: 128,
      playing: true,
    });
    // Consumed once: a retry must not silently rewind to a stale position.
    expect(usePlayerStore.getState().consumePipHandoff("handoff")).toBeNull();
  });

  it("carries a paused handoff across even from the very start of a video", () => {
    usePlayerStore.getState().setPipHandoff("cold", 0, false);

    expect(usePlayerStore.getState().consumePipHandoff("cold")).toEqual({
      positionSeconds: 0,
      playing: false,
    });
  });

  it("mirrors a pop-out advance into a video this window never queued", () => {
    const first = video("first");
    usePlayerStore.getState().setQueue([first], 0);
    usePlayerStore.getState().enterVideoWindowPip();

    const autoplayed = video("autoplayed");
    usePlayerStore.getState().applyPipRemoteState({ video: autoplayed });

    expect(usePlayerStore.getState().queue.map((item) => item.id)).toEqual([
      "first",
      "autoplayed",
    ]);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("autoplayed");
    // Mirroring must never take playback back from the pop-out.
    expect(usePlayerStore.getState().videoPlayerMode).toBe("window");
  });

  it("mirrors progress without disturbing the queue", () => {
    usePlayerStore.getState().setQueue([video("mirrored")], 0);
    usePlayerStore.getState().enterVideoWindowPip();

    usePlayerStore.getState().applyPipRemoteState({
      currentTime: 42,
      duration: 600,
      isPlaying: false,
    });

    expect(usePlayerStore.getState().currentTime).toBe(42);
    expect(usePlayerStore.getState().duration).toBe(600);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("lifts the warm-up silence when playback is dismissed", () => {
    usePlayerStore.getState().setQueue([video("silent")], 0);
    usePlayerStore.getState().setHandoffSilent(true);

    usePlayerStore.getState().dismissVideoPlayer();

    // A stuck silent flag would leave the next video playing with no sound.
    expect(usePlayerStore.getState().isHandoffSilent).toBe(false);
  });

  it("clears the pending handoff when playback is dismissed", () => {
    usePlayerStore.getState().setQueue([video("dismissed")], 0);
    usePlayerStore.getState().setPipHandoff("dismissed", 90, true);

    usePlayerStore.getState().dismissVideoPlayer();

    expect(usePlayerStore.getState().pipHandoff).toBeNull();
    expect(usePlayerStore.getState().videoPlayerMode).toBe("watch");
  });
});
