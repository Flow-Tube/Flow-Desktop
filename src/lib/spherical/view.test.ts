import { describe, expect, it } from "vitest";

import { DEFAULT_FOV, MAX_FOV, MIN_FOV, dragLook, initialLook, keyLook, zoomLook } from "./view";

describe("looking around a 360 video", () => {
  it("moves the picture with the pointer", () => {
    const look = dragLook(initialLook(), 100, 0, 1);
    expect(look.yaw).toBeLessThan(0);
    expect(dragLook(initialLook(), 0, 100, 1).pitch).toBeGreaterThan(0);
  });

  it("turns faster at a higher speed and slower zoomed in", () => {
    const slow = dragLook(initialLook(), 100, 0, 1).yaw;
    expect(dragLook(initialLook(), 100, 0, 2).yaw).toBeCloseTo(slow * 2, 6);
    const zoomed = { ...initialLook(), fov: DEFAULT_FOV / 2 };
    expect(dragLook(zoomed, 100, 0, 1).yaw).toBeCloseTo(slow / 2, 6);
  });

  it("wraps around and never looks past straight up or down", () => {
    expect(dragLook({ ...initialLook(), yaw: 179 }, -100, 0, 1).yaw).toBeLessThan(0);
    expect(dragLook(initialLook(), 0, 100_000, 1).pitch).toBe(89);
    expect(dragLook(initialLook(), 0, -100_000, 1).pitch).toBe(-89);
  });

  it("zooms within its limits", () => {
    expect(zoomLook(initialLook(), -100_000).fov).toBe(MIN_FOV);
    expect(zoomLook(initialLook(), 100_000).fov).toBe(MAX_FOV);
  });

  it("looks with W, A, S and D only", () => {
    expect(keyLook(initialLook(), "d", 1)?.yaw).toBeGreaterThan(0);
    expect(keyLook(initialLook(), "W", 1)?.pitch).toBeGreaterThan(0);
    expect(keyLook(initialLook(), "k", 1)).toBeNull();
  });
});
