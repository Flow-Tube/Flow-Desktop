import { describe, expect, it } from "vitest";

import { autoPreampDb, fractionOf, frequencyAt, isBypassed, magnitudeDb, peakDb } from "./filterMath";
import { band, type EqBand } from "./models";

const db = (b: EqBand, frequency: number) => magnitudeDb([b], frequency);

// Ported from Android's EqFilterMathTest.
describe("EqFilterMath", () => {
  it("a peak reaches its gain at its centre and leaves far frequencies alone", () => {
    const peak = band(1_000, 6, 1, "PEAK");
    expect(Math.abs(db(peak, 1_000) - 6)).toBeLessThan(0.01);
    expect(Math.abs(db(peak, 20))).toBeLessThan(0.05);
  });

  it("shelves lift their side of the spectrum", () => {
    expect(Math.abs(db(band(100, 6, 0.707, "LOW_SHELF"), 20) - 6)).toBeLessThan(0.3);
    expect(Math.abs(db(band(100, 6, 0.707, "LOW_SHELF"), 10_000))).toBeLessThan(0.05);
    expect(Math.abs(db(band(5_000, -4, 0.707, "HIGH_SHELF"), 18_000) + 4)).toBeLessThan(0.3);
  });

  it("shelf Q changes the sound", () => {
    const gentle = db(band(100, 6, 0.707, "LOW_SHELF"), 150);
    const resonant = db(band(100, 6, 2, "LOW_SHELF"), 150);
    expect(Math.abs(resonant - gentle)).toBeGreaterThan(0.2);
  });

  it("low and high pass cut instead of peaking", () => {
    expect(Math.abs(db(band(100, 0, 0.707, "HIGH_PASS"), 100) + 3.01)).toBeLessThan(0.05);
    expect(db(band(100, 0, 0.707, "HIGH_PASS"), 20)).toBeLessThan(-20);
    expect(db(band(5_000, 0, 0.707, "LOW_PASS"), 15_000)).toBeLessThan(-15);
    expect(Math.abs(db(band(5_000, 0, 0.707, "LOW_PASS"), 100))).toBeLessThan(0.05);
  });

  it("flat, disabled and ultrasonic bands are bypassed", () => {
    expect(isBypassed(band(1_000, 0), 48_000)).toBe(true);
    expect(isBypassed(band(1_000, 3, 1.41, "PEAK", false), 48_000)).toBe(true);
    expect(isBypassed(band(22_000, 3), 44_100)).toBe(true);
    expect(isBypassed(band(1_000, 0, 1.41, "LOW_PASS"), 48_000)).toBe(false);
  });

  it("the #810 sample peaks where the old processor clipped it", () => {
    const hefty = [band(60, 4, 0.71), band(230, 1, 0.71), band(910, 9, 0.71), band(3_000, 3, 0.71)];
    expect(Math.abs(peakDb(hefty) - 9.71)).toBeLessThan(0.05);
    expect(Math.abs(autoPreampDb(hefty) + 9.71)).toBeLessThan(0.05);
  });

  it("auto preamp never boosts", () => {
    expect(autoPreampDb([band(1_000, -6)])).toBe(0);
    expect(autoPreampDb([])).toBe(0);
  });

  it("the log axis round trips", () => {
    for (const frequency of [20, 63, 1_000, 12_345, 20_000]) {
      expect(Math.abs(frequencyAt(fractionOf(frequency)) - frequency)).toBeLessThan(0.01);
    }
  });
});
