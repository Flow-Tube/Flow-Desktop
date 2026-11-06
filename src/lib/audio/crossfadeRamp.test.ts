import { describe, expect, it } from "vitest";

import { fadeInGain, fadeOutGain, type CrossfadeCurve } from "./crossfadeRamp";

const CURVES: CrossfadeCurve[] = ["equal_power", "s_curve", "hold", "gentle"];

describe("fade curves", () => {
  it.each(CURVES)("%s runs from one song to the other", (curve) => {
    expect(fadeOutGain(0, curve)).toBeCloseTo(1);
    expect(fadeInGain(0, curve)).toBeCloseTo(0);
    expect(fadeOutGain(1, curve)).toBeCloseTo(0);
    expect(fadeInGain(1, curve)).toBeCloseTo(1);
  });

  it("keeps the blend's power steady on the equal-power family", () => {
    for (const curve of ["equal_power", "s_curve", "hold"] as const) {
      for (const t of [0.1, 0.5, 0.9]) {
        expect(fadeOutGain(t, curve) ** 2 + fadeInGain(t, curve) ** 2).toBeCloseTo(1);
      }
    }
  });

  it("holds the current song up for longer on hold, and dips in the middle on gentle", () => {
    expect(fadeOutGain(0.5, "hold")).toBeGreaterThan(fadeOutGain(0.5, "equal_power"));
    expect(fadeOutGain(0.5, "gentle") + fadeInGain(0.5, "gentle")).toBeCloseTo(1);
    expect(fadeOutGain(0.5, "gentle") ** 2 + fadeInGain(0.5, "gentle") ** 2).toBeLessThan(1);
  });
});
