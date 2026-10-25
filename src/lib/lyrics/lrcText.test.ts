import { describe, expect, it } from "vitest";

import { lrcText } from "./lrcText";
import { parseLyrics } from "./lyricsUtils";

describe("LRC text", () => {
  it("writes synced lines as [mm:ss.xx] stamps that read back the same", () => {
    const text = lrcText(
      [
        { time: 12_340, text: "Hello" },
        { time: 61_005, text: "World" },
      ],
      null,
    );
    expect(text).toBe("[00:12.34]Hello\n[01:01.00]World");
    expect(parseLyrics(text).map((e) => [e.time, e.text])).toEqual([
      [12_340, "Hello"],
      [61_000, "World"],
    ]);
  });

  it("keeps plain lyrics as they are", () => {
    expect(lrcText([], "Just words")).toBe("Just words");
  });
});
