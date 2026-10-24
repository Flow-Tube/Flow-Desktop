import { beforeEach, describe, expect, it, vi } from "vitest";

const player = vi.hoisted(() => ({
  currentTrack: null as unknown,
  togglePlay: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
}));

vi.mock("../store/useMusicPlayerStore", () => ({
  useMusicPlayerStore: Object.assign(() => undefined, { getState: () => player }),
}));

import { runTrayAction, trayNowPlaying } from "./useMusicTray";
import type { SongItem } from "../types/music";

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

describe("music tray", () => {
  beforeEach(() => {
    player.currentTrack = null;
    vi.clearAllMocks();
  });

  it("titles the tray with the song and its artists", () => {
    expect(trayNowPlaying(song(["A", "B"]), "Nothing")).toBe("Song · A, B");
    expect(trayNowPlaying(song([]), "Nothing")).toBe("Song");
    expect(trayNowPlaying(null, "Nothing")).toBe("Nothing");
  });

  it("sends each tray action to the music player", () => {
    player.currentTrack = song(["A"]);
    runTrayAction("toggle");
    runTrayAction("next");
    runTrayAction("previous");
    expect(player.togglePlay).toHaveBeenCalledOnce();
    expect(player.next).toHaveBeenCalledOnce();
    expect(player.previous).toHaveBeenCalledOnce();
  });

  it("ignores tray clicks with nothing loaded", () => {
    runTrayAction("toggle");
    expect(player.togglePlay).not.toHaveBeenCalled();
  });
});
