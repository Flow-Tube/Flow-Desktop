import { describe, expect, it } from "vitest";

import { trayNowPlaying, videoToResume } from "./useMusicTray";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

const song = (artists: string[]): SongItem => ({
  id: "s1",
  title: "Song",
  artists: artists.map((name) => ({ name, id: null })),
  album: null,
  duration: 200,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  videoId: "s1",
  playlistId: null,
  params: null,
});

const video = (id: string, channelName = "Channel") => ({ id, title: `Video ${id}`, channelName }) as VideoSummary;

describe("tray", () => {
  it("titles the tray with the song and its artists", () => {
    expect(trayNowPlaying(song(["A", "B"]), null, "Nothing")).toBe("Song · A, B");
    expect(trayNowPlaying(song([]), null, "Nothing")).toBe("Song");
    expect(trayNowPlaying(null, null, "Nothing")).toBe("Nothing");
  });

  it("titles the tray with the video and its channel", () => {
    expect(trayNowPlaying(null, video("a"), "Nothing")).toBe("Video a · Channel");
    expect(trayNowPlaying(null, video("a", ""), "Nothing")).toBe("Video a");
  });

  it("offers the newest video that isn't already in the player", () => {
    expect(videoToResume([video("a"), video("b")], null)?.id).toBe("a");
    expect(videoToResume([video("a"), video("b")], video("a"))?.id).toBe("b");
    expect(videoToResume([video("a")], video("a"))).toBeNull();
    expect(videoToResume([], null)).toBeNull();
  });
});
