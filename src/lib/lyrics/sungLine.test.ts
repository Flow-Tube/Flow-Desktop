import { describe, expect, it } from "vitest";
import { nextLineTimes, sungLineIndexAt } from "./sungLine";
import type { LyricsEntry } from "./types";

const lines: LyricsEntry[] = [
  { time: 1000, text: "First line" },
  { time: 3000, text: "Second line" },
  { time: 20000, text: "After the break" },
];

describe("sungLineIndexAt", () => {
  it("is empty before the first line", () => {
    expect(sungLineIndexAt(lines, 500)).toBeNull();
  });

  it("follows the line being sung", () => {
    expect(sungLineIndexAt(lines, 2000)).toBe(0);
    expect(sungLineIndexAt(lines, 3000)).toBe(1);
  });

  it("gives way to the artist during a long break", () => {
    expect(sungLineIndexAt(lines, 8000)).toBe(1);
    expect(sungLineIndexAt(lines, 11001)).toBeNull();
    expect(sungLineIndexAt(lines, 20000)).toBe(2);
  });

  it("ends a line with timed words at its last word", () => {
    const worded: LyricsEntry[] = [{ time: 1000, text: "one two", words: [{ text: "one", startTime: 1000, endTime: 2000 }, { text: "two", startTime: 2000, endTime: 3000 }] }];
    expect(sungLineIndexAt(worded, 2500)).toBe(0);
    expect(sungLineIndexAt(worded, 9500)).toBeNull();
  });

  it("ignores unsynced lyrics and background lines", () => {
    expect(sungLineIndexAt([{ time: 0, text: "plain" }], 5000)).toBeNull();
    expect(sungLineIndexAt([{ time: 1000, text: "(ooh)", isBackground: true }], 1500)).toBeNull();
  });

  it("knows when each line's next one starts", () => {
    expect(nextLineTimes(lines)).toEqual([3000, 20000, null]);
  });
});
