import { describe, expect, it } from "vitest";
import { playCornerRadius, splitSideRadius, splitWeights } from "./splitTransport";

describe("split transport", () => {
  it("rounds Previous on its start side and keeps it nearly flat towards Play/pause", () => {
    expect(splitSideRadius(true, 68, 0)).toBe("34px 8px 8px 34px");
  });

  it("mirrors Next", () => {
    expect(splitSideRadius(false, 68, 0)).toBe("8px 34px 34px 8px");
  });

  it("opens the inner corner while pressed", () => {
    expect(splitSideRadius(true, 68, 1)).toBe("34px 20px 20px 34px");
    expect(splitSideRadius(true, 68, 0.5)).toBe("34px 14px 14px 34px");
  });

  it("never makes a corner negative when the spring undershoots", () => {
    expect(splitSideRadius(false, 68, -2)).toBe("0px 34px 34px 0px");
  });

  it("trades width with the part held", () => {
    expect(splitWeights(null)).toEqual({ previous: 0.45, play: 1.3, next: 0.45 });
    expect(splitWeights("play").play).toBe(1.9);
    expect(splitWeights("next").next).toBe(0.65);
  });

  it("squares Play/pause while playing", () => {
    expect(playCornerRadius(68, false)).toBe(34);
    expect(playCornerRadius(68, true)).toBe(18);
  });
});
