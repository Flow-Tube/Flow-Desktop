import { describe, expect, it } from "vitest";

import { MIN_SCORE, best, cleanArtist, cleanTitle, sameVersion, score, versionTags, type MatchSong } from "./matching";

const song = (title: string, artist: string, durationSec: number): MatchSong => ({ title, artist, durationSec });

describe("lyrics matching", () => {
  it("keeps version tags and drops credits and packaging from the search", () => {
    expect(cleanTitle("Song (Live)")).toBe("Song (Live)");
    expect(cleanTitle("Song (Acoustic Version) [Official Video]")).toBe("Song (Acoustic Version)");
    expect(cleanTitle("Song (feat. Someone)")).toBe("Song");
    expect(cleanTitle("Song feat. Someone")).toBe("Song");
    expect(cleanTitle("Song - Official Music Video")).toBe("Song");
    expect(cleanTitle("Video Killed the Radio Star")).toBe("Video Killed the Radio Star");
    expect(cleanTitle("Video Games")).toBe("Video Games");
  });

  it("falls back to the raw title when cleaning leaves nothing", () => {
    expect(cleanTitle("[Official Video]")).toBe("[Official Video]");
    expect(cleanTitle("[Untitled]")).toBe("[Untitled]");
  });

  it("searches the first credited artist", () => {
    expect(cleanArtist("The Weeknd - Topic")).toBe("The Weeknd");
    expect(cleanArtist("Calvin Harris feat. Dua Lipa")).toBe("Calvin Harris");
    expect(cleanArtist("Simon & Garfunkel")).toBe("Simon");
  });

  it("reads version tags from brackets and a trailing dash part, as whole words", () => {
    expect([...versionTags("Song (Live at Wembley)")]).toEqual(["live"]);
    expect([...versionTags("Song - Acoustic")]).toEqual(["acoustic"]);
    expect([...versionTags("Song (Sped Up)")]).toEqual(["sped"]);
    expect(versionTags("Song (2011 Remaster)").size).toBe(0);
    expect(versionTags("Stayin' Alive").size).toBe(0);
    expect(versionTags("Song (Alive Edit)").size).toBe(0);
  });

  it("never gives a live request the studio cut, or the other way round", () => {
    expect(sameVersion("Song (Live)", "Song")).toBe(false);
    expect(sameVersion("Song", "Song (Remix)")).toBe(false);
    expect(sameVersion("Song (Live)", "Song (Live at Wembley)")).toBe(true);
    expect(sameVersion("Song", "Song (2011 Remaster)")).toBe(true);
  });

  it("passes an exact title and artist, and needs a close duration for a fuzzy title", () => {
    const request = song("Blinding Lights", "The Weeknd", 200);
    expect(score(request, song("Blinding Lights", "The Weeknd", 0))).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(score(request, song("Blinding Lights Tonight", "The Weeknd", 0))).toBeLessThan(MIN_SCORE);
    expect(score(request, song("Blinding Lights", "Someone Else", 260))).toBeLessThan(MIN_SCORE);
  });

  it("does not accept a match on duration alone", () => {
    expect(score(song("Song", "Band", 200), song("Other", "Someone", 200))).toBe(0);
  });

  it("counts a featured artist as the artist", () => {
    const request = song("Starboy", "The Weeknd", 230);
    expect(score(request, song("Starboy", "The Weeknd & Daft Punk", 230))).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it("picks the same version, then the highest score, then preferred, then the closest duration", () => {
    const request = song("Song (Live)", "Band", 240);
    const candidates = [
      song("Song", "Band", 240),
      song("Song (Live)", "Band", 250),
      song("Song (Live)", "Band", 241),
      song("Song (Live)", "Other", 240),
    ];
    expect(best(candidates, request, (c) => c)).toBe(candidates[2]);
  });

  it("lets a preferred candidate win a tie", () => {
    const request = song("Song", "Band", 0);
    const candidates: Array<[MatchSong, boolean]> = [
      [song("Song", "Band", 200), false],
      [song("Song", "Band", 201), true],
    ];
    expect(best(candidates, request, (c) => c[0], (c) => c[1])).toBe(candidates[1]);
  });

  it("picks nothing when no candidate clears the floor", () => {
    expect(best([song("Other", "Band", 200)], song("Song", "Band", 200), (c) => c)).toBeNull();
  });
});
