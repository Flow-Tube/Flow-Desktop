import { describe, expect, it } from "vitest";

import { band, EqLimits } from "./models";
import { filterSetting, graphChangesSound, graphSpec, hasNonButterworthShelf, EQ_GRAPH_OFF } from "./graphPlan";
import { defaultEqState, processingSpec, selectPreset, withBassBoost } from "./stateOps";

const RATE = 48_000;

describe("graphPlan", () => {
  it("gives bass boost its own shelf and keeps Android's preamp", () => {
    const state = withBassBoost(selectPreset(defaultEqState(), "builtin:rock"), 6);
    const spec = graphSpec(state, false);
    expect(spec.bassBoostDb).toBe(6);
    expect(spec.bands).toHaveLength(5);
    expect(spec.preampDb).toBe(processingSpec(state, false).preampDb);
  });

  it("is off when the equalizer is off or held for compare", () => {
    const state = selectPreset(defaultEqState(), "builtin:rock");
    expect(graphSpec({ ...state, enabled: false }, false)).toEqual(EQ_GRAPH_OFF);
    expect(graphSpec(state, true)).toEqual(EQ_GRAPH_OFF);
    expect(graphChangesSound(graphSpec(state, false), RATE)).toBe(true);
    expect(graphChangesSound(graphSpec(defaultEqState(), false), RATE)).toBe(false);
  });

  it("hands WebAudio its own Q forms", () => {
    expect(filterSetting(band(1_000, 3, 2), RATE)).toEqual({ type: "peaking", frequency: 1_000, q: 2, gain: 3 });
    expect(filterSetting(band(80, 4, 0.707, "LOW_SHELF"), RATE)?.type).toBe("lowshelf");
    const lowPass = filterSetting(band(8_000, 0, 0.707, "LOW_PASS"), RATE)!;
    expect(lowPass.type).toBe("lowpass");
    // Butterworth's 0.707 is -3 dB in WebAudio's resonance form.
    expect(lowPass.q).toBeCloseTo(-3.01, 2);
    expect(filterSetting(band(30, 0, 1, "HIGH_PASS"), RATE)!.q).toBeCloseTo(0, 6);
  });

  it("leaves flat, disabled and out-of-range bands flat", () => {
    expect(filterSetting(undefined, RATE)).toBeNull();
    expect(filterSetting(band(1_000, 0), RATE)).toBeNull();
    expect(filterSetting(band(1_000, 3, 1, "PEAK", false), RATE)).toBeNull();
    expect(filterSetting(band(EqLimits.MAX_FREQUENCY, 3), 22_050)).toBeNull();
  });

  it("notices shelves whose Q WebAudio cannot play", () => {
    expect(hasNonButterworthShelf({ preamp: 0, bands: [band(100, 3, 0.7, "LOW_SHELF")] })).toBe(false);
    expect(hasNonButterworthShelf({ preamp: 0, bands: [band(100, 3, 2, "LOW_SHELF")] })).toBe(true);
    expect(hasNonButterworthShelf({ preamp: 0, bands: [band(100, 3, 2)] })).toBe(false);
  });
});
