import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMusicPlayerStore } from "./useMusicPlayerStore";
import { usePlayerStore } from "./usePlayerStore";
import { useRemoteControlStore } from "./useRemoteControlStore";
import type { SongItem } from "../types/music";

const song = (id: string): SongItem => ({
  id,
  title: id,
  artists: [],
  album: null,
  duration: 200,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const command = vi.fn();
const play = vi.fn();

beforeEach(() => {
  useRemoteControlStore.setState({ target: "phone", queue: ["a", "b"], index: 0, playing: true, command, play });
});

afterEach(() => {
  vi.clearAllMocks();
  useRemoteControlStore.setState({ target: null });
});

describe("while another device is controlled", () => {
  it("sends a chosen queue of songs there instead of playing it here", async () => {
    await useMusicPlayerStore.getState().playQueue([song("x"), song("y")], 1);
    expect(play).toHaveBeenCalledWith(["x", "y"], 1, true);
    expect(useMusicPlayerStore.getState().currentTrack).toBeNull();
  });

  it("sends a chosen video there", () => {
    usePlayerStore.getState().setQueue([{ id: "v", title: "", channelName: "" }], 0);
    expect(play).toHaveBeenCalledWith(["v"], 0, false);
    expect(usePlayerStore.getState().currentVideo).toBeNull();
  });

  it("drives play, pause, next, seek and volume there", () => {
    const music = useMusicPlayerStore.getState();
    music.togglePlay();
    music.next();
    music.seek(30);
    music.setVolume(0.5);
    expect(command.mock.calls).toEqual([["pause"], ["next"], ["seek", { pos: 30_000 }], ["volume", { vol: 50 }]]);
  });

  it("adds to its queue, after what it plays or at the end", () => {
    useMusicPlayerStore.getState().playNextInQueue(song("n"));
    useMusicPlayerStore.getState().addToQueue(song("e"));
    expect(command).toHaveBeenCalledWith("queue", { queue: ["a", "n", "b"] });
    expect(command).toHaveBeenCalledWith("queue", { queue: ["a", "b", "e"] });
  });
});
