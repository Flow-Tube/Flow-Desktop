import { describe, expect, it } from "vitest";

import { fadeInGain, fadeOutGain, type CrossfadeCurve } from "./crossfadeRamp";

const CURVES: CrossfadeCurve[] = ["EQUAL_POWER", "S_CURVE", "HOLD", "GENTLE"];

describe("fade curves", () => {
  it.each(CURVES)("%s runs from one song to the other", (curve) => {
    expect(fadeOutGain(0, curve)).toBeCloseTo(1);
    expect(fadeInGain(0, curve)).toBeCloseTo(0);
    expect(fadeOutGain(1, curve)).toBeCloseTo(0);
    expect(fadeInGain(1, curve)).toBeCloseTo(1);
  });

  it("keeps the loudness all through an equal-power fade", () => {
    for (const t of [0.2, 0.5, 0.8]) {
      expect(fadeOutGain(t, "EQUAL_POWER") ** 2 + fadeInGain(t, "EQUAL_POWER") ** 2).toBeCloseTo(1, 5);
    }
  });

  it("gives Android's gains halfway through", () => {
    expect(fadeOutGain(0.5, "HOLD")).toBeCloseTo(0.875, 5);
    expect(fadeInGain(0.5, "HOLD")).toBeCloseTo(0.7071, 4);
    expect(fadeOutGain(0.5, "GENTLE")).toBeCloseTo(0.25, 5);
    expect(fadeInGain(0.5, "GENTLE")).toBeCloseTo(0.7071, 4);
    expect(fadeOutGain(0.5, "S_CURVE")).toBeCloseTo(0.5, 5);
    expect(fadeInGain(0.25, "S_CURVE")).toBeCloseTo(0.15625, 5);
  });
});
