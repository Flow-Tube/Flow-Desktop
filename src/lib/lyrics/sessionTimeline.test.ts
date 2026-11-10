import { describe, expect, it } from "vitest";

import type { LyricsEntry, WordTimestamp } from "./types";
import { MEDIA_LYRICS_DELAY, MediaLyricTimeline, mediaLyricArtist } from "./sessionTimeline";

const timeline = (entries: LyricsEntry[], offsetMs: number) =>
  new MediaLyricTimeline(entries, offsetMs, (line, count) => `${line} (x${count})`);
const line = (time: number, text: string, extra: Partial<LyricsEntry> = {}): LyricsEntry => ({ time, text, ...extra });

const entries = [
  line(5_000, "First line"),
  line(7_000, "Backing", { isBackground: true }),
  line(10_000, "Second line"),
  line(20_000, ""),
  line(30_000, "♪"),
  line(40_000, "Last line"),
];
const longLine = "You can turn me on with just a touch, baby";

describe("lyrics in the media controls", () => {
  it("keeps the song name in view on the artist line", () => {
    expect(mediaLyricArtist("The Feels", "TWICE")).toBe("The Feels - TWICE");
    expect(mediaLyricArtist("The Feels", null)).toBe("The Feels");
    expect(mediaLyricArtist("The Feels", "")).toBe("The Feels");
  });

  it("snaps the timing setting to its steps and keeps it in range", () => {
    expect(MEDIA_LYRICS_DELAY.snap(-790)).toBe(-800);
    expect(MEDIA_LYRICS_DELAY.snap(90)).toBe(0);
    expect(MEDIA_LYRICS_DELAY.snap(110)).toBe(200);
    expect(MEDIA_LYRICS_DELAY.snap(-9_000)).toBe(-2_000);
    expect(MEDIA_LYRICS_DELAY.snap(9_000)).toBe(2_000);
  });

  it("shows a line early with a negative delay and late with a positive one", () => {
    const early = timeline(entries, 800);
    const late = timeline(entries, -800);
    expect(early.lineAt(4_200)).toBe("First line");
    expect(early.nextChangeAfter(4_200)).toBe(9_200);
    expect(late.lineAt(5_500)).toBe("♪♪");
    expect(late.lineAt(5_800)).toBe("First line");
    expect(late.nextChangeAfter(5_800)).toBe(10_800);
  });

  it("shows nothing before the first line after a short intro, and notes through a long one", () => {
    const short = timeline([line(4_000, "First line")], 0);
    expect(short.lineAt(3_999)).toBeNull();
    expect(short.nextChangeAfter(0)).toBe(4_000);
    const long = timeline(entries, 0);
    expect(long.lineAt(0)).toBe("♪");
    expect(long.lineAt(3_000)).toBe("♪♪");
    expect(long.nextChangeAfter(3_000)).toBe(5_000);
  });

  it("keeps a line until the next and skips background vocals", () => {
    const t = timeline(entries, 0);
    expect(t.lineAt(5_000)).toBe("First line");
    expect(t.lineAt(9_999)).toBe("First line");
    expect(t.nextChangeAfter(5_000)).toBe(10_000);
  });

  it("turns blank and symbol lines into one break of repeating music notes", () => {
    const t = timeline([line(0, "Sung"), line(1_000, ""), line(5_000, "♪"), line(12_000, "Next")], 0);
    expect(t.lineAt(1_000)).toBe("♪");
    expect(t.lineAt(4_000)).toBe("♪♪");
    expect(t.lineAt(7_000)).toBe("♪♪♪");
    expect(t.lineAt(10_000)).toBe("♪");
    expect(t.nextChangeAfter(10_000)).toBe(12_000);
    expect(t.lineAt(12_000)).toBe("Next");
  });

  it("takes a long unmarked silence after a sung line for a break, but not a short one", () => {
    const long = timeline([line(0, "Twenty characters ok"), line(10_000, "Next")], 0);
    expect(long.lineAt(1_999)).toBe("Twenty characters ok");
    expect(long.nextChangeAfter(0)).toBe(2_000);
    expect(long.lineAt(2_000)).toBe("♪");
    expect(timeline([line(0, "Twenty characters ok"), line(6_999, "Next")], 0).lineAt(6_998)).toBe("Twenty characters ok");
  });

  it("lets timed words decide when a line ends", () => {
    const words: WordTimestamp[] = [
      { text: "Long", startTime: 0, endTime: 6_000 },
      { text: "note", startTime: 6_000, endTime: 8_000 },
    ];
    const t = timeline([line(0, "Long note", { words }), line(14_000, "Next")], 0);
    expect(t.lineAt(7_999)).toBe("Long note");
    expect(t.lineAt(8_000)).toBe("♪");
  });

  it("says how many times a line has been sung in a row", () => {
    const t = timeline([line(0, "Hold on"), line(2_000, "hold on "), line(4_000, "Hold on"), line(6_000, "Let go"), line(8_000, "Hold on")], 0);
    expect(t.lineAt(0)).toBe("Hold on");
    expect(t.lineAt(2_000)).toBe("hold on (x2)");
    expect(t.lineAt(4_000)).toBe("Hold on (x3)");
    expect(t.lineAt(6_000)).toBe("Let go");
    expect(t.lineAt(8_000)).toBe("Hold on");
  });

  it("counts a line sung again with more words after it as a repeat", () => {
    const t = timeline(
      [line(18_880, "तद मैं कमली कहलावांगी"), line(25_010, "तद मैं कमली कहलावांगी (माहिया माहिया)"), line(51_080, "मेरे माहिया सनम जानम")],
      0,
    );
    expect(t.lineAt(19_000)).toBe("तद मैं कमली कहलावांगी");
    expect(t.lineAt(25_100)).toBe("तद मैं कमली कहलावांगी (x2)");
    expect(t.lineAt(27_500)).toBe("(माहिया माहिया)");
  });

  it("tells vowel signs apart, ignores punctuation, and restarts the count after a blank line", () => {
    expect(timeline([line(1_000, "कमल"), line(2_000, "कमली"), line(3_000, "end")], 0).lineAt(2_100)).toBe("कमली");
    expect(timeline([line(1_000, "Hold on,"), line(2_000, "hold on!"), line(3_000, "end")], 0).lineAt(2_100)).toBe("hold on! (x2)");
    expect(timeline([line(1_000, "Hold on"), line(2_000, ""), line(9_000, "Hold on"), line(9_900, "end")], 0).lineAt(9_100)).toBe("Hold on");
  });

  it("marks only the last part of a repeated long line", () => {
    const t = timeline([line(0, longLine), line(6_000, longLine), line(12_000, "Next")], 0);
    const second = t.nextChangeAfter(6_000)!;
    expect(t.lineAt(6_000)).toBe("You can turn me on with");
    expect(t.lineAt(second)).toBe("just a touch, baby (x2)");
  });

  it("moves lines earlier with the offset and waits in player time", () => {
    const t = timeline(entries, 1_000);
    expect(t.lineAt(4_000)).toBe("First line");
    expect(t.nextChangeAfter(4_000)).toBe(9_000);
  });

  it("keeps the music notes going after the last line", () => {
    const t = timeline(entries, 0);
    expect(t.lineAt(40_899)).toBe("Last line");
    expect(t.lineAt(40_900)).toBe("♪");
    expect(t.nextChangeAfter(41_000)).toBe(43_900);
  });

  it("changes nothing without lyrics", () => {
    expect(timeline([], 0).lineAt(0)).toBeNull();
    expect(timeline([], 0).nextChangeAfter(0)).toBeNull();
  });

  it("keeps a line that fits whole, and splits a long one into balanced parts that cut no word", () => {
    const fits = timeline([line(0, "I'm running out of time"), line(5_000, "Next")], 0);
    expect(fits.lineAt(4_999)).toBe("I'm running out of time");
    expect(fits.nextChangeAfter(0)).toBe(5_000);
    const long = timeline([line(0, longLine), line(6_000, "Next")], 0);
    const second = long.nextChangeAfter(0)!;
    expect(long.lineAt(0)).toBe("You can turn me on with");
    expect(long.lineAt(second)).toBe("just a touch, baby");
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(6_000);
  });

  it("starts the second part when its word is sung, if the words are timed", () => {
    const words = longLine.split(" ").map((text, i) => ({ text, startTime: 200 + i * 300, endTime: 500 + i * 300 }));
    expect(timeline([line(100, longLine, { words }), line(6_000, "Next")], 0).nextChangeAfter(100)).toBe(words[6]!.startTime);
  });

  it("does not stretch parts across a long gap, nor split a line sung too fast to read", () => {
    expect(timeline([line(0, longLine), line(60_000, "Next")], 0).nextChangeAfter(0)!).toBeLessThan(longLine.length * 100);
    const fast = timeline([line(0, longLine), line(1_000, "Next")], 0);
    expect(fast.lineAt(0)).toBe(longLine);
    expect(fast.nextChangeAfter(0)).toBe(1_000);
  });

  it("puts a very long line into more parts and loses no text", () => {
    const text = "Live vicariously through me, write my life like it's a movie, like it's a movie";
    const t = timeline([line(0, text), line(10_000, "Next")], 0);
    const parts = [t.lineAt(0)!];
    let at = t.nextChangeAfter(0)!;
    while (at < 10_000) {
      parts.push(t.lineAt(at)!);
      at = t.nextChangeAfter(at)!;
    }
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.join(" ")).toBe(text);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(24);
  });

  it("counts wide characters for more and still splits a line without spaces", () => {
    const text = "君の名前を何度も呼んでいるこの夜の中で";
    const t = timeline([line(0, text), line(6_000, "Next")], 0);
    const second = t.nextChangeAfter(0)!;
    expect(second).toBeLessThan(6_000);
    expect(t.lineAt(0)! + t.lineAt(second)!).toBe(text);
  });

  it("moves the parts with the offset too", () => {
    const lines = [line(5_000, longLine), line(11_000, "Next")];
    const plain = timeline(lines, 0).nextChangeAfter(5_000)!;
    expect(timeline(lines, 1_000).nextChangeAfter(4_000)).toBe(plain - 1_000);
  });
});
