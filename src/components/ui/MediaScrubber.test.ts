import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaScrubber } from "./MediaScrubber";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function render(props: Partial<Parameters<typeof MediaScrubber>[0]> = {}) {
  act(() => {
    root.render(createElement(MediaScrubber, { progress: 10, duration: 100, onSeek: vi.fn(), variant: "edge", ...props }));
  });
  const slider = host.querySelector<HTMLElement>('[role="slider"]')!;
  slider.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 16, right: 200, bottom: 16, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  slider.setPointerCapture = () => {};
  slider.releasePointerCapture = () => {};
  return slider;
}

const pointer = (target: Element, type: string, clientX: number) =>
  act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 })); });

describe("MediaScrubber", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("reports where the pointer hovers, and clears it when the pointer leaves", () => {
    const onHover = vi.fn();
    const slider = render({ onHover });
    pointer(slider, "pointermove", 50);
    expect(onHover).toHaveBeenLastCalledWith(0.25);
    pointer(slider, "pointerout", 50);
    act(() => { slider.dispatchEvent(new PointerEvent("pointerleave", { clientX: 50 })); });
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("seeks once where a drag ends", () => {
    const onSeek = vi.fn();
    const onHover = vi.fn();
    const slider = render({ onSeek, onHover });
    pointer(slider, "pointerdown", 20);
    pointer(slider, "pointermove", 100);
    expect(onSeek).not.toHaveBeenCalled();
    pointer(slider, "pointerup", 150);
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(75);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("draws what is buffered behind the fill", () => {
    render({ buffered: 40 });
    const widths = [...host.querySelectorAll<HTMLElement>('[role="slider"] div div')].map((el) => el.style.width);
    expect(widths).toContain("40%");
  });
});
