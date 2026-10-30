import { act, createElement } from "react";
import type { WheelEvent } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const player = vi.hoisted(() => ({ viewState: "dock", openOverlay: vi.fn() }));

vi.mock("../store/useMusicPlayerStore", () => ({
  useMusicPlayerStore: Object.assign(() => undefined, { getState: () => player }),
}));

import { useMusicSheetStore } from "../store/useMusicSheetStore";
import { registerSheetDock, sheetProgress } from "./musicSheet";
import { useSheetDrag, type SheetDragBind } from "./useSheetDrag";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("useSheetDrag", () => {
  let bind!: SheetDragBind;
  let root: ReturnType<typeof createRoot>;
  const dock = document.createElement("div");

  beforeEach(async () => {
    vi.useFakeTimers();
    document.body.append(dock);
    vi.spyOn(dock, "getBoundingClientRect").mockReturnValue({ top: 900, right: 800, bottom: 972, left: 200 } as DOMRect);
    registerSheetDock(dock);
    function Harness() {
      bind = useSheetDrag();
      return null;
    }
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    registerSheetDock(null);
    dock.remove();
    player.viewState = "dock";
    sheetProgress.jump(0);
    useMusicSheetStore.getState().setPeeking(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const wheel = (deltaY: number) => bind.onWheel({ deltaY, deltaX: 0, target: dock } as unknown as WheelEvent<HTMLElement>);

  it("grows the player out of the dock on a wheel up", () => {
    wheel(90);
    expect(sheetProgress.get()).toBe(0.1);
    expect(useMusicSheetStore.getState().peeking).toBe(true);
  });

  it("leaves an open player alone when its wheel gesture still reaches the dock", () => {
    player.viewState = "full";
    sheetProgress.jump(1);
    wheel(90);
    vi.advanceTimersByTime(500);
    expect(sheetProgress.get()).toBe(1);
    expect(useMusicSheetStore.getState().peeking).toBe(false);
  });
});
