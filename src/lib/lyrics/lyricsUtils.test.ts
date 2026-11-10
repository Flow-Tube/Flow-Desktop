import { describe, expect, it } from "vitest";

import { parseLyrics } from "./lyricsUtils";

describe("LRC break markers", () => {
  it("keeps a timed blank line as a blank entry", () => {
    const entries = parseLyrics("[01:24.73] Sung line\n[01:38.95] \n[02:33.40] Next line");
    expect(entries.map((e) => [e.time, e.text])).toEqual([
      [84_730, "Sung line"],
      [98_950, ""],
      [153_400, "Next line"],
    ]);
  });

  it("reads lyrics with only blank lines as no lyrics", () => {
    expect(parseLyrics("[00:01.00] \n[00:30.00] ")).toEqual([]);
  });

  it("does not take a blank line with no time for a break", () => {
    expect(parseLyrics("[00:01.00] One\n\n[00:30.00] Two").map((e) => e.text)).toEqual(["One", "Two"]);
  });
});
