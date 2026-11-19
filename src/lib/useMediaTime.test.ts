// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useMediaTime } from "./useMediaTime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useMediaTime", () => {
  it("follows the element's position on ticks and seeks, and stops when unmounted", () => {
    const video = document.createElement("video");
    let position = 3;
    Object.defineProperty(video, "currentTime", { get: () => position });
    const ref = createRef<HTMLVideoElement | null>();
    ref.current = video;

    const seen: number[] = [];
    const Reader = () => {
      seen.push(useMediaTime(ref));
      return null;
    };
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Reader)));
    expect(seen[seen.length - 1]).toBe(3);

    position = 4.5;
    act(() => void video.dispatchEvent(new Event("timeupdate")));
    expect(seen[seen.length - 1]).toBe(4.5);

    position = 20;
    act(() => void video.dispatchEvent(new Event("seeking")));
    expect(seen[seen.length - 1]).toBe(20);

    act(() => root.unmount());
    const renders = seen.length;
    position = 21;
    video.dispatchEvent(new Event("timeupdate"));
    expect(seen.length).toBe(renders);
  });
});
