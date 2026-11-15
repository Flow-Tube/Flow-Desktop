import { describe, expect, it } from "vitest";
import { sungLineAt } from "./sungLine";
import type { LyricsEntry } from "./types";

const lines: LyricsEntry[] = [
  { time: 1000, text: "First line" },
  { time: 3000, text: "Second line" },
  { time: 20000, text: "After the break" },
];

describe("sungLineAt", () => {
  it("is empty before the first line", () => {
    expect(sungLineAt(lines, 500)).toBeNull();
  });

  it("fills a line evenly up to the next one", () => {
    expect(sungLineAt(lines, 2000)).toEqual({ index: 0, text: "First line", fill: 0.5 });
  });

  it("gives way to the artist during a long break", () => {
    expect(sungLineAt(lines, 8000)?.text).toBe("Second line");
    expect(sungLineAt(lines, 11001)).toBeNull();
    expect(sungLineAt(lines, 20000)?.text).toBe("After the break");
  });

  it("fills word by word when words are timed", () => {
    const worded: LyricsEntry[] = [
      {
        time: 1000,
        text: "one two",
        words: [
          { text: "one", startTime: 1000, endTime: 2000 },
          { text: "two", startTime: 2000, endTime: 3000 },
        ],
      },
    ];
    expect(sungLineAt(worded, 1500)?.fill).toBe(0.25);
    expect(sungLineAt(worded, 2500)?.fill).toBe(0.75);
    expect(sungLineAt(worded, 9500)).toBeNull();
  });

  it("ignores unsynced lyrics and background lines", () => {
    expect(sungLineAt([{ time: 0, text: "plain" }], 5000)).toBeNull();
    expect(sungLineAt([{ time: 1000, text: "(ooh)", isBackground: true }], 1500)).toBeNull();
  });
});
