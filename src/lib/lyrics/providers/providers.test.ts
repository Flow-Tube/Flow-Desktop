import { describe, expect, it } from "vitest";

import { convertLyricsPlus } from "./lyricsPlus";
import { pickSearchHit } from "./lrclib";
import { bestLyric, matchingRows, normalizeKuGouLrc } from "./kugou";
import { closestRow } from "./simpMusic";
import { matchAppleSongs, parseItunesSearch } from "./paxsenix";
import { isUncachedMiss } from "./betterLyrics";
import { parseNetEaseLyric } from "./netease";
import { pickAmllItem } from "./amll";
import { lrcOffsetMs, parseOfflineLyrics } from "../offline";
import { isInstrumentalNotice, parseLyrics } from "../lyricsUtils";

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

  it("accepts any credited artist and drops hits far from the song's length", () => {
    const hits = [
      { trackName: "Song", artistName: "Arijit Singh, Shilpa Rao", duration: 260, syncedLyrics: "[00:01.00]x" },
      { trackName: "Song", artistName: "Arijit Singh, Shilpa Rao", duration: 205, syncedLyrics: "[00:01.00]y" },
    ];
    expect(pickSearchHit(hits, "Song", "Vishal & Shekhar, Arijit Singh, Shilpa Rao", 200)).toBe(hits[1]);
  });
});

describe("SimpMusic", () => {
  it("never uses a row far from the song's length, and lets votes break ties", () => {
    const rows = [
      { syncedLyrics: "far", durationSeconds: 260, vote: 9 },
      { syncedLyrics: "low", durationSeconds: 201, vote: 1 },
      { syncedLyrics: "high", duration: 201, vote: 5 },
    ];
    expect(closestRow(rows, 200)?.syncedLyrics).toBe("high");
    expect(closestRow(rows.slice(0, 1), 200)).toBeNull();
    expect(closestRow(rows, 0)?.syncedLyrics).toBe("far");
  });
});

describe("KuGou", () => {
  it("keeps only song rows naming the song, close in length", () => {
    const request = { title: "晴天", artist: "周杰伦", durationSec: 269 };
    const rows = [
      { songname: "晴天 (Live)", singername: "周杰伦", duration: 270, hash: "a" },
      { songname: "晴天", singername: "周杰伦", duration: 269, hash: "b" },
      { songname: "晴天", singername: "周杰伦", duration: 300, hash: "c" },
      { songname: "", singername: "", duration: 269, hash: "d" },
    ];
    expect(matchingRows(rows, request).map((row) => row.hash)).toEqual(["b"]);
  });

  it("checks each lyric on its own names, reading milliseconds and seconds alike", () => {
    const request = { title: "Song", artist: "Band", durationSec: 200 };
    const other = { id: 1, accesskey: "k", song: "Other", singer: "Band", duration: 200_000 };
    const same = { id: 2, accesskey: "k", song: "Song", singer: "Band", duration: 201 };
    expect(bestLyric([other, same], request)).toBe(same);
    expect(bestLyric([other], request)).toBeNull();
  });

  it("drops untimed lines and the credit block at the head", () => {
    const lrc = ["[00:00.00]Song - Singer", "[00:01.00]作词：Someone", "plain", "[00:10.00]First", "[00:20.00]Second"].join("\n");
    expect(normalizeKuGouLrc(lrc)).toBe("[00:10.00]First\n[00:20.00]Second");
  });

  it("reads the instrumental notice as no lyrics, but not lyrics that contain it", () => {
    const notice = ["\uFEFF[id:$00000000]", "[ar:arkady sevidov]", "[ti:June]", "[total:320317]", "[00:01.58]纯音乐，请欣赏"].join("\n");
    expect(isInstrumentalNotice(parseLyrics(normalizeKuGouLrc(notice)))).toBe(true);
    expect(isInstrumentalNotice(parseLyrics("[00:01.58]纯音乐,请欣赏"))).toBe(true);
    expect(isInstrumentalNotice(parseLyrics("[00:01.00]纯音乐，请欣赏\n[00:05.00]First"))).toBe(false);
    expect(isInstrumentalNotice([])).toBe(false);
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

describe("NetEase", () => {
  const six = Array.from({ length: 6 }, (_, i) => `[00:${String(10 + i)}.00]Line ${i}`).join("\n");

  it("reads its odd stamps and drops the credit lines", () => {
    const entries = parseNetEaseLyric(`[00:00.00-1] 作词 : Someone\n[00:01.00] 作曲 : Other\n[00:02.00-1]Real\n${six}`);
    expect(entries.map((entry) => entry.text)).toEqual(["Real", ...Array.from({ length: 6 }, (_, i) => `Line ${i}`)]);
    expect(entries[0]!.time).toBe(2000);
  });

  it("takes a song holding little more than its credits as no lyric", () => {
    expect(parseNetEaseLyric("[00:00.00] 作词 : Someone\n[00:01.00] written by : Other\n[00:02.00]Only line")).toEqual([]);
  });
});

describe("AMLL", () => {
  const request = { title: "Other Name", artist: "Band", durationSec: 200 };

  it("matches a song under any of its names", () => {
    const item = { id: 7, musicNames: ["First Name", "Other Name"], artistNames: ["Band"] };
    expect(pickAmllItem([item], request)?.id).toBe(7);
  });

  it("leaves another song alone", () => {
    const item = { id: 8, musicNames: ["Something Else"], artistNames: ["Someone"] };
    expect(pickAmllItem([item], request)).toBeNull();
  });
});
