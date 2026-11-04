import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  computeMiniPlayerBounds,
  positionFromRatios,
  ratiosFromPosition,
  parseSavedPosition,
  useMiniPlayerDrag,
  MIN_VIEWPORT_GUTTER,
  TOP_TITLEBAR_GUTTER,
} from "./useMiniPlayerDrag";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { SETTINGS } from "./settings/schema";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("mini-player positioning calculations", () => {
  it("computes bounds accurately given viewport and player size", () => {
    expect(MIN_VIEWPORT_GUTTER).toBe(24);
    expect(TOP_TITLEBAR_GUTTER).toBe(48);
    const bounds = computeMiniPlayerBounds(1000, 800, 400, 225, 24, 48);
    expect(bounds.minX).toBe(24);
    expect(bounds.maxX).toBe(576); // 1000 - 400 - 24
    expect(bounds.minY).toBe(48);
    expect(bounds.maxY).toBe(551); // 800 - 225 - 24
  });

  it("clamps bounds to min gutters if viewport is smaller than player", () => {
    const bounds = computeMiniPlayerBounds(300, 200, 400, 225, 24, 48);
    expect(bounds.minX).toBe(24);
    expect(bounds.maxX).toBe(24);
    expect(bounds.minY).toBe(48);
    expect(bounds.maxY).toBe(48);
  });

  it("calculates positions from ratios and clamps them within bounds", () => {
    const bounds = { minX: 20, maxX: 120, minY: 30, maxY: 130 };

    // Bottom-right default (1, 1)
    expect(positionFromRatios({ xRatio: 1, yRatio: 1 }, bounds)).toEqual({ x: 120, y: 130 });

    // Top-left (0, 0)
    expect(positionFromRatios({ xRatio: 0, yRatio: 0 }, bounds)).toEqual({ x: 20, y: 30 });

    // Center (0.5, 0.5)
    expect(positionFromRatios({ xRatio: 0.5, yRatio: 0.5 }, bounds)).toEqual({ x: 70, y: 80 });

    // Out of bounds (<0 or >1)
    expect(positionFromRatios({ xRatio: -0.5, yRatio: 1.5 }, bounds)).toEqual({ x: 20, y: 130 });
  });

  it("calculates ratios from positions and handles zero-span bounds", () => {
    const bounds = { minX: 100, maxX: 200, minY: 50, maxY: 150 };

    expect(ratiosFromPosition(200, 150, bounds)).toEqual({ xRatio: 1, yRatio: 1 });
    expect(ratiosFromPosition(100, 50, bounds)).toEqual({ xRatio: 0, yRatio: 0 });
    expect(ratiosFromPosition(150, 100, bounds)).toEqual({ xRatio: 0.5, yRatio: 0.5 });

    // Zero span fallback
    const zeroBounds = { minX: 50, maxX: 50, minY: 50, maxY: 50 };
    expect(ratiosFromPosition(50, 50, zeroBounds)).toEqual({ xRatio: 1, yRatio: 1 });
  });

  it("parses saved position safely and handles edge cases", () => {
    expect(parseSavedPosition(null)).toEqual({ xRatio: 1, yRatio: 1 });
    expect(parseSavedPosition(undefined)).toEqual({ xRatio: 1, yRatio: 1 });
    expect(parseSavedPosition("")).toEqual({ xRatio: 1, yRatio: 1 });
    expect(parseSavedPosition("not-json")).toEqual({ xRatio: 1, yRatio: 1 });
    expect(parseSavedPosition("{}")).toEqual({ xRatio: 1, yRatio: 1 });
    expect(parseSavedPosition('{"xRatio": "abc"}')).toEqual({ xRatio: 1, yRatio: 1 });

    expect(parseSavedPosition('{"xRatio": 0.25, "yRatio": 0.75}')).toEqual({
      xRatio: 0.25,
      yRatio: 0.75,
    });

    // Clamps values in JSON
    expect(parseSavedPosition('{"xRatio": -0.5, "yRatio": 2.0}')).toEqual({
      xRatio: 0,
      yRatio: 1,
    });
  });
});

