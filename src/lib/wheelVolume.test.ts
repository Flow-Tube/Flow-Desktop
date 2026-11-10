import { describe, expect, it } from "vitest";

import { newWheelGesture, wheelStep, wheelVolumeChange } from "./wheelVolume";

describe("wheelStep", () => {
  it("gives each slow wheel notch its own step", () => {
    const gesture = newWheelGesture();
    expect(wheelStep(gesture, -4, 0, 0)).toBe(-1);
    expect(wheelStep(gesture, -4, 0, 500)).toBe(-1);
    expect(wheelStep(gesture, 4, 0, 1000)).toBe(1);
  });

  it("keeps one trackpad swipe from running the whole range", () => {
    const gesture = newWheelGesture();
    let steps = 0;
    for (let i = 0; i < 60; i += 1) {
      if (wheelStep(gesture, -8, 0, i * 16) !== 0) steps += 1;
    }
    expect(steps).toBe(5);
  });

  it("turns around at once when the direction changes", () => {
    const gesture = newWheelGesture();
    expect(wheelStep(gesture, -8, 0, 0)).toBe(-1);
    expect(wheelStep(gesture, -8, 0, 16)).toBe(0);
    expect(wheelStep(gesture, 8, 0, 32)).toBe(1);
  });

  it("counts line and page wheels by their real distance", () => {
    const lines = newWheelGesture();
    wheelStep(lines, 1, 1, 0);
    expect(wheelStep(lines, 3, 1, 16)).toBe(0);
    expect(wheelStep(lines, 1, 1, 32)).toBe(1);
    const pages = newWheelGesture();
    wheelStep(pages, 1, 2, 0);
    expect(wheelStep(pages, 1, 2, 16)).toBe(1);
  });

  it("ignores a purely sideways swipe", () => {
    expect(wheelStep(newWheelGesture(), 0, 0, 0)).toBe(0);
  });
});

describe("wheelVolumeChange", () => {
  it("steps the volume while unmuted", () => {
    expect(wheelVolumeChange(0.5, false, -1)).toEqual({ volume: 0.55, unmute: false });
    expect(wheelVolumeChange(0.5, false, 1)).toEqual({ volume: 0.45, unmute: false });
  });

  it("keeps the saved level when scrolling down while muted", () => {
    expect(wheelVolumeChange(0.5, true, 1)).toEqual({ unmute: false });
  });

  it("unmutes to the saved level when scrolling up", () => {
    expect(wheelVolumeChange(0.5, true, -1)).toEqual({ unmute: true });
  });

  it("starts from one step when there is no saved level", () => {
    expect(wheelVolumeChange(0, true, -1)).toEqual({ volume: 0.05, unmute: true });
  });
});
