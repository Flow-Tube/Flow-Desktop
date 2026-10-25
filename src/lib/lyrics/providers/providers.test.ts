import { describe, expect, it } from "vitest";

import { convertLyricsPlus } from "./lyricsPlus";
import { pickSearchHit } from "./lrclib";
import { matchKuGou, normalizeKuGouLrc } from "./kugou";
import { matchAppleSongs, parseItunesSearch } from "./paxsenix";
import { isUncachedMiss } from "./betterLyrics";
import { lrcOffsetMs, parseOfflineLyrics } from "../offline";

describe("BetterLyrics", () => {
  it("reads an uncached 401 as a miss for this song only", () => {
    expect(isUncachedMiss(401, '{"error":"Uncached queries require a valid API key"}')).toBe(true);
    expect(isUncachedMiss(401, '{"error":"Invalid key"}')).toBe(false);
    expect(isUncachedMiss(403, "Uncached")).toBe(false);
  });
});

describe("LyricsPlus", () => {
  it("splits background syllables into their own line after the main one", () => {
    const entries = convertLyricsPlus({
      type: "Word",
      lyrics: [
        {
          time: 1000,
          duration: 2000,
          text: "Hello (ooh)",
          syllabus: [
            { time: 1000, duration: 400, text: "Hel" },
            { time: 1400, duration: 400, text: "lo " },
            { time: 1900, duration: 600, text: "(ooh)", isBackground: true },
          ],
          element: { singer: "v1" },
        },
      ],
    });
    expect(entries.map((e) => [e.text, !!e.isBackground, e.time])).toEqual([
      ["Hello", false, 1000],
      ["(ooh)", true, 1900],
    ]);
    expect(entries[0]?.agent).toBe("v1");
    expect(entries[1]?.words?.[0]?.startTime).toBe(1900);
  });

  it("keeps line-synced answers free of syllable timings", () => {
    const entries = convertLyricsPlus({
      type: "Line",
      lyrics: [{ time: 1000, duration: 2000, text: "Hello", syllabus: [{ time: 1000, duration: 400, text: "Hello" }] }],
    });
    expect(entries[0]?.words).toBeNull();
  });
});

describe("LrcLib", () => {
  it("takes the search hit for the same song, synced first, never just any result", () => {
    const hits = [
      { trackName: "Other", artistName: "Band", duration: 200, syncedLyrics: "[00:01.00]x" },
      { trackName: "Song", artistName: "Band", duration: 201, plainLyrics: "x" },
      { trackName: "Song", artistName: "Band", duration: 202, syncedLyrics: "[00:01.00]x" },
    ];
    expect(pickSearchHit(hits, "Song", "Band", 200)).toBe(hits[2]);
    expect(pickSearchHit(hits.slice(0, 1), "Song", "Band", 200)).toBeNull();
  });
});

describe("KuGou", () => {
  it("matches named songs and falls back to the duration when names are missing", () => {
    const request = { title: "晴天", artist: "周杰伦", durationSec: 269 };
    const named = [
      { title: "晴天 (Live)", artist: "周杰伦", durationSec: 270 },
      { title: "晴天", artist: "周杰伦", durationSec: 269 },
    ];
    expect(matchKuGou(named, request, (s) => s)).toEqual([named[1]]);
    const unnamed = [
      { title: "", artist: "", durationSec: 100 },
      { title: "", artist: "", durationSec: 272 },
    ];
    expect(matchKuGou(unnamed, request, (s) => s)).toEqual([unnamed[1]]);
  });

  it("drops untimed lines and the credit block at the head", () => {
    const lrc = ["[00:00.00]Song - Singer", "[00:01.00]作词：Someone", "plain", "[00:10.00]First", "[00:20.00]Second"].join("\n");
    expect(normalizeKuGouLrc(lrc)).toBe("[00:10.00]First\n[00:20.00]Second");
  });
});

describe("Paxsenix", () => {
  it("reads the iTunes search into Apple Music ids and seconds", () => {
    const songs = parseItunesSearch(
      '{"resultCount":2,"results":[{"trackId":1488408568,"trackName":"Blinding Lights","artistName":"The Weeknd","trackTimeMillis":200040},{"trackId":0,"trackName":"No id"}]}',
    );
    expect(songs).toEqual([{ id: "1488408568", name: "Blinding Lights", artist: "The Weeknd", durationSec: 200 }]);
  });

  it("does not accept a song on its duration alone", () => {
    const songs = [{ id: "1", name: "Different", artist: "Someone", durationSec: 200 }];
    expect(matchAppleSongs(songs, "Song", "Band", 200)).toEqual([]);
  });

  it("keeps a remix away from a request for the original", () => {
    const songs = [
      { id: "1", name: "Song (Remix)", artist: "Band", durationSec: 200 },
      { id: "2", name: "Song", artist: "Band", durationSec: 230 },
    ];
    expect(matchAppleSongs(songs, "Song", "Band", 200).map((s) => s.id)).toEqual(["2"]);
  });
});

describe("offline lyrics", () => {
  it("parses an LRC file into timed lines", () => {
    expect(parseOfflineLyrics("[00:12.34]Hello\n[00:20.00]World").map((e) => [e.time, e.text])).toEqual([
      [12340, "Hello"],
      [20000, "World"],
    ]);
  });

  it("reads the offset tag in milliseconds", () => {
    expect(lrcOffsetMs("[ti:Song]\n[offset:+350]\n[00:01.00]Line")).toBe(350);
    expect(lrcOffsetMs("[offset: -120]")).toBe(-120);
    expect(lrcOffsetMs("[00:01.00]Line")).toBe(0);
  });

  it("drops header tags from plain lyrics", () => {
    expect(parseOfflineLyrics("[ar:Artist]\n[ti:Song]\nFirst line\nSecond line\n").map((e) => e.text)).toEqual([
      "First line",
      "Second line",
    ]);
  });

  it("keeps plain text as untimed lines", () => {
    expect(parseOfflineLyrics("Hello\n\nWorld").map((e) => [e.time, e.text])).toEqual([
      [0, "Hello"],
      [0, "World"],
    ]);
  });
});
