import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { MediaScrubber } from "./MediaScrubber";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderBar(wheelSeekSeconds?: number) {
  const onSeek = vi.fn();
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(MediaScrubber, { progress: 50, duration: 200, onSeek, wheelSeekSeconds })));
  const wheel = (deltaY: number) => {
    const event = new WheelEvent("wheel", { deltaY, cancelable: true, bubbles: true });
    host.querySelector('[role="slider"]')!.dispatchEvent(event);
    return event;
  };
  return { onSeek, wheel, unmount: () => act(() => root.unmount()) };
}

describe("MediaScrubber wheel", () => {
  it("moves by the seek step when asked to", () => {
    const { onSeek, wheel, unmount } = renderBar(10);
    expect(wheel(-100).defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenCalledWith(60);
    unmount();
  });

  it("leaves a plain wheel to the page otherwise", () => {
    const { onSeek, wheel, unmount } = renderBar();
    expect(wheel(-100).defaultPrevented).toBe(false);
    expect(onSeek).not.toHaveBeenCalled();
    unmount();
  });
});
