import { describe, expect, it } from "vitest";

import type { LyricsEntry } from "../types";
import { buildLines, buildMergedLyricsList, findActiveLineIndices } from "./model";

const breaks = (lines: LyricsEntry[]) =>
  buildMergedLyricsList(lines).flatMap((item) => (item.kind === "indicator" ? [[item.gapStartMs, item.gapEndMs]] : []));

describe("lyric breaks", () => {
  const synced: LyricsEntry[] = [
    { time: 10_000, text: "One" },
    { time: 20_000, text: "Two" },
    { time: 30_000, text: "Three" },
  ];

  it("gives a long silence after a line-synced line a break row once a slow singer would be done", () => {
    const lines = buildLines(null, [{ time: 84_730, text: "x".repeat(40) }, { time: 153_400, text: "After the solo" }]);
    expect(breaks(lines).slice(-1)[0]).toEqual([94_730, 153_400]);
  });

  it("gives a line-synced gap under the limit no break row", () => {
    const lines = buildLines(null, [{ time: 10_000, text: "A short line" }, { time: 24_000, text: "Next" }]);
    expect(breaks(lines).map(([start]) => start)).toEqual([0]);
  });

  it("drops a blank line too short for a break row, and keeps a long one", () => {
    const short = buildLines(null, [...synced, { time: 31_000, text: "" }, { time: 33_000, text: "Quick" }]);
    expect(short.some((line, i) => i > 0 && !line.text)).toBe(false);
    const long = buildLines(null, [...synced, { time: 31_000, text: "" }, { time: 50_000, text: "Later" }]);
    expect(breaks(long).slice(-1)[0]).toEqual([31_000, 50_000]);
  });

  it("ends a line-synced line's turn when its break starts", () => {
    const lines: LyricsEntry[] = [
      { time: 10_000, text: "x".repeat(40) },
      { time: 80_000, text: "Next" },
      { time: 90_000, text: "Last" },
    ];
    expect([...findActiveLineIndices(lines, 15_000)]).toEqual([0]);
    expect([...findActiveLineIndices(lines, 30_000)]).toEqual([]);
    expect([...findActiveLineIndices(lines, 80_500)]).toEqual([1]);
  });

  it("keeps the last line active to the end of the song", () => {
    const lines: LyricsEntry[] = [
      { time: 10_000, text: "One" },
      { time: 20_000, text: "Two" },
      { time: 30_000, text: "Last" },
    ];
    expect([...findActiveLineIndices(lines, 200_000)]).toEqual([2]);
  });
});
