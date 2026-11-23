import { describe, expect, it, vi } from "vitest";

import { NOTCH_ZOOM, listenForZoomInput, wheelZoomFactor } from "./pinch";

describe("wheelZoomFactor", () => {
  it("takes a mouse notch as one step", () => {
    expect(wheelZoomFactor(-100, 0)).toBe(NOTCH_ZOOM);
    expect(wheelZoomFactor(3, 1)).toBe(1 / NOTCH_ZOOM);
  });

  it("follows a pinch smoothly", () => {
    expect(wheelZoomFactor(-4.5, 0)).toBeCloseTo(Math.exp(0.045));
    expect(wheelZoomFactor(0, 0)).toBe(1);
  });
});

const gesture = (type: string, scale: number) => Object.assign(new Event(type, { cancelable: true }), { scale, clientX: 10, clientY: 20 });

describe("listenForZoomInput", () => {
  it("turns a Ctrl wheel into a zoom and cancels it", () => {
    const element = document.createElement("div");
    const onZoom = vi.fn(() => true);
    const stop = listenForZoomInput(element, onZoom);
    const wheel = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, clientX: 5, clientY: 6, cancelable: true });
    element.dispatchEvent(wheel);
    expect(onZoom).toHaveBeenCalledWith({ factor: NOTCH_ZOOM, clientX: 5, clientY: 6, source: "wheel" });
    expect(wheel.defaultPrevented).toBe(true);
    stop();
  });

  it("leaves a plain wheel and a declined zoom alone", () => {
    const element = document.createElement("div");
    const onZoom = vi.fn(() => false);
    listenForZoomInput(element, onZoom);
    const plain = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    element.dispatchEvent(plain);
    expect(onZoom).not.toHaveBeenCalled();
    const declined = new WheelEvent("wheel", { deltaY: -100, metaKey: true, cancelable: true });
    element.dispatchEvent(declined);
    expect(declined.defaultPrevented).toBe(false);
  });

  it("turns WebKit's pinch into step-by-step factors", () => {
    const element = document.createElement("div");
    const factors: number[] = [];
    listenForZoomInput(element, ({ factor }) => {
      factors.push(factor);
      return true;
    });
    element.dispatchEvent(gesture("gesturestart", 1));
    element.dispatchEvent(gesture("gesturechange", 1.5));
    // A wheel WebKit might send during the pinch is not counted again, nor heard by the player's volume.
    const otherListener = vi.fn();
    element.addEventListener("wheel", otherListener);
    const during = new WheelEvent("wheel", { deltaY: -3, ctrlKey: true, cancelable: true });
    element.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    expect(otherListener).not.toHaveBeenCalled();
    element.dispatchEvent(gesture("gesturechange", 3));
    const end = gesture("gestureend", 3);
    element.dispatchEvent(end);
    expect(factors).toEqual([1.5, 2]);
    expect(end.defaultPrevented).toBe(true);
  });
});
