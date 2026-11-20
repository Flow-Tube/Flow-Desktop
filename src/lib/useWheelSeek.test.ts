import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../store/usePlayerStore", () => ({ usePlayerStore: { getState: () => ({ currentTime: 100 }) } }));

import { useWheelSeek } from "./useWheelSeek";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useWheelSeek", () => {
  it("moves forward on a wheel up and back on a wheel down, one seek step at a time", () => {
    const seekTo = vi.fn();
    const bar = document.createElement("div");
    function Probe({ enabled }: { enabled: boolean }) {
      const ref = useWheelSeek({ enabled, step: 10, duration: 300, seekTo });
      useEffect(() => ref(bar), [ref]);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe, { enabled: true })));
    const up = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    bar.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(seekTo).toHaveBeenLastCalledWith(110);
    act(() => root.render(createElement(Probe, { enabled: false })));
    const off = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    bar.dispatchEvent(off);
    expect(off.defaultPrevented).toBe(false);
    expect(seekTo).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
