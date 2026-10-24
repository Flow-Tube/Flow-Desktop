import { describe, expect, it } from "vitest";

import { EQ_FLAT, EQ_PRESETS, eqCurveBands } from "./eqBands";
import { autoPreampDb, peakDb } from "./eq/filterMath";

describe("EQ headroom", () => {
  it("takes the Bass preset's stacked boosts off before the filters", () => {
    const bands = eqCurveBands(EQ_PRESETS.bass);
    // +6, +5 and +4 dB on overlapping bands add up past any single slider.
    expect(peakDb(bands)).toBeGreaterThan(6);
    expect(autoPreampDb(bands)).toBeCloseTo(-peakDb(bands), 6);
  });

  it("leaves a flat or cut-only curve at unity", () => {
    expect(autoPreampDb(eqCurveBands(EQ_FLAT))).toBe(0);
    expect(autoPreampDb(eqCurveBands(EQ_FLAT.map(() => -3)))).toBe(0);
  });
});
