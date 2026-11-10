// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoplayCountdown } from "./useAutoplayCountdown";
import { usePlayerStore } from "../store/usePlayerStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAutoplayCountdown>;
let hook: Hook;
let root: Root;
const onElapsed = vi.fn();
const next = { id: "n", title: "Next", channelName: "c" };

function Probe({ videoId }: { videoId: string }) {
  hook = useAutoplayCountdown(videoId, onElapsed);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  onElapsed.mockReset();
  usePlayerStore.setState({ isPlaying: false });
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe, { videoId: "a" })));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("useAutoplayCountdown", () => {
  it("counts down and fires once", () => {
    act(() => hook.start(2, next));
    expect(hook.state?.secondsLeft).toBe(2);
    tick(1000);
    expect(hook.state?.secondsLeft).toBe(1);
    expect(onElapsed).not.toHaveBeenCalled();
    tick(1000);
    expect(hook.state).toBeNull();
    expect(onElapsed).toHaveBeenCalledTimes(1);
    tick(5000);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("does not fire after cancel", () => {
    act(() => hook.start(3, next));
    act(() => hook.cancel());
    tick(5000);
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("ends when the viewer plays again", () => {
    act(() => hook.start(3, next));
    act(() => usePlayerStore.setState({ isPlaying: true }));
    expect(hook.state).toBeNull();
    tick(5000);
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("ends when another video takes over", () => {
    act(() => hook.start(3, next));
    act(() => root.render(createElement(Probe, { videoId: "b" })));
    expect(hook.state).toBeNull();
    tick(5000);
    expect(onElapsed).not.toHaveBeenCalled();
  });
});
