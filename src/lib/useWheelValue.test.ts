import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWheelValue, type UseWheelValueOptions } from "./useWheelValue";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Box({ shown = true, ...options }: UseWheelValueOptions & { shown?: boolean }) {
  const ref = useWheelValue(options);
  return shown ? createElement("div", { ref, "data-testid": "box" }) : null;
}

const wheel = (deltaY: number) => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
  document.querySelector('[data-testid="box"]')!.dispatchEvent(event);
  return event;
};

describe("useWheelValue", () => {
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

  it("changes the value and stops the page scrolling when active", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(Box, {
          value: 50,
          min: 10,
          max: 100,
          step: 5,
          onChange,
        }),
      ),
    );

    const event = wheel(-100);

    expect(event.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it("decrements the value on downward scroll", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(Box, {
          value: 50,
          min: 10,
          max: 100,
          step: 5,
          onChange,
        }),
      ),
    );

    const event = wheel(100);

    expect(event.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it("clamps to max and min boundaries without calling onChange when already at boundary", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(Box, {
          value: 100,
          min: 10,
          max: 100,
          step: 5,
          onChange,
        }),
      ),
    );

    const event = wheel(-100);

    expect(event.defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not intercept wheel events when disabled, allowing page scrolling", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(Box, {
          value: 50,
          min: 10,
          max: 100,
          step: 5,
          disabled: true,
          onChange,
        }),
      ),
    );

    const event = wheel(-100);

    expect(event.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("attaches to an element that mounts later, and reads the latest value", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(Box, {
          shown: false,
          value: 20,
          min: 10,
          max: 100,
          step: 5,
          onChange,
        }),
      ),
    );
    act(() =>
      root.render(
        createElement(Box, {
          shown: true,
          value: 70,
          min: 10,
          max: 100,
          step: 5,
          onChange,
        }),
      ),
    );

    wheel(-100);

    expect(onChange).toHaveBeenCalledWith(75);
  });
});
