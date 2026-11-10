import { describe, expect, it } from "vitest";

import {
  decodePlaylistFile,
  encodePlaylistFile,
  fileEntryToSong,
  fileEntryToVideo,
  playlistFileName,
  songToFileEntry,
  videoToFileEntry,
} from "./playlistFile";
import type { SongItem } from "../types/music";

const ID = "dQw4w9WgXcQ";
const ID2 = "aaaaaaaaaaa";

// As Flow for Android writes one: encodeDefaults = false, so empty fields are absent.
const androidFile = JSON.stringify({
  format: "flow-playlist",
  version: 1,
  exportedAt: 1_700_000_000_000,
  playlist: { name: "From the phone", description: "Notes" },
  videos: [
    { id: ID, title: "Song", channelName: "Rick", thumbnailUrl: `https://i.ytimg.com/vi/${ID}/maxres.jpg`, durationSeconds: 212, viewCount: 5, uploadDate: "3 weeks ago", publishedAt: 1_600, addedAt: 1_700 },
    { id: ID2 },
    { id: "device-file-id" },
    { id: ID },
  ],
  somethingNew: true,
});

describe("decodePlaylistFile", () => {
  it("reads a file from Android, keeping good ids once each", () => {
    const read = decodePlaylistFile(androidFile);
    if (read.kind !== "read") throw new Error(read.kind);
    expect(read.file.name).toBe("From the phone");
    expect(read.file.description).toBe("Notes");
    expect(read.file.isMusic).toBe(false);
    expect(read.file.videos.map((video) => video.id)).toEqual([ID, ID2]);
    expect(read.file.videos[0]?.addedAt).toBe(1_700);
    expect(read.file.videos[1]?.addedAt).toBeNull();
  });

  it("refuses what isn't a playlist", () => {
    expect(decodePlaylistFile("not json").kind).toBe("notAPlaylist");
    expect(decodePlaylistFile("[]").kind).toBe("notAPlaylist");
    expect(decodePlaylistFile(JSON.stringify({ format: "other", version: 1, playlist: { name: "x" }, videos: [] })).kind).toBe("notAPlaylist");
    expect(decodePlaylistFile(JSON.stringify({ format: "flow-playlist", version: 1, videos: [] })).kind).toBe("notAPlaylist");
    expect(decodePlaylistFile(JSON.stringify({ format: "flow-playlist", version: 1, playlist: { name: "x" }, videos: [{ title: "no id" }] })).kind).toBe("notAPlaylist");
  });

  it("says when a newer Flow wrote it", () => {
    expect(decodePlaylistFile(JSON.stringify({ format: "flow-playlist", version: 2, playlist: { name: "x" }, videos: [] })).kind).toBe("tooNew");
  });
});

describe("encodePlaylistFile", () => {
  it("writes the shape Android reads, without empty fields", () => {
    const parsed = JSON.parse(encodePlaylistFile({
      name: "Mine",
      description: "",
      isMusic: false,
      videos: [videoToFileEntry({ id: ID, title: "T", channelName: "C", viewCountText: "1.5K views", durationSeconds: 10, addedAtInPlaylist: 9 }), { id: "bad" }],
    }, 123));
    expect(parsed).toEqual({
      format: "flow-playlist",
      version: 1,
      exportedAt: 123,
      playlist: { name: "Mine" },
      videos: [{ id: ID, title: "T", channelName: "C", durationSeconds: 10, viewCount: 1500, addedAt: 9 }],
    });
  });

  it("writes a whole view count, since Android reads it as a Long", () => {
    const entry = videoToFileEntry({ id: ID, title: "T", channelName: "C", viewCountText: "4.1M views" });
    expect(entry.viewCount).toBe(4_100_000);
    expect(Number.isInteger(videoToFileEntry({ id: ID, title: "T", channelName: "C", viewCount: 12.5 }).viewCount)).toBe(true);
  });

  it("round trips a music playlist", () => {
    const song: SongItem = {
      id: "x", videoId: ID, title: "Song", artists: [{ name: "A", id: "UC1" }, { name: "B", id: null }], album: null,
      duration: 200, musicVideoType: null, thumbnail: "https://lh3.googleusercontent.com/a", explicit: false, playlistId: null, params: null,
    };
    const read = decodePlaylistFile(encodePlaylistFile({ name: "Mix", description: "", isMusic: true, videos: [songToFileEntry(song)] }, 1));
    if (read.kind !== "read") throw new Error(read.kind);
    expect(read.file.isMusic).toBe(true);
    const back = fileEntryToSong(read.file.videos[0]!);
    expect(back).toMatchObject({ id: ID, videoId: ID, title: "Song", duration: 200, thumbnail: song.thumbnail, artists: [{ name: "A, B", id: "UC1" }] });
  });
});

describe("pictures from a file", () => {
  it("loads only YouTube's hosts, falling back to the video's own thumbnail", () => {
    const tracked = fileEntryToVideo({ id: ID, thumbnailUrl: "https://evil.example/pixel.gif", channelThumbnailUrl: "http://yt3.ggpht.com/a" });
    expect(tracked.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    expect(tracked.channelAvatarUrl).toBeNull();
    expect(fileEntryToVideo({ id: ID, channelThumbnailUrl: "https://yt3.ggpht.com/a" }).channelAvatarUrl).toBe("https://yt3.ggpht.com/a");
    expect(fileEntryToVideo({ id: ID, thumbnailUrl: "https://ytimg.com.evil.example/a" }).thumbnailUrl).toContain("i.ytimg.com");
  });
});

describe("playlistFileName", () => {
  it("makes a name every file system accepts", () => {
    expect(playlistFileName('a/b:c*?"<>|')).toBe("a_b_c______.json");
    expect(playlistFileName("   ")).toBe("flow-playlist.json");
    expect(playlistFileName("x".repeat(200))).toBe(`${"x".repeat(80)}.json`);
  });
});
