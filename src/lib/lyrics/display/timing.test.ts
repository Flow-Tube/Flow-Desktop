import { describe, expect, it } from "vitest";

import { lyricTokens, syllableWeight, synthesizeWordTimings, wordCharRanges } from "./timing";
import { wordLiftProgress } from "./motion";
import { rowCellBounds } from "./karaoke";
import { sanitizeWordTimestamps, splitTrailingHyphenWord } from "./model";

describe("lyrics timing", () => {
  it("fills the line in order and leaves a breath before the next line", () => {
    const words = synthesizeWordTimings("hold me close tonight", 10000, 13000);
    expect(words.map((w) => w.text)).toEqual(["hold", "me", "close", "tonight"]);
    expect(words[0]!.startTime).toBe(10000);
    for (let i = 1; i < words.length; i++) expect(words[i]!.startTime).toBe(words[i - 1]!.endTime);
    expect(words[words.length - 1]!.endTime).toBeLessThan(13000);
    expect(words[words.length - 1]!.endTime).toBeGreaterThanOrEqual(12500);
  });

  it("gives longer words longer than short ones", () => {
    const words = synthesizeWordTimings("I remember", 0, 2000);
    const short = words[0]!.endTime - words[0]!.startTime;
    const long = words[1]!.endTime - words[1]!.startTime;
    expect(long).toBeGreaterThan(short * 2);
  });

  it("turns a long gap after the line into a pause instead of a slow fill", () => {
    expect(synthesizeWordTimings("oh", 0, 30000)[0]!.endTime).toBeLessThanOrEqual(650);
  });

  it("gives the last line a natural length without a next line", () => {
    const words = synthesizeWordTimings("goodbye my love", 5000, null);
    const sung = words[words.length - 1]!.endTime - words[0]!.startTime;
    expect(sung).toBeGreaterThanOrEqual(600);
    expect(sung).toBeLessThanOrEqual(2000);
  });

  it("gives blank lines no words", () => {
    expect(synthesizeWordTimings("   ", 0, 1000)).toEqual([]);
  });

  it("fills Chinese without spaces per character, punctuation attached", () => {
    expect(lyricTokens("我爱你，")).toEqual(["我", "爱", "你，"]);
  });

  it("counts syllables from vowel groups, accents ignored", () => {
    expect(syllableWeight("beautiful")).toBe(3);
    expect(syllableWeight("corazón")).toBe(3);
    expect(syllableWeight("!")).toBe(1);
  });

  it("counts about a syllable per three letters in scripts without Latin vowels", () => {
    expect(syllableWeight("حبيبي")).toBe(2);
  });

  it("finds word ranges in order, repeated words in their own place", () => {
    const words = [
      { text: "la", startTime: 0, endTime: 1 },
      { text: "la", startTime: 1, endTime: 2 },
      { text: "land", startTime: 2, endTime: 3 },
    ];
    expect(wordCharRanges("la la land", words, false)).toEqual([
      [0, 1],
      [3, 4],
      [6, 9],
    ]);
  });

  it("matches background words without their stripped parentheses", () => {
    const words = [
      { text: "(ooh", startTime: 0, endTime: 1 },
      { text: "yeah)", startTime: 1, endTime: 2 },
    ];
    expect(wordCharRanges("ooh yeah", words, true)).toEqual([
      [0, 2],
      [4, 7],
    ]);
  });

  it("gives a word missing from the text no range without stopping the rest", () => {
    const words = [
      { text: "hello", startTime: 0, endTime: 1 },
      { text: "xyz", startTime: 1, endTime: 2 },
      { text: "world", startTime: 2, endTime: 3 },
    ];
    expect(wordCharRanges("hello world", words, false)).toEqual([[0, 4], null, [6, 10]]);
  });

  it("springs the word lift past its rest and settles", () => {
    expect(wordLiftProgress(0)).toBe(0);
    let peak = 0;
    for (let t = 50; t <= 400; t += 10) peak = Math.max(peak, wordLiftProgress(t));
    expect(peak).toBeGreaterThan(1);
    expect(Math.abs(wordLiftProgress(2000) - 1)).toBeLessThan(0.01);
  });

  it("meets row cells halfway between their ink, the outer ones reaching past the row", () => {
    expect(rowCellBounds([10, 60, 90], [50, 80, 120], 200)).toEqual([-200, 55, 55, 85, 85, 400]);
  });

  it("cuts overlapping word timings at the next word and gives empty ones a moment", () => {
    const words = sanitizeWordTimestamps([
      { text: "a", startTime: 0, endTime: 900 },
      { text: "b", startTime: 500, endTime: 500 },
    ]);
    expect(words).toEqual([
      { text: "a", startTime: 0, endTime: 500 },
      { text: "b", startTime: 500, endTime: 580 },
    ]);
  });

  it("splits a hyphenated last word into timed syllables", () => {
    const words = splitTrailingHyphenWord([
      { text: "sing", startTime: 0, endTime: 500 },
      { text: "la-la-la", startTime: 500, endTime: 1400 },
    ]);
    expect(words.map((w) => [w.text, w.startTime, w.endTime])).toEqual([
      ["sing", 0, 500],
      ["la-", 500, 800],
      ["la-", 800, 1100],
      ["la", 1100, 1400],
    ]);
  });
});
