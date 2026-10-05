import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlaybackSettled } from "./usePlaybackSettled";
import { usePlayerStore } from "../store/usePlayerStore";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let ready = false;
function Harness({ videoId }: { videoId: string }) {
  ready = usePlaybackSettled(videoId);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState({ playbackStartedVideoId: null });
});
afterEach(() => vi.useRealTimers());

it("opens secondary work at the first frame", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness, { videoId: "video" })));
  expect(ready).toBe(false);
  await act(async () => usePlayerStore.setState({ playbackStartedVideoId: "video" }));
  expect(ready).toBe(true);
  await act(async () => root.unmount());
});

it("still fills the page when playback never starts", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness, { videoId: "video" })));
  await act(async () => vi.advanceTimersByTime(2_499));
  expect(ready).toBe(false);
  await act(async () => vi.advanceTimersByTime(1));
  expect(ready).toBe(true);
  await act(async () => root.unmount());
});

it("restarts the grace period for the next video", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness, { videoId: "video" })));
  await act(async () => vi.advanceTimersByTime(2_500));
  expect(ready).toBe(true);
  await act(async () => root.render(createElement(Harness, { videoId: "next" })));
  expect(ready).toBe(false);
  await act(async () => root.unmount());
});
