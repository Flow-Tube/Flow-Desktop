import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD_PX, longPressRate, shouldStartDrag } from "./pointerGesture";

const popOut = { canDrag: true, boosting: false, dx: 0, dy: 0 };

describe("shouldStartDrag", () => {
  it("keeps a click a click", () => {
    expect(shouldStartDrag(popOut)).toBe(false);
    expect(shouldStartDrag({ ...popOut, dx: 2, dy: 2 })).toBe(false);
  });

  it("drags the pop-out once a press moves before the hold fires", () => {
    expect(shouldStartDrag({ ...popOut, dx: DRAG_THRESHOLD_PX + 1, dy: 0 })).toBe(true);
    expect(shouldStartDrag({ ...popOut, dx: -4, dy: -4 })).toBe(true);
  });

  it("keeps a hold a speed-up when it moves afterwards", () => {
    expect(shouldStartDrag({ ...popOut, boosting: true, dx: 40, dy: 0 })).toBe(false);
  });

  it("never drags the main window", () => {
    expect(shouldStartDrag({ ...popOut, canDrag: false, dx: 40, dy: 0 })).toBe(false);
  });
});

describe("longPressRate", () => {
  it("reads the speed setting", () => {
    expect(longPressRate("2.0")).toBe(2);
    expect(longPressRate("3.0")).toBe(3);
    expect(longPressRate("nonsense")).toBe(2);
  });

  it("turns off", () => {
    expect(longPressRate("off")).toBeNull();
  });
});
