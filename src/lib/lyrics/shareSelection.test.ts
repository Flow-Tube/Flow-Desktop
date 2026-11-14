import { describe, expect, it } from "vitest";

import {
  autoSelectLyricIndices,
  isShareableLine,
  MAX_SHARE_LINES,
  shareLineIndexAt,
  shareLines,
  toggleShareLine,
} from "./shareSelection";

describe("shareLines", () => {
  it("skips blank lines and section markers, from synced or plain lyrics", () => {
    expect(isShareableLine("[Chorus]")).toBe(false);
    expect(isShareableLine("  ")).toBe(false);
    expect(shareLines([{ time: 500, text: "[Intro]" }, { time: 1000, text: " First " }], "")).toEqual([{ text: "First", time: 1000 }]);
    expect(shareLines([], "One\n\n[Verse]\nTwo")).toEqual([
      { text: "One", time: null },
      { text: "Two", time: null },
    ]);
  });
});

describe("shareLineIndexAt", () => {
  const lines = [
    { text: "a", time: 1000 },
    { text: "b", time: 3000 },
    { text: "c", time: 5000 },
  ];

  it("finds the line that is playing, or the first before any has started", () => {
    expect(shareLineIndexAt(lines, 0)).toBe(0);
    expect(shareLineIndexAt(lines, 3500)).toBe(1);
    expect(shareLineIndexAt(lines, 9000)).toBe(2);
    expect(shareLineIndexAt([{ text: "plain", time: null }], 9000)).toBe(0);
  });
});

describe("autoSelectLyricIndices", () => {
  it("returns empty array for empty lines", () => {
    expect(autoSelectLyricIndices(0, 0, 4)).toEqual([]);
  });

  it("returns all lines when total lines is less than or equal to maxCount", () => {
    expect(autoSelectLyricIndices(3, 1, 4)).toEqual([0, 1, 2]);
  });

  it("selects a cohesive group of 4 lines starting at the target index", () => {
    expect(autoSelectLyricIndices(10, 2, 4)).toEqual([2, 3, 4, 5]);
  });

  it("shifts back when target is near the end to select the last 4 lines", () => {
    expect(autoSelectLyricIndices(10, 8, 4)).toEqual([6, 7, 8, 9]);
  });
});

describe("toggleShareLine", () => {
  it("keeps song order and refuses a line past the cap", () => {
    expect(toggleShareLine([3, 1], 2)).toEqual([1, 2, 3]);
    expect(toggleShareLine([1, 2], 1)).toEqual([2]);
    const full = Array.from({ length: MAX_SHARE_LINES }, (_, i) => i);
    expect(toggleShareLine(full, 9)).toBe(full);
  });
});