describe("useMiniPlayerDrag hook", () => {
  let root: Root | null = null;
  let hookResult: ReturnType<typeof useMiniPlayerDrag> | null = null;
  let elementRef: HTMLDivElement | null = null;

  function ProbeComponent({ isFloating }: { isFloating: boolean }) {
    const frameRef = useRef<HTMLDivElement | null>(null);
    const result = useMiniPlayerDrag({ frameRef, isFloating });
    hookResult = result;

    return createElement(
      "div",
      {
        ref: (el: HTMLDivElement | null) => {
          frameRef.current = el;
          elementRef = el;
        },
        ...result.dragBinds,
      },
      createElement("div", { "data-drag-ignore": "true", id: "ignored-control" }),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("innerHeight", 800);
    useAppSettingsStore.setState((s) => ({
      ...s,
      values: { ...s.values, [SETTINGS.MINI_PLAYER_POSITION]: "null" },
    }));
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    hookResult = null;
    elementRef = null;
    vi.restoreAllMocks();
  });

  it("returns inactive state and empty binds when isFloating is false", () => {
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(createElement(ProbeComponent, { isFloating: false }));
    });

    expect(hookResult?.isDragging).toBe(false);
    expect(hookResult?.dragBinds.onPointerDown).toBeUndefined();
  });

  it("initializes position transform when isFloating is true", () => {
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(createElement(ProbeComponent, { isFloating: true }));
    });

    expect(hookResult?.isDragging).toBe(false);
    expect(hookResult?.dragBinds.onPointerDown).toBeDefined();
    expect(elementRef?.style.transform).toContain("translate3d");
  });

  it("ignores drag when interacting with data-drag-ignore elements or non-primary button", () => {
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(createElement(ProbeComponent, { isFloating: true }));
    });

    // Right-click (button = 2)
    act(() => {
      hookResult?.dragBinds.onPointerDown?.({
        button: 2,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        target: elementRef,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    expect(hookResult?.isDragging).toBe(false);

    // Ignored element click
    const ignoredEl = elementRef?.querySelector("#ignored-control");
    act(() => {
      hookResult?.dragBinds.onPointerDown?.({
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        target: ignoredEl,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    expect(hookResult?.isDragging).toBe(false);
  });

  it("does not initiate drag at or below the shared threshold", () => {
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(createElement(ProbeComponent, { isFloating: true }));
    });

    act(() => {
      hookResult?.dragBinds.onPointerDown?.({
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        target: elementRef,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    // Inside DRAG_THRESHOLD_PX
    act(() => {
      hookResult?.dragBinds.onPointerMove?.({
        pointerId: 1,
        clientX: 103,
        clientY: 100,
        currentTarget: elementRef,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    expect(hookResult?.isDragging).toBe(false);

    act(() => {
      hookResult?.dragBinds.onPointerUp?.({
        pointerId: 1,
        currentTarget: elementRef,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
  });

  it("initiates drag above threshold, moves the frame, and saves the position", () => {
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(createElement(ProbeComponent, { isFloating: true }));
    });

    if (elementRef) {
      elementRef.setPointerCapture = vi.fn();
      elementRef.hasPointerCapture = vi.fn(() => true);
      elementRef.releasePointerCapture = vi.fn();
    }

    act(() => {
      hookResult?.dragBinds.onPointerDown?.({
        button: 0,
        pointerId: 1,
        clientX: 500,
        clientY: 500,
        target: elementRef,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    // Move 20px, past the threshold
    act(() => {
      hookResult?.dragBinds.onPointerMove?.({
        pointerId: 1,
        clientX: 520,
        clientY: 520,
        currentTarget: elementRef,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    expect(hookResult?.isDragging).toBe(true);

    // Pointer up
    act(() => {
      hookResult?.dragBinds.onPointerUp?.({
        pointerId: 1,
        currentTarget: elementRef,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    expect(hookResult?.isDragging).toBe(false);
    expect(useAppSettingsStore.getState().values[SETTINGS.MINI_PLAYER_POSITION]).toContain("xRatio");
  });

  it("clears its transform when the frame stops floating, as it does in fullscreen", () => {
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(createElement(ProbeComponent, { isFloating: true }));
    });
    expect(elementRef?.style.transform).toContain("translate3d");

    act(() => {
      root?.render(createElement(ProbeComponent, { isFloating: false }));
    });
    expect(elementRef?.style.transform).toBe("");
  });

  it("leaves the pointer with the gesture overlay when it already holds it", () => {
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(createElement(ProbeComponent, { isFloating: true }));
    });
    const capture = vi.fn();
    if (elementRef) elementRef.setPointerCapture = capture;
    const overlay = { closest: () => null, hasPointerCapture: () => true };

    act(() => {
      hookResult?.dragBinds.onPointerDown?.({
        button: 0,
        pointerId: 1,
        clientX: 500,
        clientY: 500,
        target: overlay,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    act(() => {
      hookResult?.dragBinds.onPointerMove?.({
        pointerId: 1,
        clientX: 520,
        clientY: 520,
        target: overlay,
        currentTarget: elementRef,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    expect(hookResult?.isDragging).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });
});
