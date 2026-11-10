import { describe, expect, it } from "vitest";

import type { LyricsEntry } from "./types";
import { onVideoClock, type NonMusicPart } from "./nonMusicParts";

const VIDEO_MS = 400_000;
const intro: NonMusicPart = { startMs: 0, endMs: 75_000 };
const lines = (...times: number[]): LyricsEntry[] => times.map((time) => ({ time, text: `Line ${time}` }));
const timesOf = (entries: LyricsEntry[]) => entries.map((entry) => entry.time);

describe("lyrics on a music video's clock", () => {
  it("moves lines sung inside a non-music part past it", () => {
    expect(timesOf(onVideoClock(lines(5_800, 20_000, 200_000), [intro], VIDEO_MS))).toEqual([80_800, 95_000, 275_000]);
  });

  it("leaves lyrics already on the video's clock where they are", () => {
    const entries = lines(36_000, 60_000);
    const parts = [
      { startMs: 0, endMs: 23_100 },
      { startMs: 241_700, endMs: 262_500 },
    ];
    expect(onVideoClock(entries, parts, VIDEO_MS)).toBe(entries);
  });

  it("changes nothing when moving lyrics twice", () => {
    const once = onVideoClock(lines(5_800, 20_000, 40_000), [intro], VIDEO_MS);
    expect(onVideoClock(once, [intro], VIDEO_MS)).toEqual(once);
  });

  it("needs more than one stray line, and lines at a part's edge don't count", () => {
    const stray = lines(5_000, 80_000);
    expect(onVideoClock(stray, [intro], VIDEO_MS)).toBe(stray);
    const atEdge = lines(74_000, 74_500, 90_000);
    expect(onVideoClock(atEdge, [intro], VIDEO_MS)).toBe(atEdge);
  });

  it("moves only the lines after a part in the middle, past every part they reach", () => {
    const parts = [
      { startMs: 0, endMs: 10_000 },
      { startMs: 50_000, endMs: 60_000 },
    ];
    expect(timesOf(onVideoClock(lines(1_000, 5_000, 30_000, 45_000), parts, VIDEO_MS))).toEqual([11_000, 15_000, 40_000, 65_000]);
  });

  it("counts overlapping parts once", () => {
    const parts = [
      { startMs: 0, endMs: 38_900 },
      { startMs: 36_200, endMs: 43_600 },
    ];
    expect(timesOf(onVideoClock(lines(1_000, 8_000), parts, VIDEO_MS))).toEqual([44_600, 51_600]);
  });

  it("moves word timings with their line", () => {
    const entries: LyricsEntry[] = [
      {
        time: 1_000,
        text: "Hello there",
        words: [
          { text: "Hello", startTime: 1_000, endTime: 1_500 },
          { text: "there", startTime: 1_600, endTime: 2_000 },
        ],
      },
      { time: 8_000, text: "Second" },
    ];
    const moved = onVideoClock(entries, [intro], VIDEO_MS);
    expect(moved[0]!.words!.map((w) => [w.startTime, w.endTime])).toEqual([
      [76_000, 76_500],
      [76_600, 77_000],
    ]);
  });

  it("does not count backing lines or break markers, but moves them with the rest", () => {
    const backing: LyricsEntry[] = [
      { time: 1_000, text: "Ooh", isBackground: true },
      { time: 2_000, text: "Ooh", isBackground: true },
      { time: 80_000, text: "Line" },
    ];
    expect(onVideoClock(backing, [intro], VIDEO_MS)).toBe(backing);
    expect(onVideoClock([...backing, ...lines(3_000, 4_000)], [intro], VIDEO_MS)[0]!.time).toBe(76_000);
    const markers: LyricsEntry[] = [{ time: 10_000, text: "" }, { time: 20_000, text: "" }, { time: 200_000, text: "Sung" }];
    expect(onVideoClock(markers, [intro], VIDEO_MS)).toBe(markers);
  });

  it("leaves lyrics that would run past the video's end, or when its length is unknown", () => {
    const spoken = lines(3_000, 100_000, 205_000, 220_000, 241_000);
    expect(onVideoClock(spoken, [{ startMs: 200_000, endMs: 245_000 }], 245_000)).toBe(spoken);
    expect(onVideoClock(lines(5_000, 10_000, 125_000), [intro], 200_000).slice(-1)[0]!.time).toBe(200_000);
    const unknown = lines(5_000, 10_000);
    expect(onVideoClock(unknown, [intro], 0)).toBe(unknown);
    expect(onVideoClock(unknown, [], VIDEO_MS)).toBe(unknown);
  });
});
