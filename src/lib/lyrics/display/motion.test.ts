import { describe, expect, it } from "vitest";

import { DEFAULT_EFFECTS, DEFAULT_SPATIAL, Fling, SLOW_SPATIAL, Spring } from "./motion";

function runFor(spring: Spring, totalMs: number, frameMs: number): number {
  for (let t = 0; t < totalMs; t += frameMs) spring.step(frameMs);
  return spring.value;
}

describe("lyrics motion", () => {
  it("reaches the same place at 60 Hz and 120 Hz", () => {
    const at60 = new Spring(0, DEFAULT_SPATIAL);
    const at120 = new Spring(0, DEFAULT_SPATIAL);
    at60.animateTo(100);
    at120.animateTo(100);
    expect(runFor(at60, 150, 1000 / 60)).toBeCloseTo(runFor(at120, 150, 1000 / 120), 1);
  });

  it("overshoots on an expressive spatial spring and settles on its target", () => {
    const spring = new Spring(0, SLOW_SPATIAL);
    spring.animateTo(100);
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      spring.step(8);
      peak = Math.max(peak, spring.value);
    }
    expect(peak).toBeGreaterThan(100);
    expect(spring.value).toBe(100);
    expect(spring.settled).toBe(true);
  });

  it("does not overshoot on a critically damped effects spring", () => {
    const spring = new Spring(0, DEFAULT_EFFECTS);
    spring.animateTo(1);
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      spring.step(8);
      peak = Math.max(peak, spring.value);
    }
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("waits out its stagger before moving", () => {
    const spring = new Spring(0, DEFAULT_SPATIAL);
    spring.animateTo(50, 100);
    spring.step(60);
    expect(spring.value).toBe(0);
    spring.step(60);
    expect(spring.value).toBeGreaterThan(0);
  });

  it("slows a fling down and stops it", () => {
    const fling = new Fling(0, 2000, 1.8);
    const early = fling.step(100).value;
    let last = { value: early, moving: true };
    for (let i = 0; i < 400 && last.moving; i++) last = fling.step(16);
    expect(early).toBeGreaterThan(0);
    expect(last.moving).toBe(false);
    expect(last.value).toBeCloseTo(2000 / (4.2 * 1.8), 0);
  });
});
