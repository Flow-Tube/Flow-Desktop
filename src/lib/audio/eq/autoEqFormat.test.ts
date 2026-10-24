import { describe, expect, it } from "vitest";

import { formatAutoEq, parseAutoEq } from "./autoEqFormat";
import { band, EqLimits, type EqCurve } from "./models";

// Ported from Android's AutoEqFormatTest.
describe("AutoEqFormat", () => {
  it("reads an AutoEQ file and skips its empty filters", () => {
    const text = [
      "Preamp: -2.0 dB",
      "Filter 1: ON PK Fc 60 Hz Gain 4.0 dB Q 0.710",
      "Filter 2: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.70",
      "Filter 3: ON HSC Fc 10000 Hz Gain -2.1 dB Q 0.70",
      "Filter 4: OFF PK Fc 0 Hz Gain 0.0 dB Q 0.000",
      "Filter 5: OFF PK Fc 0 Hz Gain 0.0 dB Q 0.000",
    ].join("\n");

    const result = parseAutoEq(text)!;

    expect(result.curve.preamp).toBe(-2);
    expect(result.curve.bands).toEqual([
      band(60, 4, 0.71, "PEAK"),
      band(105, 5.5, 0.7, "LOW_SHELF"),
      band(10_000, -2.1, 0.7, "HIGH_SHELF"),
    ]);
    expect(result.skippedFilters).toBe(2);
  });

  it("an ON filter at 0 Hz or Q 0 is refused rather than turned into NaN", () => {
    const text = "Filter 1: ON PK Fc 0 Hz Gain 3 dB Q 1\nFilter 2: ON PK Fc 500 Hz Gain 3 dB Q 0\nFilter 3: ON PK Fc 800 Hz Gain 1 dB Q 1";
    const result = parseAutoEq(text)!;
    expect(result.curve.bands).toEqual([band(800, 1, 1)]);
    expect(result.skippedFilters).toBe(2);
    expect(parseAutoEq("Filter 1: ON PK Fc 0 Hz Gain 3 dB Q 0")).toBeNull();
  });

  it("accepts comma decimals, lower case, short type names and bandwidth", () => {
    const text = [
      "preamp: -3,5 dB",
      "filter 1: on pk fc 1000 hz gain 2,5 db q 1,41",
      "Filter 2: ON LS Fc 80 Hz Gain 3 dB",
      "Filter 3: ON PK Fc 2000 Hz Gain -1 dB BW Oct 1.0",
      "Filter 4: ON HP Fc 30 Hz Q 0.5",
      "Filter 5: ON LSC 12 dB Fc 90 Hz Gain 2 dB",
    ].join("\n");

    const bands = parseAutoEq(text)!.curve.bands;

    expect(bands[0]).toEqual(band(1_000, 2.5, 1.41, "PEAK"));
    expect(bands[1]).toEqual(band(80, 3, EqLimits.DEFAULT_SHELF_Q, "LOW_SHELF"));
    expect(Math.abs(bands[2]!.q - 1.414)).toBeLessThan(0.001);
    expect(bands[3]).toEqual(band(30, 0, 0.5, "HIGH_PASS"));
    expect(bands[4]).toEqual(band(90, 2, EqLimits.DEFAULT_SHELF_Q, "LOW_SHELF"));
  });

  it("a thousands separator in a frequency is not a decimal mark", () => {
    expect(parseAutoEq("Filter 1: ON PK Fc 1,000 Hz Gain 2 dB Q 1")!.curve.bands[0]!.frequency).toBe(1_000);
  });

  it("counts unsupported filters and other commands", () => {
    const text = [
      "# headphone target",
      "Device: Speakers",
      "Channel: L",
      "Filter 1: ON NO Fc 50 Hz Q 30",
      "Filter 2: ON PK Fc 500 Hz Gain 1 dB Q 1",
    ].join("\n");

    const result = parseAutoEq(text)!;

    expect(result.curve.bands).toHaveLength(1);
    expect(result.skippedFilters).toBe(1);
    expect(result.ignoredLines).toBe(2);
  });

  it("keeps the first twenty filters", () => {
    const text = Array.from({ length: 25 }, (_, i) => `Filter ${i + 1}: ON PK Fc ${(i + 1) * 100} Hz Gain 1 dB Q 1`).join("\n");
    const result = parseAutoEq(text)!;
    expect(result.curve.bands).toHaveLength(EqLimits.MAX_BANDS);
    expect(result.truncatedFilters).toBe(5);
  });

  it("clamps values outside the limits", () => {
    expect(parseAutoEq("Filter 1: ON PK Fc 5 Hz Gain 40 dB Q 50")!.curve.bands[0]).toEqual(
      band(EqLimits.MIN_FREQUENCY, EqLimits.MAX_GAIN, EqLimits.MAX_Q, "PEAK"),
    );
  });

  it("text without filters or preamp is not a preset", () => {
    expect(parseAutoEq("")).toBeNull();
    expect(parseAutoEq("hello\nworld")).toBeNull();
  });

  it("exported text reads back to the same curve", () => {
    const curve: EqCurve = {
      preamp: -4.5,
      bands: [
        band(64, 3.5, 0.7, "LOW_SHELF"),
        band(910, -2, 1.41),
        band(15_000, 0, 0.707, "LOW_PASS"),
        band(3_000, 2, 1, "PEAK", false),
      ],
    };

    const text = formatAutoEq(curve);
    const parsed = parseAutoEq(text)!;

    expect(text).toContain("Filter 3: ON LPQ Fc 15000 Hz Q 0.707");
    expect(parsed.curve).toEqual({ ...curve, bands: curve.bands.slice(0, 3) });
    expect(parsed.skippedFilters).toBe(1);
  });
});
