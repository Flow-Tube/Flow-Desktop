import { describe, expect, it } from "vitest";

import type { SongItem } from "../types/music";
import { isOfficialVideoOf, musicTitleKey, pickOfficialVideo } from "./musicVideoMatching";

const item = (title: string, artist: string, duration: number | null, type = "MUSIC_VIDEO_TYPE_OMV", id: string | null = null): SongItem => ({
  id: title,
  title,
  artists: [{ name: artist, id }],
  album: null,
  duration,
  musicVideoType: type,
  thumbnail: "",
  explicit: false,
  videoId: title,
  playlistId: null,
  params: null,
});

const song = item("Blinding Lights", "The Weeknd", 202, "MUSIC_VIDEO_TYPE_ATV");

describe("musicVideoMatching", () => {
  it("keys titles the same way everywhere", () => {
    expect(musicTitleKey("The Weeknd - Blinding Lights (Official Video)", ["The Weeknd"])).toBe("blinding lights");
    expect(musicTitleKey("Levitating (feat. DaBaby)")).toBe("levitating");
    expect(musicTitleKey("Café del Mar")).toBe("cafe del mar");
  });

  it("takes the artist's official upload of the same song, even when it runs longer", () => {
    expect(isOfficialVideoOf(song, item("The Weeknd - Blinding Lights (Official Video)", "The Weeknd", 263))).toBe(true);
  });

  it("refuses other versions, other artists, audio uploads and implausible lengths", () => {
    expect(isOfficialVideoOf(song, item("Blinding Lights (Live)", "The Weeknd", 210))).toBe(false);
    expect(isOfficialVideoOf(song, item("Blinding Lights", "Someone Else", 202))).toBe(false);
    expect(isOfficialVideoOf(song, item("Blinding Lights", "The Weeknd", 202, "MUSIC_VIDEO_TYPE_UGC"))).toBe(false);
    expect(isOfficialVideoOf(song, item("Blinding Lights (Official Audio)", "The Weeknd", 202))).toBe(false);
    expect(isOfficialVideoOf(song, item("Blinding Lights", "The Weeknd", 600))).toBe(false);
  });

  it("picks the first match", () => {
    const match = item("Blinding Lights", "The Weeknd", 202);
    expect(pickOfficialVideo(song, [item("Blinding Lights (Remix)", "The Weeknd", 200), match])).toBe(match);
  });
});
