import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { videoStarted, whenVideoStarts } from "./videoStart";

type State = Parameters<typeof videoStarted>[0];

const fresh = (): State => ({ currentVideo: { id: "v1", title: "", channelName: "" }, playbackStartedVideoId: null, duration: 0 });

describe("videoStarted", () => {
  it("waits for a video handed over playing to render", () => {
    expect(videoStarted({ ...fresh(), duration: 60 }, "v1", true)).toBe(false);
    expect(videoStarted({ ...fresh(), playbackStartedVideoId: "v1" }, "v1", true)).toBe(true);
    expect(videoStarted({ ...fresh(), playbackStartedVideoId: "v0" }, "v1", true)).toBe(false);
  });

  it("takes a paused video as started once its media loaded", () => {
    expect(videoStarted(fresh(), "v1", false)).toBe(false);
    expect(videoStarted({ ...fresh(), duration: 60 }, "v1", false)).toBe(true);
    expect(videoStarted({ ...fresh(), duration: 60 }, "v2", false)).toBe(false);
  });
});

describe("whenVideoStarts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves on the first playing, not before", async () => {
    const store = createStore<State>(fresh);
    const started = vi.fn();
    void whenVideoStarts(store, "v1", true).then(started);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(started).not.toHaveBeenCalled();
    store.setState({ playbackStartedVideoId: "v1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledOnce();
  });

  it("fails a video that hasn't started in time", async () => {
    const store = createStore<State>(fresh);
    const failed = vi.fn();
    void whenVideoStarts(store, "v1", true, 20_000).catch(failed);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenCalledWith(new Error("unavailable"));
    store.setState({ playbackStartedVideoId: "v1" });
    expect(failed).toHaveBeenCalledOnce();
  });

  it("resolves at once for a video already playing", async () => {
    const store = createStore<State>(() => ({ ...fresh(), playbackStartedVideoId: "v1" }));
    await expect(whenVideoStarts(store, "v1", true)).resolves.toBeUndefined();
  });
});
