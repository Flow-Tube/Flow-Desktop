import { describe, expect, it } from "vitest";
import { captionEdgeShadow, colorWithOpacity, filterCues } from "./subtitleStyleCss";

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
