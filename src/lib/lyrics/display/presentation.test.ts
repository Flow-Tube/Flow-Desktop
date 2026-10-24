import { describe, expect, it } from "vitest";

import type { LyricsEntry } from "../types";
import { duetSides, lyricsPresentation, lyricsRomanizations, nextMainLineTimes } from "./presentation";
import { contrastRatio, ensureContrastOn, tone, withTone } from "./tone";

describe("lyrics presentation", () => {
  it("puts duet singers on opposite sides in order of appearance", () => {
    const lines: LyricsEntry[] = [
      { time: 0, text: "a", agent: "v2" },
      { time: 1000, text: "b", agent: "v1" },
      { time: 2000, text: "c", agent: "v2" },
      { time: 3000, text: "together", agent: "v1000" },
    ];
    expect(duetSides(lines)).toEqual(["start", "end", "start", "both"]);
  });

  it("lets background vocals follow the line before them without counting as a singer", () => {
    const lines: LyricsEntry[] = [
      { time: 0, text: "a", agent: "v1" },
      { time: 500, text: "(ooh)", agent: "bg", isBackground: true },
      { time: 1000, text: "b", agent: "v2" },
      { time: 1500, text: "(aah)", agent: "bg", isBackground: true },
    ];
    expect(duetSides(lines)).toEqual(["start", "start", "end", "end"]);
  });

  it("does not treat a single singer as a duet", () => {
    expect(duetSides([{ time: 0, text: "a", agent: "v1" }, { time: 1000, text: "b", agent: "v1" }])).toBeNull();
  });

  it("bounds each line by the next main line, skipping background vocals", () => {
    const lines: LyricsEntry[] = [
      { time: 0, text: "a" },
      { time: 500, text: "(bg)", isBackground: true },
      { time: 2000, text: "b" },
    ];
    expect(nextMainLineTimes(lines)).toEqual([2000, 2000, null]);
  });

  it("shows the source romanization unless romanization is turned off", () => {
    const lines: LyricsEntry[] = [{ time: 0, text: "사랑해", romanization: "saranghae" }, { time: 1000, text: "hello" }];
    expect(lyricsRomanizations(lines, true)).toEqual(["saranghae", null]);
    expect(lyricsRomanizations(lines, false)).toEqual([null, null]);
  });

  it("gives the second singer a readable colour of the backdrop's hue, and centres sung-together lines", () => {
    const backdrop = { r: 40, g: 10, b: 60 };
    const accent = { r: 60, g: 20, b: 90 };
    const lines: LyricsEntry[] = [
      { time: 0, text: "a", agent: "v1" },
      { time: 1000, text: "b", agent: "v2" },
      { time: 2000, text: "c", agent: "v3" },
    ];
    const presentation = lyricsPresentation(lines, accent, backdrop, 44, "center", true, [null, null, null]);
    const [first, second, both] = presentation.looks;
    expect(first!.align).toBe("left");
    expect(second!.align).toBe("right");
    expect(both!.align).toBe("center");
    expect(contrastRatio(first!.accent, backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(second!.accent, backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(second!.accent).not.toEqual(first!.accent);
  });
});

describe("colour tone", () => {
  it("reads and sets CIELAB lightness", () => {
    expect(tone({ r: 255, g: 255, b: 255 })).toBeCloseTo(100, 0);
    expect(tone({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 0);
    expect(tone(withTone({ r: 120, g: 100, b: 90 }, 70))).toBeCloseTo(70, 0);
  });

  it("lifts a dark accent off a dark surface until it reads", () => {
    const surface = { r: 20, g: 20, b: 30 };
    const lifted = ensureContrastOn({ r: 40, g: 40, b: 80 }, surface, 4.5);
    expect(contrastRatio(lifted, surface)).toBeGreaterThanOrEqual(4.5);
  });
});
