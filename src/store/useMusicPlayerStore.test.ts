import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SongItem } from "../types/music";

const song = (id: string): SongItem => ({
  id,
  title: `Song ${id}`,
  artists: [],
  album: null,
  duration: 200,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const { getMusicWatchQueue } = vi.hoisted(() => ({ getMusicWatchQueue: vi.fn() }));

vi.mock("../lib/api/music", () => ({
  getMusicWatchQueue,
  getMusicQueueContinuation: vi.fn(),
  rankMusicCandidates: (items: SongItem[]) => Promise.resolve(items),
}));

import { useMusicPlayerStore } from "./useMusicPlayerStore";

beforeEach(() => {
  getMusicWatchQueue.mockResolvedValue({
    items: [song("r1"), song("r2"), song("r3")],
    continuation: null,
    radioPlaylistId: null,
  });
  useMusicPlayerStore.setState({ radioEnabled: false, isShuffle: false, _loadIndex: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("start radio", () => {
  it("extends the station without switching the radio setting on", async () => {
    await useMusicPlayerStore.getState().startRadio(song("seed"));
    await useMusicPlayerStore.getState()._ensureRadio();

    const state = useMusicPlayerStore.getState();
    expect(state.radioEnabled).toBe(false);
    expect(state.queue.map((t) => t.id)).toEqual(["seed", "r1", "r2", "r3"]);
  });

  it("stops extending when the radio switch is turned off", async () => {
    useMusicPlayerStore.setState({ radioEnabled: true });
    await useMusicPlayerStore.getState().startRadio(song("seed"));
    useMusicPlayerStore.getState().toggleRadio();
    await useMusicPlayerStore.getState()._ensureRadio();

    expect(getMusicWatchQueue).not.toHaveBeenCalled();
    expect(useMusicPlayerStore.getState().queue.map((t) => t.id)).toEqual(["seed"]);
  });

  it("ends with the next queue the user plays", async () => {
    await useMusicPlayerStore.getState().startRadio(song("seed"));
    await useMusicPlayerStore.getState().playQueue([song("a"), song("b")]);
    await useMusicPlayerStore.getState()._ensureRadio();

    expect(getMusicWatchQueue).not.toHaveBeenCalled();
    expect(useMusicPlayerStore.getState().queue.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
