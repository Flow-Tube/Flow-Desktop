import { describe, expect, it } from "vitest";

import { SOFT_CLIP_HEADROOM, softClip, softClipCurve } from "./softClip";

describe("softClip", () => {
  it("leaves everything under the knee untouched", () => {
    for (const x of [0, 0.1, -0.5, 0.95, -0.95]) expect(softClip(x)).toBe(x);
  });

  it("bends a slight over under full scale instead of clipping it flat", () => {
    const out = softClip(0.95 * Math.pow(10, 1 / 20));
    expect(out).toBeGreaterThan(0.95);
    expect(out).toBeLessThan(1);
    expect(softClip(-3)).toBeGreaterThanOrEqual(-1);
    expect(softClip(-3)).toBeLessThan(-0.95);
  });

  it("builds a shaper curve that maps the scaled signal back through the knee", () => {
    const curve = softClipCurve();
    const at = (x: number) => {
      const position = ((x / SOFT_CLIP_HEADROOM + 1) / 2) * (curve.length - 1);
      return curve[Math.round(position)];
    };
    expect(curve[(curve.length - 1) / 2]).toBe(0);
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(2)).toBeCloseTo(softClip(2), 5);
    expect(curve.every((v) => Math.abs(v) <= 1)).toBe(true);
  });
});
