import { describe, expect, it } from "vitest";
import { loudnessFactor } from "./loudness";

describe("loudnessFactor", () => {
  it("turns a loud stream down to the target and leaves quiet ones alone", () => {
    expect(loudnessFactor(6, true)).toBeCloseTo(0.501, 3);
    expect(loudnessFactor(-4, true)).toBe(1);
    expect(loudnessFactor(6, false)).toBe(1);
    expect(loudnessFactor(null, true)).toBe(1);
  });
});
