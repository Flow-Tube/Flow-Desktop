import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWheelVolume, type UseWheelVolumeOptions } from "./useWheelVolume";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Box({ shown = true, ...options }: UseWheelVolumeOptions & { shown?: boolean }) {
  const ref = useWheelVolume(options);
  return shown ? createElement("div", { ref, "data-testid": "box" }) : null;
}

const wheel = (deltaY: number) => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
  document.querySelector('[data-testid="box"]')!.dispatchEvent(event);
  return event;
};

describe("useWheelVolume", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("changes the volume and stops the page scrolling", () => {
    const onVolumeChange = vi.fn();
    act(() => root.render(createElement(Box, { volume: 0.5, muted: false, onVolumeChange })));

    const event = wheel(-100);

    expect(event.defaultPrevented).toBe(true);
    expect(onVolumeChange).toHaveBeenCalledWith(0.55);
  });

  it("stops the scroll while muted, without losing the saved level", () => {
    const onVolumeChange = vi.fn();
    const onUnmute = vi.fn();
    act(() => root.render(createElement(Box, { volume: 0.5, muted: true, onVolumeChange, onUnmute })));

    const event = wheel(100);

    expect(event.defaultPrevented).toBe(true);
    expect(onVolumeChange).not.toHaveBeenCalled();
    expect(onUnmute).not.toHaveBeenCalled();
  });

  it("unmutes to the saved level on scroll up", () => {
    const onVolumeChange = vi.fn();
    const onUnmute = vi.fn();
    act(() => root.render(createElement(Box, { volume: 0.5, muted: true, onVolumeChange, onUnmute })));

    wheel(-100);

    expect(onUnmute).toHaveBeenCalledTimes(1);
    expect(onVolumeChange).not.toHaveBeenCalled();
  });

  it("attaches to an element that mounts later, and reads the latest volume", () => {
    const onVolumeChange = vi.fn();
    act(() => root.render(createElement(Box, { shown: false, volume: 0.2, muted: false, onVolumeChange })));
    act(() => root.render(createElement(Box, { shown: true, volume: 0.8, muted: false, onVolumeChange })));

    wheel(100);

    expect(onVolumeChange).toHaveBeenCalledWith(0.75);
  });
});
