// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { adaptivePlayerAspect, useReportVideoAspect } from "./adaptivePlayer";
import { usePlayerStore } from "../store/usePlayerStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("adaptivePlayerAspect", () => {
  it("leaves 16:9 and wider videos in the normal frame", () => {
    expect(adaptivePlayerAspect(16 / 9, true, false)).toBeNull();
    expect(adaptivePlayerAspect(2.35, true, false)).toBeNull();
  });

  it("makes the frame taller for narrower videos, down to 9:16", () => {
    expect(adaptivePlayerAspect(4 / 3, true, false)).toBeCloseTo(4 / 3);
    expect(adaptivePlayerAspect(9 / 16, true, false)).toBeCloseTo(9 / 16);
    expect(adaptivePlayerAspect(0.3, true, false)).toBeCloseTo(9 / 16);
  });

  it("does nothing when off, in theater mode, or before the shape is known", () => {
    expect(adaptivePlayerAspect(9 / 16, false, false)).toBeNull();
    expect(adaptivePlayerAspect(9 / 16, true, true)).toBeNull();
    expect(adaptivePlayerAspect(null, true, false)).toBeNull();
  });
});

describe("useReportVideoAspect", () => {
  it("forgets the last video's shape until the next one's metadata loads", async () => {
    const video = document.createElement("video");
    let width = 1080;
    Object.defineProperty(video, "videoWidth", { get: () => width });
    Object.defineProperty(video, "videoHeight", { get: () => 1920 });
    const videoRef = { current: video };
    function Probe({ id }: { id: string }) {
      useReportVideoAspect(videoRef, id);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe, { id: "vertical" })));
    act(() => void video.dispatchEvent(new Event("loadedmetadata")));
    expect(usePlayerStore.getState().videoAspect).toBeCloseTo(9 / 16);

    // The element still reports the vertical video until the next source loads.
    await act(async () => root.render(createElement(Probe, { id: "wide" })));
    expect(usePlayerStore.getState().videoAspect).toBeNull();

    width = 3413;
    act(() => void video.dispatchEvent(new Event("loadedmetadata")));
    expect(usePlayerStore.getState().videoAspect).toBeCloseTo(16 / 9, 1);
    await act(async () => root.unmount());
  });
});
