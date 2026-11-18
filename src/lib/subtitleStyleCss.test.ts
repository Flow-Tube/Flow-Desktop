import { describe, expect, it } from "vitest";
import { activeCuePositions, captionEdgeShadow, colorWithOpacity, filterCues } from "./subtitleStyleCss";

describe("subtitle style", () => {
  it("makes a color with its opacity", () => {
    expect(colorWithOpacity("#ff8000", 0.5)).toBe("rgba(255, 128, 0, 0.5)");
    expect(colorWithOpacity(undefined, 1)).toBe("rgba(0, 0, 0, 1)");
  });

  it("draws each edge style", () => {
    expect(captionEdgeShadow("none", "red")).toBeUndefined();
    expect(captionEdgeShadow("outline", "red")?.split(", ")).toHaveLength(4);
    expect(captionEdgeShadow("drop_shadow", "red")).toContain("red");
    expect(captionEdgeShadow("raised", "red")).not.toBe(captionEdgeShadow("depressed", "red"));
  });

  it("searches cues ignoring case and stray spaces", () => {
    const cues = [{ text: "Hello there" }, { text: "General Kenobi" }];
    expect(filterCues(cues, " HELLO ")).toEqual([cues[0]]);
    expect(filterCues(cues, "")).toEqual(cues);
    expect(filterCues(cues, "nothing")).toEqual([]);
  });
});

describe("activeCuePositions", () => {
  const cues = [
    { start: 0, end: 2 },
    { start: 1.5, end: 4 },
    { start: 6, end: 8 },
  ];

  it("lists the cues showing at a time, including ones that overlap", () => {
    expect(activeCuePositions(cues, 1)).toBe("0");
    expect(activeCuePositions(cues, 1.8)).toBe("0,1");
    expect(activeCuePositions(cues, 7)).toBe("2");
  });

  it("is empty between cues, and the same string while one cue stays on screen", () => {
    expect(activeCuePositions(cues, 5)).toBe("");
    expect(activeCuePositions(cues, 6.2)).toBe(activeCuePositions(cues, 7.9));
  });
});
