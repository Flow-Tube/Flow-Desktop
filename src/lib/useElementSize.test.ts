import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useElementSize, type ElementSize } from "./useElementSize";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let report: () => void = () => {};
let frames: FrameRequestCallback[] = [];
const disconnect = vi.fn();

class FakeResizeObserver {
  constructor(callback: () => void) {
    report = callback;
  }
  observe() {}
  disconnect = disconnect;
}

const sizes: ElementSize[] = [];

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  sizes.push(useElementSize(ref));
  return createElement("div", { ref });
}

const latest = () => sizes[sizes.length - 1];

const runFrame = () => {
  const due = frames;
  frames = [];
  act(() => due.forEach((frame) => frame(0)));
};

describe("useElementSize", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sizes.length = 0;
    frames = [];
    disconnect.mockClear();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.splice(id - 1, 1);
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(createElement(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // The full player's artwork grows in from this first paint.
  it("stays at zero through mount, without reading the element", () => {
    expect(latest()).toEqual({ width: 0, height: 0 });
  });

  it("takes the size a frame after the observer's first report", () => {
    act(() => report());
    expect(latest()).toEqual({ width: 0, height: 0 });

    runFrame();
    expect(latest()).toEqual({ width: 640, height: 480 });
  });

  it("drops a pending read and stops observing on unmount", () => {
    act(() => report());
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    expect(frames).toEqual([]);
    root = createRoot(host);
  });
});
