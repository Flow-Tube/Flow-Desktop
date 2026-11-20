import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { PinchGridHost } from "./PinchGridHost";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pinch = (deltaY: number, times: number) => {
  for (let step = 0; step < times; step += 1) {
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY, ctrlKey: true, clientX: 10, clientY: 10, cancelable: true }));
    });
  }
};

describe("PinchGridHost", () => {
  let root: Root;
  let under: Element;
  const setSettingValue = vi.fn(async (key: string, value: string) => {
    useAppSettingsStore.setState((state) => ({ values: { ...state.values, [key]: value } }));
    return true;
  });

  beforeEach(() => {
    const grid = document.createElement("div");
    grid.className = "flow-grid";
    under = document.createElement("div");
    grid.append(under);
    document.body.append(grid);
    document.elementFromPoint = () => under;
    useAppSettingsStore.setState((state) => ({ values: { ...state.values, [SETTINGS.GRID_COLUMNS]: "4" }, setSettingValue }));
    setSettingValue.mockClear();
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(PinchGridHost)));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("spreads to fewer, bigger thumbnails and pinches back to more", () => {
    pinch(-5, 8);
    expect(setSettingValue).toHaveBeenLastCalledWith(SETTINGS.GRID_COLUMNS, "3");
    pinch(5, 8);
    expect(setSettingValue).toHaveBeenLastCalledWith(SETTINGS.GRID_COLUMNS, "4");
  });

  it("only cancels the page zoom outside a feed", () => {
    under = document.body;
    const event = new WheelEvent("wheel", { deltaY: -5, ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(setSettingValue).not.toHaveBeenCalled();
  });
});
