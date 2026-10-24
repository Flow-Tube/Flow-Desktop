import { describe, expect, it } from "vitest";

import { breakLines, isRtlText, layoutText, type TextMeasurer } from "./textLayout";
import { buildKaraokeGeometry } from "./karaoke";
import { wordCharRanges } from "./timing";

/** Every character is 10px wide; the font is 20px with a 16 ascent and 4 descent. */
const fixedMeasurer: TextMeasurer = {
  width: (text) => Array.from(text).length * 10,
  extent: () => ({ ascent: 16, descent: 4 }),
};

const style = { size: 20, weight: 700, italic: false, family: "Inter", lineSpacing: 1.3 };

describe("lyrics text layout", () => {
  it("breaks between words and drops the spaces at the break", () => {
    const rows = breakLines("hold me close tonight", "f", 120, fixedMeasurer);
    expect(rows.map((r) => r.text)).toEqual(["hold me", "close", "tonight"]);
    expect(rows[1]).toMatchObject({ start: 8, end: 13, width: 50 });
  });

  it("breaks between CJK characters", () => {
    expect(breakLines("我爱你我爱你", "f", 40, fixedMeasurer).map((r) => r.text)).toEqual(["我爱你我", "爱你"]);
    expect(breakLines("我爱你，我爱你", "f", 30, fixedMeasurer).map((r) => r.text)).toEqual(["我爱", "你，我", "爱你"]);
  });

  it("breaks a word wider than the line between its letters", () => {
    expect(breakLines("abcdefghij", "f", 40, fixedMeasurer).map((r) => r.text)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("keeps punctuation with its word", () => {
    expect(breakLines("hello, world", "f", 60, fixedMeasurer).map((r) => r.text)).toEqual(["hello,", "world"]);
  });

  it("trims the extra leading off the first and last rows", () => {
    const block = layoutText("hold me close tonight", style, 120, fixedMeasurer);
    expect(block.lineHeight).toBe(26);
    expect(block.height).toBe(2 * 26 + 20);
  });

  it("reads the direction from the first strong character", () => {
    expect(isRtlText("حبيبي love")).toBe(true);
    expect(isRtlText("123 love حبيبي")).toBe(false);
    expect(isRtlText("שלום")).toBe(true);
  });
});

describe("karaoke geometry", () => {
  const words = [
    { text: "hold", startTime: 0, endTime: 400 },
    { text: "me", startTime: 400, endTime: 600 },
    { text: "close", startTime: 600, endTime: 2000 },
  ];

  it("cuts each row into word cells that meet halfway, with uncovered punctuation as its own cell", () => {
    const text = "hold me close!";
    const block = layoutText(text, style, 1000, fixedMeasurer);
    const geometry = buildKaraokeGeometry(text, block, 200, "left", words, wordCharRanges(text, words, false), fixedMeasurer);
    expect(geometry.cells.map((c) => [c.word, c.inkLeft, c.inkRight])).toEqual([
      [0, 0, 40],
      [1, 50, 70],
      [2, 80, 130],
      [-1, 130, 140],
    ]);
    const sorted = [...geometry.cells].sort((a, b) => a.inkLeft - b.inkLeft);
    expect(sorted.map((c) => [c.clipLeft, c.clipRight])).toEqual([
      [-200, 45],
      [45, 75],
      [75, 130],
      [130, 400],
    ]);
    expect(geometry.cells[3]!.wordBefore).toBe(2);
    expect(geometry.cells[2]!.glowText).toBe("close");
    expect(geometry.cells[0]!.glowText).toBeNull();
  });

  it("places each row at its alignment and baseline", () => {
    const text = "hold me close";
    const block = layoutText(text, style, 65, fixedMeasurer);
    const geometry = buildKaraokeGeometry(text, block, 65, "center", words, wordCharRanges(text, words, false), fixedMeasurer);
    expect(block.rows.map((r) => r.text)).toEqual(["hold", "me", "close"]);
    expect(geometry.rows.map((r) => r.x)).toEqual([12.5, 22.5, 7.5]);
    expect(geometry.rows.map((r) => r.baseline)).toEqual([16, 42, 68]);
  });

  it("fills a right-to-left row from the right", () => {
    const text = "שלום עולם";
    const rtlWords = [
      { text: "שלום", startTime: 0, endTime: 500 },
      { text: "עולם", startTime: 500, endTime: 1000 },
    ];
    const block = layoutText(text, style, 1000, fixedMeasurer);
    const geometry = buildKaraokeGeometry(text, block, 200, "right", rtlWords, wordCharRanges(text, rtlWords, false), fixedMeasurer);
    expect(geometry.cells.map((c) => [c.rtl, c.inkLeft, c.inkRight])).toEqual([
      [true, 160, 200],
      [true, 110, 150],
    ]);
  });
});
