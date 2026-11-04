import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SongItem } from "../types/music";

const song = (id: string, artist = `artist-${id}`): SongItem => ({
  id,
  title: `Song ${id}`,
  artists: [{ id: null, name: artist }],
  album: null,
  duration: 200,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const page = (items: SongItem[], continuation: string | null = null) => ({
  items,
  continuation,
  radioPlaylistId: null,
});

const { engine, getMusicWatchQueue, getMusicQueueContinuation } = vi.hoisted(() => ({
  engine: {
    clearPreload: vi.fn(() => null),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    play: vi.fn(async () => {}),
    wantsAac: vi.fn(() => false),
  },
  getMusicWatchQueue: vi.fn(),
  getMusicQueueContinuation: vi.fn(),
}));

vi.mock("../lib/audio/musicAudioEngine", () => ({ musicAudioEngine: engine }));
vi.mock("../lib/musicStreamResolution", () => ({
  resolveMusicStream: vi.fn(),
  prefetchMusicStream: vi.fn(),
  invalidateMusicStream: vi.fn(),
}));
vi.mock("../lib/musicPreload", () => ({ preloadTrack: vi.fn() }));
vi.mock("../lib/useDownloads", () => ({ findDownloadedRecord: () => undefined }));
vi.mock("../lib/api/music", () => ({
  getMusicWatchQueue,
  getMusicQueueContinuation,
  rankMusicCandidates: (items: SongItem[]) => Promise.resolve(items),
}));

import { useMusicPlayerStore } from "./useMusicPlayerStore";

const store = () => useMusicPlayerStore.getState();
const ids = (tracks: SongItem[]) => tracks.map((t) => t.id);
const upNext = () => ids(store().queue.slice(store().currentIndex + 1));
const playing = () => store().queue[store().currentIndex]?.id;
const tenSongs = () => Array.from({ length: 10 }, (_, i) => song(`s${i}`));

beforeEach(() => {
  getMusicWatchQueue.mockResolvedValue(page([]));
  useMusicPlayerStore.setState({
    radioEnabled: false,
    radioStationActive: false,
    isShuffle: false,
    repeatMode: "none",
    progress: 0,
    // The real load needs a media element; here it only moves the playhead.
    _loadIndex: async (index: number) => {
      useMusicPlayerStore.setState({ currentIndex: index, currentTrack: store().queue[index] ?? null });
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("shuffle", () => {
  it("plays every song exactly once and then stops", async () => {
    useMusicPlayerStore.setState({ isShuffle: true });
    await store().playQueue(tenSongs(), 4);
    expect(playing()).toBe("s4");

    const heard = [playing()];
    for (let i = 0; i < 12; i++) {
      store().next();
      await Promise.resolve();
      if (playing() !== heard[heard.length - 1]) heard.push(playing());
    }
    expect(heard).toHaveLength(10);
    expect(new Set(heard).size).toBe(10);
    expect(engine.pause).toHaveBeenCalled();
  });

  it("goes back to the song shuffle played before, and lists what comes next in play order", async () => {
    await store().playQueue(tenSongs(), 0);
    store().toggleShuffle();
    const order = ids(store().queue);
    expect(order[0]).toBe("s0");
    expect(upNext()).toEqual(order.slice(1));

    store().next();
    store().next();
    await Promise.resolve();
    expect(playing()).toBe(order[2]);
    store().previous();
    expect(playing()).toBe(order[1]);
  });

  it("restores the original order when turned off, staying on the same song", async () => {
    await store().playQueue(tenSongs(), 2);
    store().toggleShuffle();
    store().next();
    const now = playing();
    store().toggleShuffle();
    expect(ids(store().queue)).toEqual(ids(tenSongs()));
    expect(playing()).toBe(now);
    expect(store().unshuffledQueue).toBeNull();
  });

  it("plays a Play next song right after the current one, shuffled or not", async () => {
    await store().playQueue(tenSongs(), 0);
    store().toggleShuffle();
    store().playNextInQueue(song("next"));
    expect(upNext()[0]).toBe("next");
    store().toggleShuffle();
    expect(upNext()[0]).toBe("next");
  });
});

describe("queue editing", () => {
  it("replaces the queue around the song playing, which carries on", async () => {
    await store().playQueue([song("a"), song("b")], 1);
    store().replaceQueue([song("x"), song("b"), song("y")]);
    expect(ids(store().queue)).toEqual(["x", "b", "y"]);
    expect(playing()).toBe("b");
    store().replaceQueue([song("z")]);
    expect(ids(store().queue)).toEqual(["b", "z"]);
    expect(playing()).toBe("b");
  });

  it("queues a song that already played", async () => {
    await store().playQueue([song("a"), song("b"), song("c")], 1);
    store().addToQueue(song("a"));
    store().addToQueue(song("c"));
    expect(upNext()).toEqual(["c", "a"]);
  });

  it("undoes a removal", async () => {
    await store().playQueue([song("a"), song("b"), song("c")], 0);
    store().removeFromQueue(1);
    expect(upNext()).toEqual(["c"]);
    store().undoQueueEdit();
    expect(upNext()).toEqual(["b", "c"]);
    expect(playing()).toBe("a");
  });

  it("undoes a clear, and the clear resets the station and the standby preload", async () => {
    useMusicPlayerStore.setState({ radioEnabled: true });
    getMusicWatchQueue.mockResolvedValue(page([song("r1"), song("r2")]));
    await store().playQueue([song("a")], 0);
    await store()._ensureRadio();
    expect(store().radioQueuedIds).toEqual(["r1", "r2"]);

    store().clearQueue();
    expect(ids(store().queue)).toEqual(["a"]);
    expect(store().radioQueuedIds).toEqual([]);
    expect(engine.clearPreload).toHaveBeenCalled();

    store().undoQueueEdit();
    expect(upNext()).toEqual(["r1", "r2"]);
    expect(store().radioQueuedIds).toEqual(["r1", "r2"]);
  });

  it("offers no undo once a new queue replaces the edited one", async () => {
    await store().playQueue([song("a"), song("b")], 0);
    store().removeFromQueue(1);
    await store().playQueue([song("x"), song("y")], 0);
    store().undoQueueEdit();
    expect(ids(store().queue)).toEqual(["x", "y"]);
  });
});

describe("radio", () => {
  it("waits for a shuffled queue to run out, then carries on with the station", async () => {
    useMusicPlayerStore.setState({ radioEnabled: true, isShuffle: true });
    getMusicWatchQueue.mockResolvedValue(page([song("r1")]));
    await store().playQueue([song("a"), song("b"), song("c")], 0);

    await store()._ensureRadio();
    expect(getMusicWatchQueue).not.toHaveBeenCalled();

    store().next();
    store().next();
    await store()._ensureRadio();
    expect(upNext()).toEqual(["r1"]);
  });

  it("reseeds from the seed's nearest songs when the mix runs out, then says it ran out", async () => {
    useMusicPlayerStore.setState({ radioEnabled: true });
    getMusicWatchQueue.mockImplementation(async (videoId: string, playlistId?: string) => {
      if (!playlistId) return page([]);
      if (videoId === "seed") return page([song("n1"), song("n2")]);
      if (videoId === "n1") return page([song("n1"), song("m1")]);
      return page([]);
    });
    await store().playTrack(song("seed"));
    await store()._ensureRadio();

    expect(getMusicWatchQueue).toHaveBeenCalledWith("n1", "RDAMVMn1");
    expect(upNext()).toEqual(["n1", "n2"]);
    // The anchors and the pool are spent on the next top-up.
    useMusicPlayerStore.setState({ currentIndex: store().queue.length - 1 });
    await store()._ensureRadio();
    expect(upNext()).toEqual(["m1"]);
    useMusicPlayerStore.setState({ currentIndex: store().queue.length - 1 });
    await store()._ensureRadio();
    expect(store().radioExhausted).toBe(true);
  });

  it("keeps topping up after a top-up served entirely from the pool", async () => {
    useMusicPlayerStore.setState({ radioEnabled: true });
    const mix = Array.from({ length: 40 }, (_, i) => song(`r${i}`));
    getMusicWatchQueue.mockImplementation(async (_videoId: string, playlistId?: string) =>
      playlistId ? page(mix) : page([]),
    );
    await store().playTrack(song("seed"));
    for (let topUp = 0; topUp < 3; topUp++) {
      useMusicPlayerStore.setState({ currentIndex: store().queue.length - 1 });
      await store()._ensureRadio();
    }
    expect(store().radioQueuedIds).toHaveLength(30);
  });

  it("lets one artist hold at most two songs of the station", async () => {
    useMusicPlayerStore.setState({ radioEnabled: true });
    getMusicWatchQueue.mockResolvedValue(page([song("x1", "X"), song("x2", "X"), song("x3", "X"), song("y1", "Y")]));
    await store().playTrack(song("seed"));
    await store()._ensureRadio();
    expect(upNext()).toEqual(["x1", "x2", "y1"]);
  });

  it("drops the answer of a station that was replaced while it loaded", async () => {
    useMusicPlayerStore.setState({ radioEnabled: true });
    let release: (value: ReturnType<typeof page>) => void = () => {};
    getMusicWatchQueue
      .mockResolvedValueOnce(page([]))
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await store().playTrack(song("old"));
    const pending = store()._ensureRadio();
    await Promise.resolve();
    await store().playQueue([song("new")], 0);
    release(page([song("stale")]));
    await pending;
    expect(ids(store().queue)).toEqual(["new"]);
  });
});
