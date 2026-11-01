import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/useExpressiveSliders", () => ({
  useExpressiveSliders: () => true,
}));

import { Slider } from "./Slider";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

describe("Slider", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("handles wheel events when onWheel is provided", () => {
    const onWheel = vi.fn();
    const onChange = vi.fn();

    act(() => {
      root.render(
        createElement(Slider, {
          value: 0.5,
          min: 0,
          max: 1,
          step: 0.01,
          onChange,
          onWheel,
          "aria-label": "Volume slider",
        }),
      );
    });

    const slider = host.querySelector<HTMLDivElement>(".m3-slider");
    expect(slider).not.toBeNull();

    act(() => {
      slider?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }));
    });

    expect(onWheel).toHaveBeenCalledTimes(1);
  });
});
