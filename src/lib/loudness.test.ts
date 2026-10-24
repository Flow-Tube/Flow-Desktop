import { describe, expect, it } from "vitest";
import { loudnessFactor, MUSIC_MAX_CUT_DB } from "./loudness";

describe("loudnessFactor", () => {
  it("turns a loud stream down to the target and leaves quiet ones alone", () => {
    expect(loudnessFactor(6, true)).toBeCloseTo(0.501, 3);
    expect(loudnessFactor(-4, true)).toBe(1);
    expect(loudnessFactor(6, false)).toBe(1);
    expect(loudnessFactor(null, true)).toBe(1);
  });

  it("stops music at minus 20 dB, as Android does, and leaves video uncapped", () => {
    expect(loudnessFactor(35, true, MUSIC_MAX_CUT_DB)).toBeCloseTo(0.1, 6);
    expect(loudnessFactor(35, true)).toBeCloseTo(Math.pow(10, -35 / 20), 9);
  });
});
