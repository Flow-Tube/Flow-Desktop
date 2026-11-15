import { describe, expect, it } from "vitest";

import { CADENCE_EXIT_MS, crescendoScale, exitFill, heldNoteSwell, reflowAnchor, rippleLift, rippleSettledMs } from "./cadence";
import { isLetterSplittable, letterStarts, markHyphenRuns, type KaraokeWord } from "./karaoke";

const word = (startMs: number, endMs: number): KaraokeWord => ({ startMs, endMs, group: -1, groupSize: 0, groupEndMs: 0, inkWidth: 1 });

describe("Cadence letters", () => {
  it("keeps an accent with its letter", () => {
    expect(letterStarts("éx")).toEqual([0, 2]);
  });

  it("keeps an f with the letter it may form a ligature with", () => {
    expect(letterStarts("fine")).toEqual([0, 2, 3]);
    expect(letterStarts("office")).toEqual([0, 1, 4, 5]);
  });

  it("splits only scripts that don't join", () => {
    expect(isLetterSplittable("hello")).toBe(true);
    expect(isLetterSplittable("שלום")).toBe(true);
    expect(isLetterSplittable("你好")).toBe(true);
    expect(isLetterSplittable("привет")).toBe(true);
    expect(isLetterSplittable("नमस्ते")).toBe(false);
    expect(isLetterSplittable("ভালোবাসা")).toBe(false);
    expect(isLetterSplittable("سلام")).toBe(false);
    expect(isLetterSplittable("สวัสดี")).toBe(false);
  });

  it("has nothing to split in a single letter", () => {
    expect(isLetterSplittable("a")).toBe(false);
  });
});

describe("Cadence motion", () => {
  it("puts a letter at its crest the moment it is fully lit", () => {
    // Word 0-1000 ms, letter from 20% to 40% of it, a soft edge 5% wide: it starts rising at 150 ms
    // and is lit at 450 ms.
    expect(rippleLift(149, 0, 1000, 0.2, 0.4, 0.05)).toBe(0);
    expect(rippleLift(450, 0, 1000, 0.2, 0.4, 0.05)).toBeCloseTo(1, 3);
    const rising = rippleLift(300, 0, 1000, 0.2, 0.4, 0.05);
    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(1);
  });

  it("settles a sung letter a little raised", () => {
    expect(rippleLift(5000, 0, 1000, 0.2, 0.4, 0.05)).toBe(0.4);
    expect(rippleSettledMs(0, 1000, 0.4, 0.05)).toBeCloseTo(1350, 6);
  });

  it("swells only a long held note, most in its middle", () => {
    expect(heldNoteSwell(400, 0, 800)).toBe(1);
    expect(heldNoteSwell(900, 0, 1800)).toBeCloseTo(1.035, 4);
    expect(heldNoteSwell(1900, 0, 1800)).toBe(1);
  });

  it("climbs a hyphenated run and springs it back", () => {
    const words = [word(0, 300), word(300, 600), word(600, 1000), word(1100, 1500)];
    markHyphenRuns(
      ["so-", "o-", "o", "long"],
      [
        [0, 2],
        [3, 4],
        [5, 5],
        [7, 10],
      ],
      words,
    );
    expect(words.map((w) => w.group)).toEqual([0, 1, 2, -1]);
    expect(words[0]!.groupEndMs).toBe(1000);
    expect(crescendoScale(200, words[0]!)).toBe(1);
    expect(crescendoScale(400, words[1]!)).toBeCloseTo(1.012, 4);
    expect(crescendoScale(1000, words[2]!)).toBeCloseTo(1 + 0.024 + 0.06, 4);
    expect(crescendoScale(1600, words[2]!)).toBeCloseTo(1, 4);
    expect(crescendoScale(1200, words[3]!)).toBe(1);
  });

  it("doesn't treat syllables split by a space as a run", () => {
    const words = [word(0, 300), word(300, 600)];
    markHyphenRuns(
      ["so-", "long"],
      [
        [0, 2],
        [4, 7],
      ],
      words,
    );
    expect(words.map((w) => w.group)).toEqual([-1, -1]);
  });

  it("moves a grown row the way its alignment holds it", () => {
    expect(reflowAnchor("center")).toBe(0.5);
    expect(reflowAnchor("left")).toBe(0);
    expect(reflowAnchor("right")).toBe(1);
  });

  it("lets a line go by finishing its fill first", () => {
    const fillDone = 180 / CADENCE_EXIT_MS;
    expect(exitFill(fillDone / 2)).toBeCloseTo(0.5, 3);
    expect(exitFill(fillDone)).toBe(1);
  });
});
