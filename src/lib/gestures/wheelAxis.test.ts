import { describe, expect, it } from "vitest";

import { GESTURE_GAP_MS, newWheelGestureState, trackWheelGesture } from "./wheelAxis";

describe("trackWheelGesture", () => {
  it("locks a mostly sideways swipe to the x axis and adds up its travel", () => {
    const state = newWheelGestureState();
    trackWheelGesture(state, -6, 1, 0, 0);
    expect(state.axis).toBeNull();
    trackWheelGesture(state, -8, 2, 0, 16);
    expect(state.axis).toBe("x");
    trackWheelGesture(state, -30, 20, 0, 32);
    expect(state.travel).toBe(-44);
  });

  it("keeps a scroll down the page on the y axis", () => {
    const state = newWheelGestureState();
    trackWheelGesture(state, 3, 40, 0, 0);
    expect(state.axis).toBe("y");
  });

  it("starts over after a pause", () => {
    const state = newWheelGestureState();
    trackWheelGesture(state, -40, 0, 0, 0);
    state.done = true;
    expect(trackWheelGesture(state, 40, 0, 0, GESTURE_GAP_MS + 1)).toBe(true);
    expect(state).toMatchObject({ axis: "x", travel: 40, done: false });
  });
});
