import { describe, expect, it } from "vitest";

import { parseLyrics, withoutLineMarkers } from "./lyricsUtils";

const syllable = [
  "[00:32.10]{agent:v1}Baby, I'm yours",
  "<Baby,:32.1:32.5|I'm:32.5:32.9|yours:32.9:33.6>",
  "[00:34.00]{bg}I'm yours",
  "<I'm:34.0:34.4|yours:34.4:35.0>",
  "[00:36.20]{agent:v2}You're so pretty it hurts",
  "<You're:36.2:36.6|so:36.6:36.9|pretty:36.9:37.3|it:37.3:37.5|hurts:37.5:38.2>",
].join("\n");

const lineSynced = "[00:10.00]{agent:v1}First voice\n[00:12.00]{bg}(ooh)\n[00:14.00]{agent:v2}Second voice";

describe("singer markers", () => {
  it("never reach the line text", () => {
    expect(parseLyrics(syllable).map((e) => e.text)).toEqual(["Baby, I'm yours", "I'm yours", "You're so pretty it hurts"]);
    expect(parseLyrics(lineSynced).map((e) => e.text)).toEqual(["First voice", "(ooh)", "Second voice"]);
  });

  it("become the singer and the background flag", () => {
    expect(parseLyrics(syllable).map((e) => [e.agent, e.isBackground])).toEqual([
      ["v1", false],
      ["v1", true],
      ["v2", false],
    ]);
    expect(parseLyrics(lineSynced).map((e) => [e.agent, e.isBackground])).toEqual([
      ["v1", false],
      ["v1", true],
      ["v2", false],
    ]);
  });

  it("keep the word timings from the block under the line", () => {
    expect(parseLyrics(syllable)[0]!.words?.map((w) => w.text)).toEqual(["Baby,", "I'm", "yours"]);
  });

  it("are cleaned out of lyrics an earlier version saved", () => {
    const saved = [
      { time: 10_000, text: "{agent:v1}First voice", words: null },
      { time: 12_000, text: "{bg}(ooh)", words: null },
    ];
    expect(withoutLineMarkers(saved)).toEqual([
      { time: 10_000, text: "First voice", words: null, agent: "v1", isBackground: false },
      { time: 12_000, text: "(ooh)", words: null, agent: "v1", isBackground: true },
    ]);
    const clean = [{ time: 1, text: "Plain", words: null }];
    expect(withoutLineMarkers(clean)).toBe(clean);
  });
});
